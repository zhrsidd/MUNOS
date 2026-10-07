import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {SupabaseTransport} from '../lib/supabase/repository';
import {ConflictError,DurableRepository,fingerprint} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {isOperationsCommand} from '../lib/operations/commands';
import {freshDatabase} from './helpers/database';

const actor='71000000-0000-4000-8000-000000000001';
test('stale core, procedure and operations mutations use PT409 and make no writes',async t=>{
 const {db,ids,query,grant,as,asOwner}=await freshDatabase();
 try{
  await grant(actor,'chair',ids.ga1);await grant(actor,'admin');await as(actor);
  const snapshot=async()=>{
   const core=(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
   const ops=(await query<{s:Partial<ConferenceData>}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s;
   return {...core,...ops};
  };
  const send=async(c:Command,expected:string|null,mutation=crypto.randomUUID())=>db.query(`select public.${isOperationsCommand(c)?'apply_operations_mutation':'apply_conference_mutation'}($1,$2,$3,$4,$5,$6)`,[ids.conference,mutation,JSON.stringify(c),isOperationsCommand(c)?'admin':'chair',expected,'2026-10-06T12:00:00Z']);
  const apply=async(c:Command)=>send(c,fingerprint(await snapshot(),c));
  const stale=async(name:string,c:Command,old:string|null)=>t.test(name,async()=>{
   const before=await snapshot(),failedId=crypto.randomUUID();
   await assert.rejects(()=>send(c,old,failedId),(error:unknown)=>{assert.equal((error as {code:string}).code,'PT409');return true;});
   assert.deepEqual(await snapshot(),before,'stale attempt must not change state or audit');
   await asOwner();
   assert.equal((await query('select id from private.mutation_receipts where id=$1',[failedId])).length,0,'no receipt for rejected write');
   assert.equal((await query('select mutation_id from public.operational_changes where mutation_id=$1',[failedId])).length,0,'no change notification for rejected write');
   await as(actor);
  });
  const attendance:Command={type:'attendance',sessionId:ids.session,delegateId:ids.france,status:'Present & Voting'};
  const oldAttendance=fingerprint(await snapshot(),attendance);await apply(attendance);await stale('attendance revision',attendance,oldAttendance);
  const queue:Command={type:'queue',sessionId:ids.session,advance:true};
  const oldQueue=fingerprint(await snapshot(),queue);await apply(queue);await stale('legacy queue head',queue,oldQueue);
  await apply({type:'queueAdd',sessionId:ids.session,delegateId:ids.france,lane:'against'});
  const order:Command={type:'queueOrder',sessionId:ids.session,lane:'against',ids:(await snapshot()).queue.filter(q=>q.lane==='against').map(q=>q.id)};
  const oldOrder=fingerprint(await snapshot(),order);
  await apply({type:'queueAdd',sessionId:ids.session,delegateId:ids.japan,lane:'against'});await stale('procedure queue order',order,oldOrder);
  await apply({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
  const speech=(await snapshot()).speeches!.find(s=>s.state!=='finished')!;
  const allowance:Command={type:'poiAllowance',sessionId:ids.session,speechId:speech.id,limit:2};
  const oldSpeech=fingerprint(await snapshot(),allowance);await apply(allowance);await stale('speech revision',allowance,oldSpeech);
  const vote:Command={type:'vote',sessionId:ids.session,resolutionId:ids.resolution,delegateId:ids.france,choice:'For'};
  const oldVote=fingerprint(await snapshot(),vote);await apply(vote);await stale('vote revision',vote,oldVote);
  const document:Command={type:'document',id:ids.resolution,status:'In Debate'};
  const mode:Command={type:'voteMode',sessionId:ids.session,resolutionId:ids.resolution,mode:'divide',voteType:'substantive'};
  const oldDocument=fingerprint(await snapshot(),document);await apply(mode);await stale('document revision',document,oldDocument);
  const link:Command={type:'resolutionLink',documentId:ids.resolution,action:'access',access:'ok'};
  const oldLink=fingerprint(await snapshot(),link);await apply(link);await stale('operations revision',link,oldLink);
  await asOwner();
  const functions=await query<{name:string;definition:string}>(`select p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('apply_mutation','apply_operations_mutation','apply_procedure')`);
  assert.equal(functions.length,3);
  for(const f of functions){assert.doesNotMatch(f.definition,/(?:errcode\s*=|raise\s+sqlstate)\s*'40001'/i,f.name);assert.match(f.definition,/(?:errcode\s*=|raise\s+sqlstate)\s*'PT409'/i,f.name);}
 }finally{await db.close();}
});

for(const code of ['PT409','40001'])test(`SupabaseTransport maps ${code} to retained durable conflict without retrying writes`,async()=>{
 const data=createSeed(),name='stale-'+crypto.randomUUID(),store=new DurableStore(name),calls:string[]=[];
 const first:Mutation={id:crypto.randomUUID(),actorId:actor,createdAt:new Date().toISOString(),role:'chair',state:'pending',expected:'0',command:{type:'attendance',sessionId:'s1',delegateId:'d0',status:'Absent'}};
 const second:Mutation={...first,id:crypto.randomUUID(),expected:null,command:{type:'participation',sessionId:'s1',resolutionId:'r1',delegateId:'d1',categoryId:'speech',points:2}};
 const client={rpc:async(name:string,args?:{mutation?:string})=>{
  if(name.startsWith('apply_')){calls.push(args!.mutation!);return {data:null,error:{code,message:'Another chair changed attendance'}};}
  return {data:name==='conference_snapshot'||name==='conference_state_snapshot'?structuredClone(data):{},error:null};
 }} as unknown as SupabaseClient;
 const transport=new SupabaseTransport(client,data.conference.id,actor);
 await assert.rejects(()=>transport.send(first),ConflictError);calls.length=0;
 await store.update(name,()=>({key:name,base:data,pending:[first,second],savedAt:first.createdAt}));
 let repo=new DurableRepository(name,()=>data,store,transport);
 try{
  await repo.ready();
  // Initialization starts sync asynchronously; wait for its bounded single rejection.
  for(let i=0;i<100&&repo.getHealth().conflicts===0;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(repo.getHealth().conflicts,1);assert.equal(repo.getHealth().pending,2);
  for(let i=0;i<3;i++)await repo.flush();
  assert.deepEqual(calls,[first.id],'neither conflicting nor dependent intent is retried');
  const saved=JSON.parse(await repo.exportRecovery());
  assert.deepEqual(saved.pending.map((m:Mutation)=>[m.id,m.state]),[[first.id,'conflict'],[second.id,'pending']]);
  assert.deepEqual(saved.base.events,data.events,'no duplicate participation event');
  repo.dispose();await store.close();
  const reopened=new DurableStore(name);repo=new DurableRepository(name,()=>data,reopened,transport);
  await repo.ready();await new Promise(r=>setTimeout(r,20));await repo.flush();
  assert.equal(repo.getHealth().conflicts,1);assert.equal(repo.getHealth().pending,2);assert.deepEqual(calls,[first.id]);
  repo.dispose();await reopened.close();
 }finally{repo.dispose();await store.close();}
});
