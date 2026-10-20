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
