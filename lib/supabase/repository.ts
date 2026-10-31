import type {SupabaseClient} from '@supabase/supabase-js';
import type {ConferenceData,Role} from '../domain';
import {ConflictError,DurableRepository,type Transport} from '../sync/repository';
import {DurableStore,type Mutation} from '../sync/store';
import {SUPPORT_REFRESH_GAP_MS,transportError} from '../sync/backoff';
import {isOperationsCommand} from '../operations/commands';
import type {OperationsData} from '../operations/types';
// CODEX REVIEW REQUIRED: read() normally makes ONE RPC — conference_state_snapshot, or executive_state_snapshot for
// an Admin-only identity — which returns the core snapshot merged with operations_snapshot (right-hand precedence,
// same as the previous client-side merge). Only when that bundled function is missing (PGRST202/42883, e.g. a
// database without the 20261006211039 migration) does it fall back to the previous parallel two-RPC read.
// send() routes extension commands to apply_operations_mutation. Same idempotency contract.
/** The saved command plus its device protocol block. The stored command is never modified, so a retry sends identical JSON. */
const withDevice=(m:Mutation)=>m.deviceId&&m.deviceSeq!==undefined?{...m.command,_device:{deviceId:m.deviceId,deviceSeq:m.deviceSeq,...(m.displayedLabel!==undefined?{displayedLabel:m.displayedLabel}:{})}}:m.command;
const missingFunction=(e:{code?:string})=>e.code==='PGRST202'||e.code==='42883';
export class SupabaseTransport implements Transport {
 constructor(private client:SupabaseClient,private conferenceId:string,public actorId:string,private committeeIds:string[]=[],private recoveryOnly=false,private authenticatedRoles:readonly Role[]=[]){ }
 private isExecutive(){return this.authenticatedRoles.length===1 && this.authenticatedRoles[0]==='admin';}
 private isReviewOnly(){return this.authenticatedRoles.length>0 && this.authenticatedRoles.every(role=>role==='approval'||role==='logistics');}
 /** Approval, Printing and Executive-only identities follow every committee: each read is large and 15-second freshness is enough. */
 get passiveRefreshGapMs(){return this.isReviewOnly()||this.isExecutive()?SUPPORT_REFRESH_GAP_MS:undefined;}
 // Set once the bundled RPC is known to be missing on this database; later reads go straight to the two-RPC path.
 private bundledUnavailable=false;
 async read():Promise<ConferenceData>{
  if(this.recoveryOnly)throw Error("Renew device access before syncing.");
  if(!this.bundledUnavailable){
   const {data,error,status}=await this.client.rpc(this.isExecutive()?'executive_state_snapshot':'conference_state_snapshot',{conf:this.conferenceId});
   if(!error){
    if(!data?.conference?.id)throw Error('Conference access has not been granted.');
    return data as ConferenceData;
   }
   // Never fall back on authorization, timeout or any other failure: only a missing bundled function.
   if(!missingFunction(error))throw transportError(error,status);
   this.bundledUnavailable=true;
  }
  return this.readSeparately();
 }
 /** Previous read path: core snapshot and operations_snapshot in parallel, merged {...core, ...operations}. */
 private async readSeparately():Promise<ConferenceData>{
  const [core,operations]=await Promise.all([this.client.rpc(this.isExecutive()?'executive_snapshot':'conference_snapshot',{conf:this.conferenceId}),this.client.rpc('operations_snapshot',{conf:this.conferenceId})]);
  const {data,error}=core;
  if(error)throw transportError(error,core.status);
  if(!data?.conference?.id)throw Error('Conference access has not been granted.');
  // Before the extension migration is applied the core conference still works without extension data.
  if(operations.error && !missingFunction(operations.error))throw transportError(operations.error,operations.status);
  return {...(data as ConferenceData),...((operations.data??{}) as OperationsData)};
 }
 async send(m:Mutation){
  if(this.recoveryOnly)throw Error("Renew device access before syncing.");
  if(m.actorId!==this.actorId)throw new ConflictError("Saved action belongs to another identity. Export it for recovery.");
  if(typeof window!=="undefined"){
   const {data:{session}}=await this.client.auth.getSession();
   if(session && session.user.id!==this.actorId)throw new ConflictError("Device identity changed. Export saved actions for recovery.");
  }
  const {error,status}=await this.client.rpc(isOperationsCommand(m.command)?'apply_operations_mutation':'apply_conference_mutation',{conf:this.conferenceId,mutation:m.id,command:withDevice(m),requested_role:m.role,expected:m.expected,client_time:m.createdAt});
  if(error){
   if(error.code === 'PT409' || error.code === '40001' || error.code === '42501' || /^(22|23)/.test(error.code))throw new ConflictError(error.code==='42501'?'Access has changed. Ask an administrator to review this saved change.':error.message);
   throw transportError(error,status);
  }
 }
 async syncClock(deviceId:string){
  if(this.recoveryOnly)return;
  const {error}=await this.client.rpc('record_device_clock',{conf:this.conferenceId,device:deviceId,device_time:new Date().toISOString()});
  // Missing on a database without the session-model migration, or no grant: the clock call is evidence only, never a reason to fail a sync.
  if(error&&!missingFunction(error))return;
 }
 subscribe(refresh:()=>void,state:(connected:boolean)=>void,isOwn?:(mutationId:string)=>boolean){
  if(this.recoveryOnly){state(false);return ()=>{};}
  let debounce:ReturnType<typeof setTimeout>|undefined;
  let chairWindow:ReturnType<typeof setTimeout>|undefined;
  // True once the pending window holds a notification that is not only an echo of this device's own sent action. A window of
  // echoes alone skips its read: the post-send confirmation read already covers those changes. Unknown ids count as foreign.
  let foreign=false;
  const fire=()=>{const go=foreign;foreign=false;if(go)refresh();};
  const changed=()=>{
   // The fast read includes Chair state too; avoid a second pending refresh.
   clearTimeout(chairWindow);chairWindow=undefined;
   clearTimeout(debounce);debounce=setTimeout(()=>{debounce=undefined;fire();},350);
  };
  const executiveChairChanged=()=>{
   if(debounce!==undefined || chairWindow!==undefined)return;
   // Fixed window: sustained Chair traffic cannot postpone reconciliation.
   chairWindow=setTimeout(()=>{chairWindow=undefined;fire();},2000);
  };
  // Only the compact notification table, filtered to committee scopes or conference operations.
  const scopes=this.committeeIds.length?this.committeeIds.map(id=>`committee_id=eq.${id}`):[`conference_id=eq.${this.conferenceId}`];
  const connected=new Set<string>();
  const channels:ReturnType<SupabaseClient["channel"]>[]=[];
  let cancelled=false;
  const startChannels=()=>{
   if(cancelled)return;
   for(const [i,filter] of scopes.entries()){
    // A socket join can precede logical replication readiness; wait for the actual table subscription.
    const channel=this.client.channel(`operations:${this.conferenceId}:${this.actorId}:${i}`,{config:{postgres_changes_options:{wait:true}}})
     .on('postgres_changes',{event:'INSERT',schema:'public',table:'operational_changes',filter},payload=>{
      // These roles consume document/configuration changes, not Chair-only activity.
      // Unknown or broader grants keep all notifications; this is not authorization.
      if(payload.new.topic==='chair' && this.isReviewOnly())return;
      const id=payload.new.mutation_id;
      if(typeof id!=='string' || !isOwn?.(id))foreign=true;
      if(payload.new.topic==='chair' && this.isExecutive()){executiveChairChanged();return;}
      changed();
     })
     .subscribe(status=>{if(status==='SUBSCRIBED'){connected.add(filter);}else connected.delete(filter);state(connected.size===scopes.length);});
    channels.push(channel);
   }
  };
  // Supabase Realtime builds the first channel join payload from its cached access token.
  // Explicitly refresh that cache before creating/subscribing channels so the first join is
  // RLS-authenticated. Passing no token keeps Supabase's accessToken callback/auth events as
  // the source of truth for later refreshes. If preparation itself fails, retain the existing
  // degraded Realtime behavior; the minute recovery read remains the correctness fallback.
  void this.client.realtime.setAuth().catch(()=>undefined).then(startChannels);
  return ()=>{cancelled=true;clearTimeout(debounce);clearTimeout(chairWindow);channels.forEach(c=>{void this.client.removeChannel(c);});};
 }
}
export class SupabaseConferenceRepository extends DurableRepository {
 constructor(key:string,initial:ConferenceData,store:DurableStore,transport:SupabaseTransport){super(key,()=>initial,store,transport);}
}
