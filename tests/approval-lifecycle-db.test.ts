import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const chair='62000000-0000-4000-8000-000000000001', panel='62000000-0000-4000-8000-000000000002', whoChair='62000000-0000-4000-8000-000000000003', print='62000000-0000-4000-8000-000000000004', admin='62000000-0000-4000-8000-000000000005';
const GA1_02='548c2e6f-84b8-4116-a2f1-ccfa8f1d5d27'; // seeded in Review
type H={id:string;documentId:string;code:string;title:string;decision:string;round:number;comment:string|null;reviewerName:string|null};

async function setup(){
 const f=await freshDatabase();const {db,ids,query,as,asOwner,grant}=f;
 await grant(chair,'chair',ids.ga1);await grant(panel,'approval');await grant(whoChair,'chair',ids.who);await grant(print,'logistics');await grant(admin,'admin');
 await asOwner();await db.query(`insert into public.staff(conference_id,name,auth_user_id) values($1,'Priya Nair',$2)`,[ids.conference,panel]);
 const used=new Map<string,string|null>();
 const send=async(user:string,command:unknown,role:string,key=crypto.randomUUID())=>{
  await asOwner();const id=(command as {id?:string}).id;
  const fresh=id?String((await query<{revision:string}>('select revision from public.documents where id=$1',[id]))[0]?.revision??'0'):null;
  const expected=used.has(key)?used.get(key)!:fresh;used.set(key,expected);
  await as(user);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,'2026-10-19T10:00:00Z']);return key;};
 const history=async(user:string,doc?:string)=>{await as(user);const s=(await query<{s:{documentDecisions:H[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s.documentDecisions;return doc?s.filter(h=>h.documentId===doc):s;};
 return {...f,send,history};
}
test('seeded Review document: a second valid change request is accepted (round numbering matches the seed)',async()=>{
 const {db,query,asOwner,send}=await setup();
 try{
  await asOwner();assert.equal((await query<{r:number}>('select review_round r from public.documents where id=$1',[GA1_02]))[0].r,1,'a document inserted past Draft starts in round 1');
  await send(panel,{type:'document',id:GA1_02,status:'Draft',comment:'First round.'},'approval');
  await send(chair,{type:'document',id:GA1_02,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:GA1_02,status:'Draft',comment:'Second round.'},'approval'); // used to violate the unique round
  await asOwner();
  const rows=await query<{decision:string;round:number}>('select decision,round from public.document_decisions where "documentId"=$1 order by "decidedAt",id',[GA1_02]);
  assert.deepEqual(rows.map(r=>[r.decision,r.round]),[['changes_requested',1],['changes_requested',2]]);
  // Non-Draft inserts and direct status moves also land in a valid round.
  await db.query(`update public.documents set status='Draft' where id=$1`,[GA1_02]);
  await db.query(`insert into public.documents(id,"sessionId","submitterId",code,title,status,conference_id,committee_id) select gen_random_uuid(),"sessionId","submitterId",'GA1 / 99','Imported','Approved',conference_id,committee_id from public.documents where id=$1`,[GA1_02]);
  assert.equal((await query<{r:number}>(`select review_round r from public.documents where code='GA1 / 99'`))[0].r,1);
 }finally{await db.close();}
});
test('history survives Draft, Printed, In Debate and Closed for the roles that work the resolution, and for no one else',async()=>{
 const {db,ids,query,as,asOwner,send,history}=await setup();
 try{
  const draft=crypto.randomUUID();const doc=draft.slice(0,24)+'000000000001';
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'Lifecycle test',submitterId:ids.france},'chair',draft);
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Review'},'approval');
  await send(panel,{type:'document',id:doc,status:'Draft',comment:'Cite sources.'},'approval');
  // Draft: the Approval Panel can no longer open the document, but its history remains.
  const atDraft=await history(panel,doc);
  assert.deepEqual(atDraft.map(h=>h.decision),['review_started','changes_requested']);
  assert.equal(atDraft[1].comment,'Cite sources.');assert.equal(atDraft[1].code.length>0,true);assert.equal(atDraft[1].title,'Lifecycle test');
  await asOwner();assert.equal((await query('select * from public.documents where id=$1',[doc])).length,1);
  await as(panel);assert.equal((await query('select * from public.documents where id=$1',[doc])).length,0,'the document itself stays hidden from Approval in Draft');
  assert.equal((await query('select * from public.document_decisions where "documentId"=$1',[doc])).length,0,'direct table access stays narrow; only the projection widens');
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Approved'},'approval');
  await asOwner();await db.query(`update public.documents set status='Closed',outcome='Withdrawn' where id=$1`,[ids.resolution]);
  await db.query('update public.committees set "currentSessionId"=$1 where id=$2',[ids.session,ids.ga1]);
  for(const status of ['Printed','In Debate'])await send(status==='Printed'?print:chair,{type:'document',id:doc,status},status==='Printed'?'logistics':'chair');
  assert.equal((await history(panel,doc)).length,3,'Printed / In Debate');
  await asOwner();await db.query(`update public.documents set status='Closed',outcome='Withdrawn' where id=$1`,[doc]);
  const closed=await history(panel,doc);
  assert.deepEqual(closed.map(h=>h.decision),['review_started','changes_requested','approved']);
  assert.equal(closed[2].comment,null,'a comment-free approval stays comment-free');
  assert.equal(closed[2].reviewerName,'Priya Nair');
  for(const h of closed)assert.deepEqual(Object.keys(h).sort(),['code','comment','commentId','committeeId','decidedAt','decision','documentId','id','reviewerId','reviewerName','round','title','versionId','versionNumber'],'only the safe projection fields');
  // Scope: owning committee's Chair and the Executive read it; another committee's Chair and Printing do not.
  assert.equal((await history(chair,doc)).length,3);assert.equal((await history(admin,doc)).length,3);
  assert.equal((await history(whoChair,doc)).length,0);assert.equal((await history(print,doc)).length,0);
  // Revoked and expired grants lose it immediately.
  await asOwner();await db.query(`update public.user_access set revoked_at=now() where user_id=$1`,[panel]);
  assert.equal((await history(panel,doc)).length,0,'revocation is immediate');
  await asOwner();await db.query(`update public.user_access set revoked_at=null,expires_at=now()-interval '1 minute' where user_id=$1`,[panel]);
  assert.equal((await history(panel,doc)).length,0,'expiry is immediate');
  // The Executive audit log is still closed to the Approval Panel, and there are no new write paths.
  await asOwner();await db.query(`update public.user_access set expires_at=now()+interval '1 day' where user_id=$1`,[panel]);
  await as(panel);assert.equal((await query('select * from public.audit_log')).length,0);
 }finally{await db.close();}
});
test('comments written before decisions existed are projected as Comment',async()=>{
 const {db,ids,query,asOwner,history}=await setup();
 try{
  await asOwner();await db.query(`insert into public.document_comments(conference_id,committee_id,"documentId",text) values($1,$2,$3,'Legacy note.')`,[ids.conference,ids.ga1,GA1_02]);
  const h=(await history(panel,GA1_02)).filter(x=>x.decision==='comment');
  assert.equal(h.length,1);assert.equal(h[0].comment,'Legacy note.');assert.equal(h[0].round,0);assert.ok(h[0].id.startsWith('comment-'));
  assert.ok(query);
 }finally{await db.close();}
});
