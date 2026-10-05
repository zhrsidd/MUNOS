import type {SupabaseClient} from '@supabase/supabase-js';
import type {ConferenceData} from '../domain';
import {ConflictError,DurableRepository,type Transport} from '../sync/repository';
import {DurableStore,type Mutation} from '../sync/store';
export class SupabaseTransport implements Transport {
 constructor(private client:SupabaseClient,private conferenceId:string,public actorId:string,private committeeIds:string[]=[]){ }
 async read():Promise<ConferenceData>{
  const {data,error}=await this.client.rpc('conference_snapshot',{conf:this.conferenceId});
  if(error)throw error;
  if(!data?.conference?.id)throw Error('Conference access has not been granted.');
  return data as ConferenceData;
 }
 async send(m:Mutation){
  const {error}=await this.client.rpc('apply_conference_mutation',{conf:this.conferenceId,mutation:m.id,command:m.command,requested_role:m.role,expected:m.expected,client_time:m.createdAt});
  if(error){
   if(error.code === '40001' || error.code === '42501' || /^(22|23)/.test(error.code))throw new ConflictError(error.code==='42501'?'Access has changed. Ask an administrator to review this saved change.':error.message);
   throw error;
  }
 }
 subscribe(refresh:()=>void,state:(connected:boolean)=>void){
  let debounce:ReturnType<typeof setTimeout>;
  const changed=()=>{clearTimeout(debounce);debounce=setTimeout(refresh,350);};
  // Only the compact notification table, filtered to committee scopes or conference operations.
  const scopes=this.committeeIds.length?this.committeeIds.map(id=>`committee_id=eq.${id}`):[`conference_id=eq.${this.conferenceId}`];
  const connected=new Set<string>();
  const channels=scopes.map((filter,i)=>this.client.channel(`operations:${this.conferenceId}:${this.actorId}:${i}`)
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'operational_changes',filter},changed)
   .subscribe(status=>{if(status==='SUBSCRIBED'){connected.add(filter);changed();}else connected.delete(filter);state(connected.size===scopes.length);}));
  return ()=>{clearTimeout(debounce);channels.forEach(c=>{void this.client.removeChannel(c);});};
 }
}
export class SupabaseConferenceRepository extends DurableRepository {
 constructor(key:string,initial:ConferenceData,store:DurableStore,transport:SupabaseTransport){super(key,()=>initial,store,transport);}
}
