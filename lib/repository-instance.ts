import {redeemStaffCode,CODE_INVALID,CODE_LIMITED} from './access-codes';
import {DurableRepository,type Health} from './sync/repository';
import {DurableStore,type Checkpoint} from './sync/store';
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
 private writes=new Set<Promise<void>>();
 private exportedRecovery?:{key:string;pending:string};
 constructor(private store=new DurableStore(),private client=browserClient){}
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
  const client=this.client();
  client.auth.onAuthStateChange((event,session)=>{
   // Never await Supabase calls from the auth callback (its internal lock is held).
   if(event==='SIGNED_OUT')this.deny('signedOut','Enter your staff access code to prepare this device.',undefined,undefined);
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
  const client=this.client(),conf=process.env.NEXT_PUBLIC_CONFERENCE_ID!;
  const epoch=this.generation;
  const legacyPointer=await this.store.readPreferences(`last-authorized:${conf}`);
  const offlineActor=!navigator.onLine?legacyPointer?.actorId:undefined;
  // Even an expired prepared device can export its retained outbox offline.
  // Authorization is checked separately below; never refresh an Auth token to open recovery.
  const {data:{session},error:sessionError}=offlineActor?{data:{session:{user:{id:offlineActor!,email:undefined}}},error:null}:await client.auth.getSession();
  if(epoch!==this.generation)return;
  if(!session){this.deny('signedOut','Enter your staff access code to prepare this device.',undefined,undefined);return;}
  const actorId=session.user.id,email=session.user.email;
  const key=`supabase:${conf}:${actorId}`;this.recoveryKey=key;
  const pointer=await this.store.readPreferences(`staff-authorized:${conf}:${actorId}`)??(legacyPointer?.actorId===actorId?legacyPointer:undefined);
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
   await this.saveAccessLease(conf,actorId,{key,actorId,roles:JSON.stringify(next.roles),committeeIds:JSON.stringify(next.committeeIds),validUntil:String(next.validUntil)});
   if(epoch!==this.generation)return;this.setAccess(next);this.scheduleExpiry();return;
  }
  this.stop();const generation=this.generation;this.setAccess(next);this.scheduleExpiry();
  const transport=new AccessGatedTransport(new SupabaseTransport(client,conf,actorId,next.roles.every(r=>r==='chair')?next.committeeIds:[],false,next.roles),()=>this.generation===generation&&this.access.status==='active'&&this.access.actorId===actorId&&Date.now()<(this.access.validUntil??0));
  let initial=cached?.base;
  if(navigator.onLine){try{initial=await transport.read();}catch(error){
   const denied=error&&typeof error==='object'&&'code'in error&&(error.code==='42501'||error.code==='PGRST301');
   if(denied){this.deny('noAccess',NO_CONFERENCE_ACCESS,actorId,email);return;}
   if(!cachedAccess()||!cached){this.deny('unavailable','Unable to open the conference. Reconnect and retry.',actorId,email);return;}
  }}
  if(generation!==this.generation)return;
  if(!initial){this.deny('unavailable','Connect once to prepare this staff workspace on this device.',actorId,email);return;}
  await this.saveAccessLease(conf,actorId,{key,actorId,roles:JSON.stringify(next.roles),committeeIds:JSON.stringify(next.committeeIds),validUntil:String(next.validUntil)});
  if(generation!==this.generation)return;
  this.active=new DurableRepository(key,()=>initial!,this.store,transport);await this.connectActive();
 }
 private scheduleExpiry(){
  clearTimeout(this.expiryTimer);
  const delay=(this.access.validUntil??0)-Date.now();
  this.expiryTimer=setTimeout(()=>{this.deny('noAccess',NO_CONFERENCE_ACCESS);void this.retryAccess();},Math.max(0,Math.min(delay,2147483647)));
 }
 private async saveAccessLease(conf:string,actorId:string,pointer:Record<string,string>){
  await this.store.savePreferences(`staff-authorized:${conf}:${actorId}`,pointer);
  await this.store.savePreferences(`last-authorized:${conf}`,pointer);
 }
 redeemCode=async(code:string)=>{
  const status=await redeemStaffCode(this.client(),process.env.NEXT_PUBLIC_CONFERENCE_ID!,code);
  if(status==='invalid')throw Error(CODE_INVALID);
  if(status==='rate_limited')throw Error(CODE_LIMITED);
  this.explicitSignOut=false;
  await this.retryAccess();await this.retryAccess();
 };
 private recoveryMatches(checkpoint:Checkpoint){return this.exportedRecovery?.key===checkpoint.key&&this.exportedRecovery.pending===JSON.stringify(checkpoint.pending);}
 private hasActiveAccess(){return this.access.status==='active'&&Date.now()<(this.access.validUntil??0);}
 signOut=async(confirmExportedRecovery=false)=>{
  if(this.signingOut)return;
  this.signingOut=true;
  try{
   // Finish local saves already started, and refuse new ones while deciding whether
   // destroying this device identity would strand its pending or conflict actions.
   await Promise.allSettled([...this.writes]);
   const conf=process.env.NEXT_PUBLIC_CONFERENCE_ID,actor=this.access.actorId;
   const key=actor?`supabase:${conf}:${actor}`:undefined;
   const checkpoint=key?await this.store.read(key):undefined;
   if(checkpoint?.pending.length){
    if(this.hasActiveAccess())throw Error('Sync or resolve your saved changes before signing out. This device identity is needed to send them.');
    if(!this.recoveryMatches(checkpoint))throw Error('Export your saved changes successfully before signing out. Your current device identity is needed to recover them.');
    if(!confirmExportedRecovery)throw Error('Confirm sign-out after recovery export. Exported actions belong to this device identity and cannot automatically sync under a new identity.');
   }
   this.explicitSignOut=true;
   this.deny('signedOut','Enter your staff access code to prepare this device.',undefined,undefined);
   // Signing out never deletes the actor-keyed checkpoint or unsent mutations.
   try{
    await this.store.savePreferences(`last-authorized:${conf}`,{actorId:'',validUntil:'0'});
    if(actor)await this.store.savePreferences(`staff-authorized:${conf}:${actor}`,{validUntil:'0'});
    const {error}=await this.client().auth.signOut({scope:'local'});if(error)throw error;
    this.exportedRecovery=undefined;
   }catch{
    const message='Unable to finish signing out. Reconnect and retry; saved changes are retained.';
    this.setAccess({...this.access,status:'signedOut',message});throw Error(message);
   }
  }finally{this.signingOut=false;}
 };
 execute=(c:Command,r:Role)=>{
  if(this.signingOut)return Promise.reject(Error('Sign-out is being checked. Please wait before recording another change.'));
  if(this.isCloud()&&(this.access.status!=='active'||!this.access.roles.includes(r)||Date.now()>=(this.access.validUntil??0)))return Promise.reject(Error(NO_CONFERENCE_ACCESS));
  if(!this.active)return Promise.reject(Error('Workspace is loading.'));
  this.exportedRecovery=undefined;
  const write=this.active.execute(c,r);this.writes.add(write);
  void write.then(()=>this.writes.delete(write),()=>this.writes.delete(write));return write;
 };
 reset=()=>this.active?.reset();
 retry=()=>{void this.retryAccess().then(()=>this.active?.retry());};
 exportRecovery=async()=>{
  // A new/signed-out user cannot export a previous person's local records.
  if(this.isCloud()&&(!this.access.actorId||!this.recoveryKey?.endsWith(`:${this.access.actorId}`)))return undefined;
  return this.active?.exportRecovery()??(this.recoveryKey?JSON.stringify(await this.store.read(this.recoveryKey),null,2):undefined);
 };
 // Called only after the UI successfully initiates the recovery-file download.
 // Serializing a checkpoint alone never authorizes identity destruction.
 confirmRecoveryExport=async(json:string)=>{
  const actor=this.access.actorId,key=this.recoveryKey;
  if(!actor||!key?.endsWith(`:${actor}`))throw Error('The staff identity changed. Export recovery data again.');
  const exported=JSON.parse(json) as Checkpoint,current=await this.store.read(key);
  if(!current||exported.key!==key||JSON.stringify(exported.pending)!==JSON.stringify(current.pending))throw Error('Saved changes changed during export. Export the latest recovery data before signing out.');
  this.exportedRecovery={key,pending:JSON.stringify(current.pending)};
 };
 getPending=()=>this.active?.getPending()??[];
 resolveConflict=(id:string)=>this.access.status==='active'||this.access.status==='demo'?this.active?.resolveConflict(id):undefined;
}
export const repository=new RepositoryController();
