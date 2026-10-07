import type {SupabaseClient} from '@supabase/supabase-js';
import type {ConferenceData,Role} from '../domain';
import {ConflictError,DurableRepository,type Transport} from '../sync/repository';
import {DurableStore,type Mutation} from '../sync/store';
import {isOperationsCommand} from '../operations/commands';
import type {OperationsData} from '../operations/types';
// CODEX REVIEW REQUIRED: read() also fetches operations_snapshot (extension data, RLS-scoped) in parallel,
// and send() routes extension commands to apply_operations_mutation. Same idempotency contract.
const missingFunction=(e:{code?:string})=>e.code==='PGRST202'||e.code==='42883';
export class SupabaseTransport implements Transport {
 constructor(private client:SupabaseClient,private conferenceId:string,public actorId:string,private committeeIds:string[]=[],private recoveryOnly=false,private authenticatedRoles:readonly Role[]=[]){ }
 private isExecutive(){return this.authenticatedRoles.length===1 && this.authenticatedRoles[0]==='admin';}
 async read():Promise<ConferenceData>{
  if(this.recoveryOnly)throw Error("Renew device access before syncing.");
  const [core,operations]=await Promise.all([this.client.rpc(this.isExecutive()?'executive_snapshot':'conference_snapshot',{conf:this.conferenceId}),this.client.rpc('operations_snapshot',{conf:this.conferenceId})]);
  const {data,error}=core;
  if(error)throw error;
  if(!data?.conference?.id)throw Error('Conference access has not been granted.');
  // Before the extension migration is applied the core conference still works without extension data.
  if(operations.error && !missingFunction(operations.error))throw operations.error;
  return {...(data as ConferenceData),...((operations.data??{}) as OperationsData)};
 }
 async send(m:Mutation){
  if(this.recoveryOnly)throw Error("Renew device access before syncing.");
  if(m.actorId!==this.actorId)throw new ConflictError("Saved action belongs to another identity. Export it for recovery.");
  if(typeof window!=="undefined"){
   const {data:{session}}=await this.client.auth.getSession();
   if(session && session.user.id!==this.actorId)throw new ConflictError("Device identity changed. Export saved actions for recovery.");
  }
  const {error}=await this.client.rpc(isOperationsCommand(m.command)?'apply_operations_mutation':'apply_conference_mutation',{conf:this.conferenceId,mutation:m.id,command:m.command,requested_role:m.role,expected:m.expected,client_time:m.createdAt});
  if(error){
   if(error.code === 'PT409' || error.code === '40001' || error.code === '42501' || /^(22|23)/.test(error.code))throw new ConflictError(error.code==='42501'?'Access has changed. Ask an administrator to review this saved change.':error.message);
   throw error;
  }
 }
 subscribe(refresh:()=>void,state:(connected:boolean)=>void){
  if(this.recoveryOnly){state(false);return ()=>{};}
  let debounce:ReturnType<typeof setTimeout>|undefined;
  let chairWindow:ReturnType<typeof setTimeout>|undefined;
  const changed=()=>{
   // The fast read includes Chair state too; avoid a second pending refresh.
   clearTimeout(chairWindow);chairWindow=undefined;
   clearTimeout(debounce);debounce=setTimeout(()=>{debounce=undefined;refresh();},350);
  };
  const executiveChairChanged=()=>{
   if(debounce!==undefined || chairWindow!==undefined)return;
   // Fixed window: sustained Chair traffic cannot postpone reconciliation.
   chairWindow=setTimeout(()=>{chairWindow=undefined;refresh();},2000);
  };
  // Only the compact notification table, filtered to committee scopes or conference operations.
  const scopes=this.committeeIds.length?this.committeeIds.map(id=>`committee_id=eq.${id}`):[`conference_id=eq.${this.conferenceId}`];
  const connected=new Set<string>();
  const channels=scopes.map((filter,i)=>this.client.channel(`operations:${this.conferenceId}:${this.actorId}:${i}`)
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'operational_changes',filter},payload=>{
    // These roles consume document/configuration changes, not Chair-only activity.
    // Unknown or broader grants keep all notifications; this is not authorization.
    if(payload.new.topic==='chair' && this.authenticatedRoles.length>0 && this.authenticatedRoles.every(role=>role==='approval'||role==='logistics'))return;
    if(payload.new.topic==='chair' && this.isExecutive()){executiveChairChanged();return;}
    changed();
   })
   .subscribe(status=>{if(status==='SUBSCRIBED'){connected.add(filter);}else connected.delete(filter);state(connected.size===scopes.length);}));
  return ()=>{clearTimeout(debounce);clearTimeout(chairWindow);channels.forEach(c=>{void this.client.removeChannel(c);});};
 }
}
export class SupabaseConferenceRepository extends DurableRepository {
 constructor(key:string,initial:ConferenceData,store:DurableStore,transport:SupabaseTransport){super(key,()=>initial,store,transport);}
}
