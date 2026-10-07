import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {applyCommand,type Command} from '../lib/commands';
import {fingerprint} from '../lib/sync/repository';
import type {ConferenceData} from '../lib/domain';
const admin='75000000-0000-4000-8000-000000000001',chair='75000000-0000-4000-8000-000000000002',other='75000000-0000-4000-8000-000000000003';
const code=(expected:string)=>(e:unknown)=>{assert.equal((e as {code:string}).code,expected);return true;};
async function setup(){
 const f=await freshDatabase();await f.grant(admin,'admin');await f.grant(chair,'chair',f.ids.ga1);await f.grant(other,'chair',f.ids.sc);
 const snapshot=async()=>(await f.query<{s:ConferenceData}>('select public.conference_state_snapshot($1) s',[f.ids.conference]))[0].s;
 const mutate=async(c:Command,role='admin',expected?:string|null,id=crypto.randomUUID())=>{
  const time=new Date().toISOString();const exp=expected===undefined?fingerprint(await snapshot(),c):expected;
  const args=[f.ids.conference,id,c,role,exp,time];
  const run=()=>f.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',args);
  await run();return {run,id,time};
 };return {...f,snapshot,mutate};
}
test('central slots preserve local identities and history; committee/session deletion is conservative and transactional',async()=>{
 const f=await setup();try{
  await f.as(admin);const original=await f.snapshot();assert.ok(original.sessions.every(s=>s.slotId===null));
  const create:Command={type:'sessionSlot',action:'create',name:'Friday morning',startsAt:'2026-11-06T06:00:00Z',endsAt:'2026-11-06T09:00:00Z'};
  const receipt=await f.mutate(create);await receipt.run();let data=await f.snapshot();assert.equal(data.sessionSlots?.length,1);
  const predicted=applyCommand(original,create,'admin',{id:receipt.id,createdAt:receipt.time});
  assert.deepEqual(data.sessions.filter(s=>s.slotId).map(s=>[s.id,s.committeeId,s.slotId]),predicted.sessions.filter(s=>s.slotId).map(s=>[s.id,s.committeeId,s.slotId]),'optimistic materialized identities match PostgreSQL for chained outbox commands');
  const slot=data.sessionSlots![0];const copies=data.sessions.filter(s=>s.slotId===slot.id);assert.equal(copies.length,data.committees.length);
  await f.mutate({...create,action:'update',id:slot.id,name:'Morning plenary'});data=await f.snapshot();assert.deepEqual(data.sessions.filter(s=>s.slotId===slot.id).map(s=>s.id),copies.map(s=>s.id));assert.ok(data.sessions.filter(s=>s.slotId===slot.id).every(s=>s.name==='Morning plenary'));
  await assert.rejects(()=>f.mutate({...create,action:'update',id:slot.id},'admin','1'),code('PT409'));
  await f.mutate({type:'committee',code:'NEW',name:'New committee',room:'1'});data=await f.snapshot();const fresh=data.committees.find(c=>c.code==='NEW')!;
  assert.equal(data.sessions.filter(s=>s.committeeId===fresh.id).length,1);assert.equal(data.sessions.find(s=>s.committeeId===fresh.id)?.slotId,slot.id);
  await f.mutate({type:'committeeLifecycle',id:fresh.id,action:'delete'});assert.ok(!(await f.snapshot()).committees.some(c=>c.id===fresh.id));
  await f.mutate({type:'committeeUpdate',id:f.ids.ga1,code:'GA1X',name:'First Assembly',room:'A'});assert.equal((await f.snapshot()).committees.find(c=>c.id===f.ids.ga1)?.name,'First Assembly');
  await assert.rejects(()=>f.mutate({type:'committeeUpdate',id:f.ids.ga1,code:original.committees.find(c=>c.id!==f.ids.ga1)!.code,name:'Duplicate',room:'A'}),code('23505'));
  await assert.rejects(()=>f.mutate({type:'committeeLifecycle',id:f.ids.ga1,action:'delete'}),/linked records/);
  const local=copies.find(s=>s.committeeId===f.ids.ga1)!;const delegate=data.delegates.find(d=>d.committeeId===f.ids.ga1)!;
  await f.as(chair);await f.mutate({type:'attendance',delegateId:delegate.id,sessionId:local.id,status:'Present'},'chair');
  await assert.rejects(()=>f.mutate({...create,name:'unauthorized'},'admin'),code('42501'));
  await f.as(admin);await assert.rejects(()=>f.mutate({type:'sessionSlot',action:'delete',id:slot.id}),/operational history/);
  await f.mutate({type:'sessionSlot',action:'archive',id:slot.id});data=await f.snapshot();assert.ok(data.sessionSlots!.find(s=>s.id===slot.id)?.archived);assert.equal(data.attendance.find(a=>a.sessionId===local.id)?.status,'Present');assert.ok(data.sessions.filter(s=>s.slotId===slot.id).every(s=>s.archived&&s.state==='closed'));
  await f.as(chair);for(const doc of (await f.snapshot()).documents.filter(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate'))await f.mutate({type:'document',id:doc.id,status:'Closed',outcome:'Withdrawn'},'chair');await f.as(admin);
  await f.mutate({type:'committeeLifecycle',id:f.ids.ga1,action:'archive'});assert.ok((await f.snapshot()).committees.find(c=>c.id===f.ids.ga1)?.archived);
  assert.equal((await f.snapshot()).sessions.filter(s=>original.sessions.some(o=>o.id===s.id)).length,original.sessions.length,'legacy IDs retained');
  await f.mutate({...create,name:'Unused'});data=await f.snapshot();const unused=data.sessionSlots!.find(s=>s.name==='Unused')!;assert.equal(data.sessions.filter(s=>s.slotId===unused.id).length,original.committees.length-1,'archived committee excluded');
  await f.mutate({type:'sessionSlot',action:'delete',id:unused.id});assert.ok(!(await f.snapshot()).sessionSlots!.some(s=>s.id===unused.id));
 }finally{await f.db.close();}
});

test('amendment links, public submission, limits, lifecycle, RLS and token-safe audit',async()=>{
 const f=await setup();try{
  await f.as(admin);let data=await f.snapshot();const session=data.sessions.find(s=>s.committeeId===f.ids.ga1)!;const delegate=data.delegates.find(d=>d.committeeId===f.ids.ga1)!;const wrong=data.delegates.find(d=>d.committeeId!==f.ids.ga1)!;
  const doc=data.documents.find(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate')!;
  await f.asOwner();await f.query(`update public.documents set status='In Debate',"sessionId"=$2 where id=$1`,[doc.id,session.id]);await f.query('update public.committees set "currentSessionId"=$2 where id=$1',[f.ids.ga1,session.id]);
  await f.as(admin);const token='amendment_token_1234567890123456789';await f.mutate({type:'amendmentLink',action:'create',committeeId:f.ids.ga1,token});
  const submit=async(id=crypto.randomUUID(),person=delegate.id,res=doc.id,wording='Exact proposed wording')=>(await f.query<{s:{id:string;status:string}}>('select public.submit_amendment($1,$2,$3,$4,$5,$6,$7) s',[token,id,person,res,'Add','Clause 1',wording]))[0].s;
  await assert.rejects(()=>submit(),code('42501'));await f.asServer();const info=(await f.query<{s:Record<string,unknown>}>('select public.amendment_link_info($1) s',[token]))[0].s;assert.deepEqual(Object.keys(info).sort(),['committee','delegates','resolution']);assert.ok(!JSON.stringify(info).includes('email'));
  const id=crypto.randomUUID();assert.equal((await submit(id)).status,'created');assert.equal((await submit(id)).status,'replayed');assert.equal((await submit()).status,'duplicate');
  await assert.rejects(()=>submit(id,delegate.id,doc.id,'Changed wording'),/idempotency_conflict/);
  await assert.rejects(()=>submit(crypto.randomUUID(),wrong.id),/invalid_submitter/);
  await assert.rejects(()=>submit(crypto.randomUUID(),delegate.id,doc.id,''),/invalid_amendment/);
  for(let i=0;i<4;i++)await submit(crypto.randomUUID(),delegate.id,doc.id,'Different wording '+i);
  await assert.rejects(()=>submit(crypto.randomUUID(),delegate.id,doc.id,'Beyond per-delegate limit'),/rate_limited/);
  await f.as(other);assert.equal((await f.query<{n:number}>('select count(*)::int n from public.amendments'))[0].n,0);
  await f.as(admin);assert.deepEqual((await f.query<{s:ConferenceData}>('select public.executive_state_snapshot($1) s',[f.ids.conference]))[0].s.amendments,[],'Executive projection does not load amendment wording');
  await f.as(chair);data=await f.snapshot();assert.equal(data.amendments!.length,5);
  await f.mutate({type:'amendmentStatus',id,status:'Accepted for Debate'},'chair');await assert.rejects(()=>f.mutate({type:'amendmentStatus',id,status:'In Debate'},'chair','1'),code('PT409'));
  await f.mutate({type:'amendmentStatus',id,status:'In Debate'},'chair');const second=data.amendments!.find(a=>a.id!==id)!;
  await f.mutate({type:'amendmentStatus',id:second.id,status:'Accepted for Debate'},'chair');await assert.rejects(()=>f.mutate({type:'amendmentStatus',id:second.id,status:'In Debate'},'chair'),/Close the current amendment/);
  await f.mutate({type:'amendmentStatus',id,status:'Closed',outcome:'Passed'},'chair');assert.equal((await f.snapshot()).amendments!.find(a=>a.id===id)?.outcome,'Passed');
  await f.mutate({type:'amendmentStatus',id:second.id,status:'Closed',outcome:'Ruled Out'},'chair');
  const additional=data.delegates.filter(d=>d.committeeId===f.ids.ga1&&d.id!==delegate.id).slice(0,4);assert.equal(additional.length,4);
  await f.asServer();for(const person of additional.slice(0,3))for(let i=0;i<5;i++)await submit(crypto.randomUUID(),person.id,doc.id,`Link limit ${person.id} ${i}`);
  await assert.rejects(()=>submit(crypto.randomUUID(),additional[3].id,doc.id,'Beyond per-link limit'),/rate_limited/);
  await f.asOwner();await f.query(`update public.documents set status='Closed',outcome='Passed' where id=$1`,[doc.id]);await f.asServer();await assert.rejects(()=>submit(crypto.randomUUID(),delegate.id,doc.id,'After closure'),/not_open/);
  await f.asOwner();await f.query(`update public.documents set status='In Debate',outcome=null where id=$1`,[doc.id]);
  await f.as(admin);await f.mutate({type:'amendmentLink',action:'rotate',committeeId:f.ids.ga1,token:'replacement_token_123456789012345'});await f.asServer();await assert.rejects(()=>submit(),/invalid_link/);
  await f.as(admin);await f.mutate({type:'amendmentLink',action:'revoke',committeeId:f.ids.ga1});await f.asServer();assert.equal((await f.query<{s:unknown}>('select public.amendment_link_info($1) s',['replacement_token_123456789012345']))[0].s,null);
  await f.asOwner();assert.ok(!(await f.query<{details:unknown}>('select details from public.audit_log')).some(a=>JSON.stringify(a.details).includes(token)));
  await f.query(`update public.documents set status='Closed',outcome='Passed' where id=$1`,[doc.id]);await f.as(chair);assert.deepEqual((await f.snapshot()).amendments,[]);assert.equal((await f.query<{n:number}>('select count(*)::int n from public.amendments'))[0].n,20,'closed resolution history stays stored');
 }finally{await f.db.close();}
});
