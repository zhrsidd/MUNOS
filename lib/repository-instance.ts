import {DurableRepository,type Health} from './sync/repository';
import {DurableStore} from './sync/store';
import {createSeed} from './seed';
import type {Command} from './commands';
import type {Role} from './domain';
import {browserClient} from './supabase/client';
import {SupabaseTransport} from './supabase/repository';
import {AccessGatedTransport,cachedStaffAccess,grantAccess,NO_CONFERENCE_ACCESS,STAFF_ROLES,type AccessGrant,type StaffAccess} from './access';

export class RepositoryController {
 private active?:DurableRepository;
 private listeners=new Set<()=>void>();
 private starting=false;
 private generation=0;
 private unsubscribe?:()=>void;
 private expiryTimer?:ReturnType<typeof setTimeout>;
 private pollTimer?:ReturnType<typeof setInterval>;
 private checking?:Promise<void>;
 private signingOut=false;
 private explicitSignOut=false;
 private rejectedActors=new Set<string>();
 private store=new DurableStore();
 private recoveryKey?:string;
 private access:StaffAccess={status:'loading',roles:[],committeeIds:[]};
 private health:Health={mode:'local',state:'syncing',pending:0,conflicts:0,realtime:false,latency:null,message:'Opening conference…',detail:''};
 private isCloud=()=>process.env.NEXT_PUBLIC_DATA_BACKEND==='supabase';
 getSnapshot=()=>this.access.status==='active'||this.access.status==='demo'?this.active?.getSnapshot()??null:null;
 getHealth=()=>this.health;
 getAccess=()=>this.access;
 subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
 private emit=()=>this.listeners.forEach(f=>f());
 private setAccess(next:StaffAccess){this.access=next;this.emit();}
 private stop(){this.generation++;clearTimeout(this.expiryTimer);this.unsubscribe?.();this.unsubscribe=undefined;this.active?.dispose();this.active=undefined;}
 private deny(status:StaffAccess['status'],message:string,actorId=this.access.actorId,email=this.access.email){
  if(status==='signedOut'){actorId=undefined;email=undefined;}
  if(status==='noAccess'&&actorId){
   this.rejectedActors.add(actorId);
   const conf=process.env.NEXT_PUBLIC_CONFERENCE_ID;
   void this.store.savePreferences(`staff-authorized:${conf}:${actorId}`,{validUntil:'0'}).catch(()=>{});
  }
  this.stop();this.access={status,roles:[],committeeIds:[],actorId,email,message};
  this.health={...this.health,mode:'supabase',state:'error',realtime:false,message,actorId};this.emit();
 }
 initialize=()=>{
  if(this.starting)return;this.starting=true;
  void this.start().catch(()=>this.deny('unavailable','Device storage could not open. Enable browser storage and retry.'));
 };
 private async start(){
  await this.store.pruneConfirmedCaches();
  if(!this.isCloud()){
   this.setAccess({status:'demo',roles:STAFF_ROLES,committeeIds:[]});
   this.active=new DurableRepository('local-demo',()=>{const saved=localStorage.getItem('conference-os-demo-v2');return saved?JSON.parse(saved):createSeed();},this.store);
   await this.connectActive();return;
  }
  const client=browserClient();
  client.auth.onAuthStateChange((event,session)=>{
   // Never await Supabase calls from the auth callback (its internal lock is held).
   if(event==='SIGNED_OUT')this.deny('signedOut','Sign in to your staff account.',undefined,undefined);
   else if(session?.user.id!==this.access.actorId&&event!=='INITIAL_SESSION')this.deny('loading','Checking staff access…',session?.user.id,session?.user.email);
   if(event!=='INITIAL_SESSION')setTimeout(()=>{void this.retryAccess();},0);
  });
  window.addEventListener('online',this.retryAccess);window.addEventListener('focus',this.retryAccess);
  this.pollTimer=setInterval(()=>{void this.retryAccess();},60000);
  await this.retryAccess();
 }
 private async connectActive(){
  const repo=this.active!;
  this.unsubscribe=repo.subscribe(()=>{if(repo!==this.active)return;this.health=repo.getHealth();this.emit();if(this.health.detail.startsWith("Access has changed"))void this.retryAccess();});
  try{await repo.ready();this.health=repo.getHealth();this.emit();}catch{this.deny('unavailable','Device storage is unavailable. Enable browser storage before recording changes.');}
 }
 retryAccess=():Promise<void>=>{
  if(!this.isCloud())return Promise.resolve();
  if(this.checking)return this.checking;
  this.checking=this.checkAccess().catch(()=>{
   if(this.access.status!=='active')this.deny('unavailable','Unable to check staff access. Reconnect and retry.');
  }).finally(()=>{this.checking=undefined;});return this.checking;
 };
 private async checkAccess(){
  if(this.signingOut||this.explicitSignOut)return;
  const client=browserClient(),conf=process.env.NEXT_PUBLIC_CONFERENCE_ID!;
  const epoch=this.generation;
  const {data:{session},error:sessionError}=await client.auth.getSession();
  if(epoch!==this.generation)return;
  if(!session||session.user.is_anonymous){this.deny('signedOut','Sign in with your staff email and password.',undefined,undefined);return;}
  const actorId=session.user.id,email=session.user.email;
  const key=`supabase:${conf}:${actorId}`;this.recoveryKey=key;
  const pointer=await this.store.readPreferences(`staff-authorized:${conf}:${actorId}`);
  const cached=await this.store.read(key);
  const cachedAccess=()=>this.rejectedActors.has(actorId)?null:cachedStaffAccess(pointer,actorId,email);
  let next:StaffAccess|null=null;
  if(!navigator.onLine||sessionError)next=cachedAccess();
  else{
   const {data:rows,error}=await client.from('user_access').select('role,committee_id,expires_at,revoked_at').eq('conference_id',conf).eq('user_id',actorId);
   if(epoch!==this.generation)return;
   if(error){
    if(error.code==='42501'||error.code==='PGRST301'){this.deny('noAccess',NO_CONFERENCE_ACCESS,actorId,email);return;}
    next=cachedAccess();
   }else {next=grantAccess((rows??[]) as AccessGrant[],actorId,email);if(next.status==='active')this.rejectedActors.delete(actorId);}
  }
  if(epoch!==this.generation)return;
  if(!next){this.deny('unavailable','Reconnect to verify your staff access. Saved changes remain on this device.',actorId,email);return;}
  if(next.status!=='active'){await this.store.savePreferences(`staff-authorized:${conf}:${actorId}`,{validUntil:'0'});this.deny('noAccess',NO_CONFERENCE_ACCESS,actorId,email);return;}
  if(this.active&&this.access.actorId===actorId&&JSON.stringify(this.access.roles)===JSON.stringify(next.roles)&&JSON.stringify(this.access.committeeIds)===JSON.stringify(next.committeeIds)){
   await this.store.savePreferences(`staff-authorized:${conf}:${actorId}`,{key,actorId,roles:JSON.stringify(next.roles),committeeIds:JSON.stringify(next.committeeIds),validUntil:String(next.validUntil)});
   if(epoch!==this.generation)return;this.setAccess(next);this.scheduleExpiry();return;
  }
  this.stop();const generation=this.generation;this.setAccess(next);this.scheduleExpiry();
  const transport=new AccessGatedTransport(new SupabaseTransport(client,conf,actorId,next.committeeIds,false,next.roles),()=>this.generation===generation&&this.access.status==='active'&&this.access.actorId===actorId&&Date.now()<(this.access.validUntil??0));
  let initial=cached?.base;
  if(navigator.onLine){try{initial=await transport.read();}catch(error){
   const denied=error&&typeof error==='object'&&'code'in error&&(error.code==='42501'||error.code==='PGRST301');
   if(denied){this.deny('noAccess',NO_CONFERENCE_ACCESS,actorId,email);return;}
   if(!cachedAccess()||!cached){this.deny('unavailable','Unable to open the conference. Reconnect and retry.',actorId,email);return;}
  }}
  if(generation!==this.generation)return;
  if(!initial){this.deny('unavailable','Connect once to prepare this staff workspace on this device.',actorId,email);return;}
  await this.store.savePreferences(`staff-authorized:${conf}:${actorId}`,{key,actorId,roles:JSON.stringify(next.roles),committeeIds:JSON.stringify(next.committeeIds),validUntil:String(next.validUntil)});
  if(generation!==this.generation)return;
  this.active=new DurableRepository(key,()=>initial!,this.store,transport);await this.connectActive();
 }
 private scheduleExpiry(){
  clearTimeout(this.expiryTimer);
  const delay=(this.access.validUntil??0)-Date.now();
  this.expiryTimer=setTimeout(()=>{this.deny('noAccess',NO_CONFERENCE_ACCESS);void this.retryAccess();},Math.max(0,Math.min(delay,2147483647)));
 }
 signIn=async(email:string,password:string)=>{
  const {error}=await browserClient().auth.signInWithPassword({email:email.trim(),password});
  if(error)throw Error('Sign-in failed. Check your staff email and password, then try again.');
  this.explicitSignOut=false;
  // The auth event may invalidate an in-flight check; run once more after it finishes.
  await this.retryAccess();await this.retryAccess();
 };
 signOut=async()=>{
  this.signingOut=true;this.explicitSignOut=true;
  this.deny('signedOut','Sign in to your staff account.',undefined,undefined);
  // Signing out never deletes the actor-keyed checkpoint or unsent mutations.
  try{const {error}=await browserClient().auth.signOut({scope:'local'});if(error)throw error;}
  catch{const message='Unable to finish signing out. Reconnect and retry; saved changes are retained.';this.setAccess({...this.access,status:'signedOut',message});throw Error(message);}
  finally{this.signingOut=false;}
 };
 execute=(c:Command,r:Role)=>{
  if(this.isCloud()&&(this.access.status!=='active'||!this.access.roles.includes(r)||Date.now()>=(this.access.validUntil??0)))return Promise.reject(Error(NO_CONFERENCE_ACCESS));
  if(!this.active)return Promise.reject(Error('Workspace is loading.'));return this.active.execute(c,r);
 };
 reset=()=>this.active?.reset();
 retry=()=>{void this.retryAccess().then(()=>this.active?.retry());};
 exportRecovery=async()=>{
  // A new/signed-out user cannot export a previous person's local records.
  if(this.isCloud()&&(!this.access.actorId||!this.recoveryKey?.endsWith(`:${this.access.actorId}`)))return undefined;
  return this.active?.exportRecovery()??(this.recoveryKey?JSON.stringify(await this.store.read(this.recoveryKey),null,2):undefined);
 };
 getPending=()=>this.active?.getPending()??[];
 resolveConflict=(id:string)=>this.access.status==='active'||this.access.status==='demo'?this.active?.resolveConflict(id):undefined;
}
export const repository=new RepositoryController();
