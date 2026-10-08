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
 const slot=async()=>{const name='Archive test '+crypto.randomUUID();await mutate({type:'sessionSlot',action:'create',name,startsAt:'2026-11-08T06:00:00Z',endsAt:null});const s=await snapshot(),created=s.sessionSlots!.find(x=>x.name===name)!;return{slot:created,session:s.sessions.find(x=>x.slotId===created.id&&x.committeeId===f.ids.ga1)!};};
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

test('live core/procedure paths reject archived sessions while historical event corrections remain possible',async t=>{
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
  await f.mutate({type:'event',id:event.id,points:2},'chair');
  await f.mutate({type:'event',id:event.id,undo:true},'chair');
  assert.deepEqual(await f.query('select points,voided from public.participation_corrections where event_id=$1 order by created_at,id',[event.id]),[{points:2,voided:false},{points:null,voided:true}]);
  assert.equal((await f.query<{points:number}>('select points from public.participation_events where id=$1',[event.id]))[0].points,1,'original event remains unchanged');
  assert.equal((await f.snapshot()).events.filter(e=>e.sessionId===session.id).length,1);
 }finally{await f.db.close();}
});

test('resolution workflow survives its archived origin and enters debate only in an active current session',async()=>{
 const f=await fixture();const approval=crypto.randomUUID(),logistics=crypto.randomUUID();try{
  await f.grant(approval,'approval');await f.grant(logistics,'logistics');await f.as(executive);
  const {slot,session}=await f.slot();await f.as(chair);
  const seeded=(await f.snapshot()).documents.find(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate')!;
  await f.mutate({type:'document',id:seeded.id,status:'Closed',outcome:'Withdrawn'},'chair');
  await f.mutate({type:'currentSession',committeeId:f.ids.ga1,sessionId:session.id},'chair');
  await f.mutate({type:'newDocument',committeeId:f.ids.ga1,sessionId:session.id,title:'Cross-session resolution',submitterId:f.ids.france},'chair');
  const doc=(await f.snapshot()).documents.find(d=>d.title==='Cross-session resolution')!;
  await f.as(executive);await f.mutate({type:'sessionSlot',id:slot.id,action:'archive'});
  await f.as(chair);await f.mutate({type:'version',id:doc.id,fileName:'revision.txt',text:'Revised after session closure'},'chair');
  assert.equal((await f.query<{n:number}>('select count(*)::int n from public.document_versions where "documentId"=$1',[doc.id]))[0].n,2);
  await f.mutate({type:'document',id:doc.id,status:'Submitted'},'chair');
  await f.as(approval);await f.mutate({type:'document',id:doc.id,status:'Review'},'approval');
  await f.mutate({type:'document',id:doc.id,status:'Approved'},'approval');
  await f.as(logistics);await f.mutate({type:'document',id:doc.id,status:'Printed'},'logistics');
  await f.as(chair);await assert.rejects(()=>f.mutate({type:'document',id:doc.id,status:'In Debate'},'chair'),/Select the current session first/);
  // Direct setup simulates a stale archived selection; even this cannot bypass the DB guard.
  await f.asOwner();await f.query('update public.committees set "currentSessionId"=$2 where id=$1',[f.ids.ga1,session.id]);await f.as(chair);
  await assert.rejects(()=>f.mutate({type:'document',id:doc.id,status:'In Debate'},'chair'),sqlCode('PT409'));
  assert.equal((await f.snapshot()).documents.find(d=>d.id===doc.id)?.status,'Printed');
  await f.as(executive);const next=await f.slot();await f.as(chair);
  await f.mutate({type:'currentSession',committeeId:f.ids.ga1,sessionId:next.session.id},'chair');
  await f.mutate({type:'document',id:doc.id,status:'In Debate'},'chair');
  const debated=(await f.snapshot()).documents.find(d=>d.id===doc.id)!;assert.equal(debated.status,'In Debate');assert.equal(debated.sessionId,next.session.id);
  await f.mutate({type:'document',id:doc.id,status:'Closed',outcome:'Withdrawn'},'chair');
  assert.equal((await f.snapshot()).documents.find(d=>d.id===doc.id)?.status,'Closed');
 }finally{await f.db.close();}
});

test('committee archive closes resolution QR without removing history or breaking accepted replay',async()=>{
 const f=await fixture();try{
  const token='archive_resolution_link_123456789',accepted=crypto.randomUUID();
  const command={type:'submissionLink',action:'create',committeeId:f.ids.ga1,token,shareWith:''};
  await f.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,now())',[f.ids.conference,crypto.randomUUID(),command,'admin',await f.operationsExpected(command)]);
  const info=async()=>(await f.query<{r:{committeeId:string;submitters:unknown[];chairs:unknown[]}|null}>('select public.submission_link_info($1) r',[token]))[0].r;
  const submit=async(id:string,source='a'.repeat(30))=>(await f.query<{r:{status:string;code:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[token,id,f.ids.france,'Historical public submission',source]))[0].r;
  await f.asServer();const active=await info();assert.equal(active?.committeeId,f.ids.ga1);assert.ok(active?.submitters.length);assert.ok(Array.isArray(active?.chairs));
  const created=await submit(accepted);assert.equal(created.status,'created');
  await f.as(chair);const debate=(await f.snapshot()).documents.find(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate')!;
  await f.mutate({type:'document',id:debate.id,status:'Closed',outcome:'Withdrawn'},'chair');
  const history=async()=>{
   await f.asOwner();const records:Record<string,unknown>={};
   for(const table of ['public.submission_links','public.documents','public.document_versions','public.resolution_links','private.resolution_submissions'])records[table]=await f.query(`select * from ${table} where committee_id=$1 order by 1`,[f.ids.ga1]);
   return records;
  };
  const before=await history();await f.as(executive);await f.mutate({type:'committeeLifecycle',id:f.ids.ga1,action:'archive'});
  await f.asServer();assert.equal(await info(),null,'no committee/delegate/Chair projection');
  for(const source of ['a'.repeat(30),'b'.repeat(30)])await assert.rejects(()=>submit(crypto.randomUUID(),source),/invalid_link/,'both duplicate-source and fresh-source requests must create nothing');
  assert.deepEqual(await submit(accepted),{status:'replayed',code:created.code});
  await assert.rejects(()=>submit(accepted,'c'.repeat(30)),/idempotency_conflict/);
  assert.deepEqual(await history(),before,'all historical rows survive unchanged; no document/version/link/receipt is created');
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
