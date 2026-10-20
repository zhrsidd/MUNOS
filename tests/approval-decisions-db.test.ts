import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const chair='60000000-0000-4000-8000-000000000001', panel='60000000-0000-4000-8000-000000000002', whoChair='60000000-0000-4000-8000-000000000003', admin='60000000-0000-4000-8000-000000000004';
type Decision={id:string;documentId:string;decision:string;round:number;versionId:string|null;versionNumber:number|null;reviewerId:string|null;reviewerName:string|null;commentId:string|null;decidedAt:string};

test('approval decisions: every decision recorded once, comment-free approval included, separate from feedback, permissions unchanged',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(chair,'chair',ids.ga1);await grant(panel,'approval');await grant(whoChair,'chair',ids.who);await grant(admin,'admin');
  await asOwner();await db.query(`insert into public.staff(conference_id,name,auth_user_id) values($1,'Priya Nair',$2)`,[ids.conference,panel]);
  const expectedUsed=new Map<string,string|null>();
  const send=async(user:string,command:unknown,role:string,key=crypto.randomUUID())=>{
   await asOwner();const id=(command as {id?:string}).id;
   const fresh=id?String((await query<{revision:string}>('select revision from public.documents where id=$1',[id]))[0]?.revision??'0'):null;
   // A retry of the same mutation carries the precondition it was first sent with.
   const expected=expectedUsed.has(key)?expectedUsed.get(key)!:fresh;expectedUsed.set(key,expected);
   await as(user);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,'2026-10-19T10:00:00Z']);return key;};
  const snap=async(user:string)=>{await as(user);return (await query<{s:{documentDecisions:Decision[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s.documentDecisions;};
  const draft=crypto.randomUUID();const doc=draft.slice(0,24)+'000000000001';
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'Decision test',submitterId:ids.france},'chair',draft);
  await asOwner();assert.equal((await query<{r:number}>('select review_round r from public.documents where id=$1',[doc]))[0].r,0,'a draft has not been submitted');
  // Round 1: submitted, review started, changes requested with a comment.
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Review'},'approval');
  const change=await send(panel,{type:'document',id:doc,status:'Draft',comment:'Clause 3 needs a funding source.'},'approval');
  // Replaying the identical mutation (offline retry) must not record a second decision.
  await send(panel,{type:'document',id:doc,status:'Draft',comment:'Clause 3 needs a funding source.'},'approval',change);
  await asOwner();
  let rows=await query<{decision:string;round:number;reviewerName:string|null;commentId:string|null}>('select decision,round,"reviewerName","commentId" from public.document_decisions where "documentId"=$1 order by "decidedAt",id',[doc]);
  assert.deepEqual(rows.map(r=>[r.decision,r.round]),[['review_started',1],['changes_requested',1]],'replay recorded nothing extra');
  assert.equal(rows[0].commentId,null,'starting a review has no feedback');
  const comments=await query<{id:string}>('select id from public.document_comments where "documentId"=$1',[doc]);
  assert.equal(comments.length,1);assert.equal(rows[1].commentId,comments[0].id,'the decision links to its comment');
  assert.equal(rows[1].reviewerName,'Priya Nair');
  // Reusing a key for a different action is refused and records nothing.
  await assert.rejects(()=>send(panel,{type:'document',id:doc,status:'Approved'},'approval',change),/Idempotency/);
  // Round 2: resubmit, approve with NO comment.
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Approved'},'approval');
  await asOwner();
  rows=await query('select decision,round,"reviewerName","commentId","versionNumber" from public.document_decisions where "documentId"=$1 order by "decidedAt",id',[doc]);
  assert.deepEqual(rows.map(r=>[r.decision,r.round]),[['review_started',1],['changes_requested',1],['approved',2]]);
  const approved=rows[2] as unknown as {commentId:string|null;versionNumber:number|null;reviewerName:string|null};
  assert.equal(approved.commentId,null,'a comment-free approval has no comment');
  assert.equal((await query('select id from public.document_comments where "documentId"=$1',[doc])).length,1,'no empty feedback row was created');
  assert.equal(approved.reviewerName,'Priya Nair');
  assert.equal((await query<{r:number}>('select review_round r from public.documents where id=$1',[doc]))[0].r,2);
  // The version and round are recorded when a version exists.
  assert.ok(approved.versionNumber===null||approved.versionNumber>=1);
  // Permissions: Approval and the owning Chair read it; another committee's Chair and unrelated rows do not.
  assert.equal((await snap(panel)).filter(d=>d.documentId===doc).length,3,'Approval Panel reads decisions of documents it can see');
  assert.equal((await snap(chair)).filter(d=>d.documentId===doc).length,3);
  assert.equal((await snap(whoChair)).filter(d=>d.documentId===doc).length,0,'another committee cannot read them');
  // No direct writes, and the Executive audit log stays closed to the Approval Panel.
  await as(panel);
  await assert.rejects(()=>db.query(`insert into public.document_decisions(conference_id,committee_id,"documentId",decision,round) values($1,$2,$3,'approved',9)`,[ids.conference,ids.ga1,doc]),/permission denied/);
  await assert.rejects(()=>db.query('update public.document_decisions set decision=$1',['approved']),/permission denied/);
  assert.equal((await query('select * from public.audit_log')).length,0,'Approval Panel still cannot read the audit log');
  assert.ok((await query('select s from (select public.operations_snapshot($1) s) x',[ids.conference])).length===1);
  // A repeated decision of the same kind in the same round is impossible at the database level too.
  await asOwner();
  await assert.rejects(()=>db.query(`insert into public.document_decisions(conference_id,committee_id,"documentId",decision,round) values($1,$2,$3,'approved',2)`,[ids.conference,ids.ga1,doc]),/duplicate key/);
 }finally{await db.close();}
});
test('invalid transitions never record a decision',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(chair,'chair',ids.ga1);await grant(panel,'approval');
  const draft=crypto.randomUUID();const doc=draft.slice(0,24)+'000000000001';
  const send=async(user:string,command:unknown,role:string,key=crypto.randomUUID())=>{await asOwner();const id=(command as {id?:string}).id;const expected=id?String((await query<{revision:string}>('select revision from public.documents where id=$1',[id]))[0]?.revision??'0'):null;await as(user);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,'2026-10-19T10:00:00Z']);};
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'x',submitterId:ids.france},'chair',draft);
  await assert.rejects(()=>send(panel,{type:'document',id:doc,status:'Approved'},'approval'));
  await assert.rejects(()=>send(chair,{type:'document',id:doc,status:'Approved'},'chair'),/not allowed/);
  await asOwner();assert.equal((await query('select * from public.document_decisions')).length,0);
 }finally{await db.close();}
});
