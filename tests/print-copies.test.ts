import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import type {Command} from '../lib/commands';
import type {ConferenceData, Role} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {PRINT_SPARES,printCopies} from '../lib/print';
import {freshDatabase} from './helpers/database';

// Audit F3 (20 October): copies = committee delegates + 3 spares, counted at every approval (20261021120000_print_copies).
test('client: approval sets copies to committee delegates + 3, counted with the roster at each approval',()=>{
 let d:ConferenceData=createSeed();
 const run=(c:Command,role:Role)=>{d=applyCommand(d,c,role);};
 const ga1=d.delegates.filter(x=>x.committeeId==='ga1').length;
 assert.equal(printCopies(d,'ga1'),ga1+PRINT_SPARES);
 assert.equal(printCopies(d,'no-delegates'),PRINT_SPARES,'an empty committee still gets the spares');
 const r=d.documents.find(x=>x.committeeId==='ga1')!;r.status='Submitted';r.copies=24;
 run({type:'document',id:r.id,status:'Approved'},'approval');
 assert.equal(d.documents.find(x=>x.id===r.id)!.copies,ga1+3);
 // A delegate joins. Another resolution has changes requested, is resubmitted and approved: counted with the new roster.
 const schoolId=d.schools[0].id;
 run({type:'import',rows:[{name:'Late Delegate',country:'Chile',email:'late@example.com',schoolId,committeeId:'ga1'}]} as Command,'admin');
 const other=d.documents.find(x=>x.committeeId==='ga1'&&x.id!==r.id)!;other.status='Submitted';
 run({type:'document',id:other.id,status:'Draft',comment:'Fix the preamble.'},'approval');
 run({type:'document',id:other.id,status:'Submitted'},'chair');
 run({type:'document',id:other.id,status:'Approved'},'approval');
 assert.equal(d.documents.find(x=>x.id===other.id)!.copies,ga1+4,'counted at approval with the current roster');
 assert.equal(d.documents.find(x=>x.id===r.id)!.copies,ga1+3,'an earlier approval is not rewritten');
});

test('real PostgreSQL: approval sets copies server-side with the roster at that approval; Admins see the number without reading delegates',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const chair='75000000-0000-4000-8000-000000000001',panel='75000000-0000-4000-8000-000000000002',print='75000000-0000-4000-8000-000000000003',exec='75000000-0000-4000-8000-000000000004';
 try{
  await grant(chair,'chair',ids.ga1);await grant(panel,'approval');await grant(print,'logistics');await grant(exec,'admin');
  const send=async(user:string,c:unknown,role:string,key=crypto.randomUUID())=>{
   await asOwner();const id=(c as {id?:string}).id;
   const expected=id?String((await query<{revision:string}>('select revision from public.documents where id=$1',[id]))[0]?.revision??'0'):null;
   await as(user);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(c),role,expected,'2026-11-05T09:00:00Z']);return key;};
  const copies=async(id:string)=>{await asOwner();return Number((await query<{copies:number}>('select copies from public.documents where id=$1',[id]))[0].copies);};
  await asOwner();
  const ga1=Number((await query<{n:number}>('select count(*)::int n from public.delegates where committee_id=$1',[ids.ga1]))[0].n);
  // Rows inserted already Approved are counted too; resolutions past the print queue keep their number.
  const who=Number((await query<{n:number}>('select count(*)::int n from public.delegates where committee_id=$1',[ids.who]))[0].n);
  assert.equal(await copies('3b8f14fb-923d-4980-a37a-edd2a50f813e'),who+3,'seeded WHO / 01 (Approved) uses the WHO roster, not 30');
  assert.equal(await copies(ids.resolution),24,'GA1 / 01 (In Debate) is not rewritten');
  const draft=crypto.randomUUID();const doc=draft.slice(0,24)+'000000000001';
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'Print copies test',submitterId:ids.france},'chair',draft);
  assert.equal(await copies(doc),24,'a draft keeps the column default until approval');
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Approved'},'approval');
  assert.equal(await copies(doc),ga1+3,'12-delegate committee: 15, not 24');

  // Logistics reads the quantity but still cannot read the roster it was counted from.
  await as(print);
  const queue=(await query<{s:{documents:{id:string;copies:number}[]}}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s.documents;
  assert.equal(queue.find(x=>x.id===doc)?.copies,ga1+3);
  assert.equal((await query('select * from public.delegates')).length,0,'no delegate rows for Admins');

  // Roster grows. A second resolution has changes requested, is resubmitted and approved: it is counted at that
  // approval with the new roster, while the first keeps the number it was approved (and printed) with.
  await asOwner();const school=(await query<{id:string}>('select id from public.schools where conference_id=$1 order by id limit 1',[ids.conference]))[0].id;
  await send(exec,{type:'import',rows:[{name:'Late Delegate',country:'Chile',email:'late@example.com',schoolId:school,committeeId:ids.ga1}]},'admin');
  const second=crypto.randomUUID();const doc2=second.slice(0,24)+'000000000001';
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'Second print test',submitterId:ids.france},'chair',second);
  await send(chair,{type:'document',id:doc2,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc2,status:'Draft',comment:'Fix the preamble.'},'approval');
  await send(chair,{type:'document',id:doc2,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc2,status:'Approved'},'approval');
  assert.equal(await copies(doc2),ga1+4,'counted at approval with the current roster');
  assert.equal(await copies(doc),ga1+3,'an earlier approval is not rewritten');

  // Printing keeps the count; the helper is not callable by clients.
  await send(print,{type:'document',id:doc,status:'Printed'},'logistics');
  assert.equal(await copies(doc),ga1+3);
  await as(print);await assert.rejects(()=>query('select private.print_copies($1,$2)',[ids.conference,ids.ga1]),/permission denied/);
 }finally{await db.close();}
});

test('real PostgreSQL upgrade: queued Approved records are recounted as a revisioned change, notified, and a stale Printed is rejected',async()=>{
 // Records are seeded on the schema BEFORE 20261021120000_print_copies, then the migration is applied, so this exercises
 // the existing-record backfill rather than the insert trigger.
 const {db,ids,query,as,asOwner,grant,upgrade}=await freshDatabase({upgradeAt:'20261021120000_print_copies.sql'});
 const print='75000000-0000-4000-8000-000000000013';
 try{
  await grant(print,'logistics');
  await asOwner();
  const roster=async(cid:string)=>Number((await query<{n:number}>('select count(*)::int n from public.delegates where committee_id=$1',[cid]))[0].n);
  const ga1=await roster(ids.ga1),who=await roster(ids.who);
  const whoApproved='3b8f14fb-923d-4980-a37a-edd2a50f813e',gaReview='548c2e6f-84b8-4116-a2f1-ccfa8f1d5d27';
  assert.notEqual(who+3,30,'fixture: the seeded WHO / 01 count must differ from its roster count');
  const doc=(code:string)=>({id:crypto.randomUUID(),code});
  const stale=doc('GA1 / U1'),counted=doc('GA1 / U2'),printed=doc('GA1 / U3'),closed=doc('GA1 / U4');
  const insert=async(d:{id:string;code:string},status:string,copies:number,outcome:string|null=null)=>{await db.query(
   `insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title,status,outcome,copies) values($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
   [d.id,ids.conference,ids.ga1,ids.session,ids.france,d.code,status,outcome,copies]);};
  await insert(stale,'Approved',24);await insert(counted,'Approved',ga1+3);await insert(printed,'Printed',24);await insert(closed,'Closed',24,'Passed');
  // A fixed past time, so a changed updated_at is visible whatever the clock resolution.
  await db.query(`update public.documents set updated_at='2000-01-01T08:00:00Z' where conference_id=$1`,[ids.conference]);
  type Row={id:string;status:string;copies:number;revision:string;updated_at:Date};
  const rows=async()=>{await asOwner();return new Map((await query<Row>('select id,status,copies,revision::text,updated_at from public.documents where conference_id=$1',[ids.conference])).map(r=>[r.id,r]));};
  const before=await rows();
  const changesBefore=new Set((await query<{id:string}>('select id from public.operational_changes')).map(r=>r.id));

  // A Logistics device read the print queue before the upgrade and queued Printed against those revisions.
  const queued=(id:string,expected=before.get(id)!.revision)=>({key:crypto.randomUUID(),command:{type:'document',id,status:'Printed'},expected});
  const stalePrint=queued(stale.id),countedPrint=queued(counted.id);

  await upgrade();
  const after=await rows();

  // Approved rows whose count changes: recounted, revision advanced once, updated_at moved.
  for(const [id,n] of [[stale.id,ga1+3],[whoApproved,who+3]] as const){
   assert.equal(after.get(id)!.copies,n);
   assert.equal(BigInt(after.get(id)!.revision),BigInt(before.get(id)!.revision)+1n,'revision advanced once');
   assert.ok(after.get(id)!.updated_at>before.get(id)!.updated_at,'updated_at moved');
  }
  // Every other row is untouched: the already-correct Approved row and everything outside the print queue.
  for(const id of [counted.id,printed.id,closed.id,ids.resolution,gaReview]){
   const [b,a]=[before.get(id)!,after.get(id)!];
   assert.deepEqual([a.status,a.copies,a.revision,a.updated_at.getTime()],[b.status,b.copies,b.revision,b.updated_at.getTime()],`${b.status} row unchanged`);
  }
  assert.equal(after.get(ids.resolution)!.status,'In Debate');
  assert.equal(after.get(printed.id)!.copies,24,'Printed keeps the count it was printed with');
  assert.equal(after.get(closed.id)!.copies,24,'Closed keeps its count');

  // One scoped documents notification per recounted row, in the shape document mutations emit.
  const emitted=(await query<{id:string;conference_id:string;committee_id:string;topic:string}>('select id,conference_id,committee_id,topic from public.operational_changes')).filter(r=>!changesBefore.has(r.id));
  assert.deepEqual(emitted.map(r=>[r.conference_id,r.committee_id,r.topic]).sort(),[[ids.conference,ids.ga1,'documents'],[ids.conference,ids.who,'documents']].sort());

  // The queued Printed carrying the pre-upgrade revision is now stale and rejected; nothing changes.
  const send=async(q:ReturnType<typeof queued>)=>{await as(print);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,q.key,JSON.stringify(q.command),'logistics',q.expected,'2026-11-05T09:00:00Z']);};
  await assert.rejects(()=>send(stalePrint),(e:{code?:string})=>e.code==='PT409','pre-upgrade Printed must conflict');
  assert.equal((await rows()).get(stale.id)!.status,'Approved');
  // A row the upgrade did not touch keeps its revision, so its queued action still applies with the count it showed.
  await send(countedPrint);
  assert.deepEqual([(await rows()).get(counted.id)!.status,(await rows()).get(counted.id)!.copies],['Printed',ga1+3]);
  // After refreshing, Logistics prints the recounted resolution with the new quantity.
  await send(queued(stale.id,after.get(stale.id)!.revision));
  const done=(await rows()).get(stale.id)!;
  assert.deepEqual([done.status,done.copies],['Printed',ga1+3]);
 }finally{await db.close();}
});
