import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {fingerprint,DurableRepository,ConflictError,type Transport} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';
import type {ConferenceData} from '../lib/domain';
import type {Command} from '../lib/commands';
const executive='77000000-0000-4000-8000-000000000001',chair='77000000-0000-4000-8000-000000000002',newcomer='77000000-0000-4000-8000-000000000003';
const sqlCode=(code:string)=>(e:unknown)=>{assert.equal((e as {code:string}).code,code);return true;};
async function fixture(){
 const f=await freshDatabase();await f.grant(executive,'admin');await f.grant(chair,'chair',f.ids.ga1);await f.as(executive);
 const snapshot=async()=>(await f.query<{s:ConferenceData}>('select public.conference_state_snapshot($1) s',[f.ids.conference]))[0].s;
 const mutate=async(c:Command,role='admin')=>f.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[f.ids.conference,crypto.randomUUID(),c,role,fingerprint(await snapshot(),c),new Date().toISOString()]);
 const slot=async()=>{await mutate({type:'sessionSlot',action:'create',name:'Archive test',startsAt:'2026-11-08T06:00:00Z',endsAt:null});const s=await snapshot();return{slot:s.sessionSlots![0],session:s.sessions.find(x=>x.slotId&&x.committeeId===f.ids.ga1)!};};
 return {...f,snapshot,mutate,slot};
}

test('committee archive refuses active debate, then atomically revokes Chair credentials/grants without harming other roles/history',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot();const doc=before.documents.find(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate')!;
  const rotate=async()=> (await f.query<{r:{code:string}}>('select public.rotate_access_code($1,$2,$3,now()+interval \'1 day\') r',[f.ids.conference,'chair',f.ids.ga1]))[0].r;
  const credential=await rotate();await f.asOwner();await f.query('insert into auth.users values($1)',[newcomer]);
  for(const role of ['approval','logistics'])await f.grant(crypto.randomUUID(),role);
  await f.as(newcomer);assert.equal((await f.query<{r:{status:string}}>('select public.redeem_access_code($1,$2) r',[f.ids.conference,credential.code]))[0].r.status,'ok');
  await f.as(executive);await assert.rejects(()=>f.mutate({type:'committeeLifecycle',id:f.ids.ga1,action:'archive'}),/Close the current resolution debate/);
  assert.equal((await f.snapshot()).committees.find(c=>c.id===f.ids.ga1)?.archived,false,'rejected archive is atomic');
  await f.as(chair);await f.mutate({type:'document',id:doc.id,status:'Closed',outcome:'Withdrawn'},'chair');
  await f.as(executive);await f.mutate({type:'committeeLifecycle',id:f.ids.ga1,action:'archive'});
  assert.ok((await f.snapshot()).committees.find(c=>c.id===f.ids.ga1)?.archived);
  await assert.rejects(rotate,/archived/);
  await f.as(newcomer);assert.equal((await f.query<{r:{status:string}}>('select public.redeem_access_code($1,$2) r',[f.ids.conference,credential.code]))[0].r.status,'invalid');
  assert.equal((await f.query<{n:number}>('select count(*)::int n from public.delegates'))[0].n,0,'Chair RLS access is gone');
  await assert.rejects(()=>f.snapshot(),sqlCode('42501'));
  await f.asOwner();
  assert.equal((await f.query<{n:number}>("select count(*)::int n from public.user_access where conference_id=$1 and committee_id=$2 and role='chair' and revoked_at is null",[f.ids.conference,f.ids.ga1]))[0].n,0);
  assert.equal((await f.query<{n:number}>("select count(*)::int n from public.user_access where conference_id=$1 and role in ('admin','approval','logistics') and revoked_at is null",[f.ids.conference]))[0].n,3);
  await f.as(executive);const after=await f.snapshot();assert.equal(after.delegates.length,before.delegates.length);assert.equal(after.events.length,before.events.length);assert.equal(after.documents.length,before.documents.length);
 }finally{await f.db.close();}
});

test('slot archive refuses In Debate until Chair closes it, preserving document/session consistency',async()=>{
 const f=await fixture();try{
  const {slot,session}=await f.slot();const doc=(await f.snapshot()).documents.find(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate')!;
  await f.asOwner();await f.query('update public.committees set "currentSessionId"=$2 where id=$1',[f.ids.ga1,session.id]);await f.as(executive);
  await assert.rejects(()=>f.mutate({type:'sessionSlot',action:'archive',id:slot.id}),/Close the current resolution debate/,'also protects an active debate on an earlier session when current selection would be cleared');
  await f.asOwner();await f.query('update public.documents set "sessionId"=$2 where id=$1',[doc.id,session.id]);await f.query('update public.committees set "currentSessionId"=$2 where id=$1',[f.ids.ga1,session.id]);
  await f.as(executive);await assert.rejects(()=>f.mutate({type:'sessionSlot',action:'archive',id:slot.id}),/Close the current resolution debate/);
  let data=await f.snapshot();assert.equal(data.sessions.find(s=>s.id===session.id)?.archived,false);assert.equal(data.committees.find(c=>c.id===f.ids.ga1)?.currentSessionId,session.id);
  await f.as(chair);await f.mutate({type:'document',id:doc.id,status:'Closed',outcome:'Withdrawn'},'chair');
  await f.as(executive);await f.mutate({type:'sessionSlot',action:'archive',id:slot.id});data=await f.snapshot();assert.equal(data.documents.find(d=>d.id===doc.id)?.status,'Closed');assert.ok(data.sessions.find(s=>s.id===session.id)?.archived);assert.equal(data.committees.find(c=>c.id===f.ids.ga1)?.currentSessionId,null);
 }finally{await f.db.close();}
});

test('all core/procedure session paths reject archived sessions, including indirect document/event targets',async t=>{
 const f=await fixture();try{
  const {slot,session}=await f.slot();let data=await f.snapshot();const delegate=data.delegates.find(d=>d.committeeId===f.ids.ga1)!;
  await f.as(chair);await f.mutate({type:'participation',sessionId:session.id,delegateId:delegate.id,categoryId:'speech',points:1,resolutionId:null},'chair');
  await f.mutate({type:'newDocument',committeeId:f.ids.ga1,sessionId:session.id,title:'Archived draft',submitterId:delegate.id},'chair');data=await f.snapshot();
  const event=data.events.find(e=>e.sessionId===session.id)!;const doc=data.documents.find(d=>d.sessionId===session.id)!;
  await f.as(executive);await f.mutate({type:'sessionSlot',id:slot.id,action:'archive'});await f.as(chair);
  const kinds=['attendance','participation','queue','vote','timer','newDocument','currentSession','debateMode','queueAdd','queueOrder','queueRemove','speechStart','speechYield','speechScore','speechFinish','poiAllowance','poiAdd','poiOrder','poiRecognize','voteMode'];
  for(const kind of kinds)await t.test(kind,async()=>{
   const command={type:kind,sessionId:session.id,committeeId:f.ids.ga1,delegateId:delegate.id,resolutionId:doc.id,points:1};
   await assert.rejects(()=>f.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[f.ids.conference,crypto.randomUUID(),command,'chair',null,new Date().toISOString()]),sqlCode('PT409'));
  });
  for(const command of [{type:'event',id:event.id,undo:true},{type:'version',id:doc.id,fileName:'replacement',text:'test'},{type:'document',id:doc.id,status:'Submitted'}])await assert.rejects(()=>f.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[f.ids.conference,crypto.randomUUID(),command,'chair',null,new Date().toISOString()]),sqlCode('PT409'));
  // A legitimately acknowledged UUID may still replay successfully; it makes no new write.
  assert.equal((await f.snapshot()).events.filter(e=>e.sessionId===session.id).length,1);
 }finally{await f.db.close();}
});

test('offline queued attendance remains a retained PT409 conflict after slot archive',async()=>{
 const f=await fixture();const store=new DurableStore('archived-replay-'+crypto.randomUUID());let repo:DurableRepository|undefined;
 try{
  const {slot,session}=await f.slot();await f.as(chair);const data=await f.snapshot();const delegate=data.delegates.find(d=>d.committeeId===f.ids.ga1)!;let online=false;
  const transport:Transport={actorId:chair,read:async()=>{if(!online)throw Error('Offline');return f.snapshot();},send:async m=>{if(!online)throw Error('Offline');try{await f.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[f.ids.conference,m.id,m.command,m.role,m.expected,m.createdAt]);}catch(e){if((e as {code:string}).code==='PT409')throw new ConflictError((e as Error).message);throw e;}}};
  repo=new DurableRepository('archive-offline',()=>data,store,transport);await repo.ready();await new Promise(r=>setTimeout(r,20));await repo.execute({type:'attendance',sessionId:session.id,delegateId:delegate.id,status:'Present'},'chair');await new Promise(r=>setTimeout(r,20));const uuid=repo.getPending()[0].id;
  await f.as(executive);await f.mutate({type:'sessionSlot',id:slot.id,action:'archive'});await f.as(chair);online=true;await repo.flush();
  assert.equal(repo.getPending()[0].id,uuid);assert.equal(repo.getPending()[0].state,'conflict');assert.equal((await f.snapshot()).attendance.filter(a=>a.sessionId===session.id).length,0);
  await f.asOwner();assert.equal((await f.query<{n:number}>('select count(*)::int n from private.mutation_receipts where id=$1',[uuid]))[0].n,0);
 }finally{repo?.dispose();await store.close();await f.db.close();}
});

test('safe delete ignores transient/config bookkeeping, preserves audit content and still refuses real ownership',async()=>{
 const f=await fixture();try{
  const create=async(code:string)=>{await f.mutate({type:'committee',code,name:'Unused',room:'R'});return (await f.snapshot()).committees.find(c=>c.code===code)!;};
  const pristine=await create('UNUSED');await f.mutate({type:'committeeLifecycle',id:pristine.id,action:'delete'});
  const c=await create('EDITED');await f.mutate({type:'committeeUpdate',id:c.id,code:'EDITED',name:'Edited name',room:'R2'});
  await f.slot(); // local materialized sessions and configuration invalidations alone are not usage.
  const audit=await f.query<Record<string,unknown>>('select * from public.audit_log where committee_id=$1',[c.id]);assert.ok(audit.length);
  assert.ok((await f.query<{n:number}>('select count(*)::int n from public.operational_changes where committee_id=$1',[c.id]))[0].n);
  await f.mutate({type:'committeeLifecycle',id:c.id,action:'delete'});
  const kept=await f.query<Record<string,unknown>>('select * from public.audit_log where id=any($1::uuid[])',[audit.map(a=>a.id)]);
  assert.deepEqual(kept,audit.map(a=>({...a,committee_id:null})),'every audit field except nullable scope is preserved');
  assert.ok(!(await f.snapshot()).committees.some(x=>x.id===c.id));
  const staffed=await create('STAFFED');await f.asOwner();const staff=(await f.query<{id:string}>('select id from public.staff limit 1'))[0].id;
  await f.query('insert into public.committee_staff(conference_id,committee_id,staff_id) values($1,$2,$3)',[f.ids.conference,staffed.id,staff]);await f.as(executive);
  await assert.rejects(()=>f.mutate({type:'committeeLifecycle',id:staffed.id,action:'delete'}),/linked records/);
  await assert.rejects(()=>f.mutate({type:'committeeLifecycle',id:f.ids.ga1,action:'delete'}),/linked records/);
 }finally{await f.db.close();}
});

test('database rejects case-insensitive committee-code collision without UI',async()=>{
 const f=await fixture();try{
  await f.asOwner();await assert.rejects(()=>f.query("insert into public.committees(conference_id,code,name,room) values($1,'ga1','Collision','R')",[f.ids.conference]),sqlCode('23505'));
 }finally{await f.db.close();}
});
