import { DurableRepository,type Health } from "./sync/repository";
import {DurableStore} from './sync/store';
import {createSeed} from './seed';
import type {Command} from './commands';
import type {Role} from './domain';
import {browserClient} from './supabase/client';
import {SupabaseConferenceRepository,SupabaseTransport} from './supabase/repository';
class RepositoryController {
 private active?:DurableRepository;
 private listeners=new Set<()=>void>();
 private starting=false;
 private health:Health={mode:'local',state:'syncing',pending:0,conflicts:0,realtime:false,latency:null,message:'Opening conference…',detail:''};
 getSnapshot=()=>this.active?.getSnapshot()??null;
 getHealth=()=>this.active?.getHealth()??this.health;
 subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
 private emit=()=>this.listeners.forEach(f=>f());
 initialize=()=>{if(!this.starting){this.starting=true;void this.start().catch(()=>{this.health={...this.health,state:"error",message:"Device storage could not open. Enable browser storage and reload."};this.emit();});}};
 private async start(){
  const store=new DurableStore();let reason='';
  await store.pruneConfirmedCaches();
  try {
   if(process.env.NEXT_PUBLIC_DATA_BACKEND==='supabase'){
    const client=browserClient();const conf=process.env.NEXT_PUBLIC_CONFERENCE_ID!;
    const pointer=await store.readPreferences(`last-authorized:${conf}`);
    if(!navigator.onLine && pointer && Number(pointer.validUntil)>Date.now()){
      const cached=await store.read(pointer.key);
      if(cached)this.active=new SupabaseConferenceRepository(pointer.key,cached.base,store,new SupabaseTransport(client,conf,pointer.actorId));
    }
    if(!this.active){
    let {data:{session}}=await client.auth.getSession();
    if(!session && process.env.NEXT_PUBLIC_ENABLE_ANONYMOUS_BOOTSTRAP==='true'){
     const created=await client.auth.signInAnonymously();if(created.error)throw created.error;session=created.data.session;
    }
    if(!session)throw Error('No authorized session. Access setup is pending.');
    const key=`supabase:${conf}:${session.user.id}`;
    const cached=await store.read(key);
    // Offline recovery never merges the separate local-demo database into Supabase.
    const {data:access,error}=await client.from('user_access').select('role,committee_id,expires_at').eq('conference_id',conf);
    let initial=cached?.base;
    if(error && !initial)throw error;
    if(!error && !access?.length)throw Error(`Access setup required for device user ${session.user.id}.`);
    const scopes=access?.every(a=>a.role==='chair')?access.map(a=>a.committee_id):[];
    const transport=new SupabaseTransport(client,conf,session.user.id,scopes);
    try {initial=await transport.read();} catch(error){
      if(!cached || Date.now()-Date.parse(cached.savedAt)>48*3600000)throw error;
      if(error && typeof error==='object' && 'code' in error && error.code==='42501')throw error;
    }
    if(!initial)throw Error('Connect once to prepare the conference on this device.');
    if(access?.length)await store.savePreferences(`last-authorized:${conf}`,{key,actorId:session.user.id,validUntil:String(Math.min(Date.now()+48*3600000,...access.map(a=>Date.parse(a.expires_at))))});
    this.active=new SupabaseConferenceRepository(key,initial,store,transport);
    }
   }
  }catch(error){reason=error instanceof Error?error.message:'The cloud conference is unavailable or access has not been granted.';}
  if(!this.active)this.active=new DurableRepository('local-demo',()=>{
   const saved=localStorage.getItem('conference-os-demo-v2');
   return saved?JSON.parse(saved):createSeed();
  },store,undefined,reason);
  this.active.subscribe(this.emit);
  try {await this.active.ready();}catch{this.health={...this.health,state:'error',message:'Device storage is unavailable. Enable browser storage before recording changes.'};this.active=undefined;this.emit();}
 }
 execute=(c:Command,r:Role)=>{if(!this.active) return Promise.reject(Error('Workspace is loading.'));return this.active.execute(c,r);};
 reset=()=>this.active?.reset();
 retry=()=>{if(this.active?.health.mode==='local' && process.env.NEXT_PUBLIC_DATA_BACKEND==='supabase') window.location.reload();else this.active?.retry();};
 exportRecovery=()=>this.active?.exportRecovery();
 getPending=()=>this.active?.getPending()??[];
 resolveConflict=(id:string)=>this.active?.resolveConflict(id);
}
export const repository=new RepositoryController();
