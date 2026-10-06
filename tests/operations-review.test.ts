import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const admin='60000000-0000-4000-8000-000000000001', chair='60000000-0000-4000-8000-000000000002', approval='60000000-0000-4000-8000-000000000003', logistics='60000000-0000-4000-8000-000000000004';
test('review hardening: exact submission replay, lifecycle RLS for links/files, stale extension edits',async()=>{
 const {db,ids,query,as,asServer,asOwner,grant,operationsExpected}=await freshDatabase({storage:true});
 try{
  await grant(admin,'admin');await grant(chair,'chair',ids.ga1);await grant(approval,'approval');await grant(logistics,'logistics');
  const token='review_secure_token_123456789';
  const ops=async(command:unknown,expected?:string|null)=>db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(command),'admin',expected===undefined?await operationsExpected(command):expected,'2026-11-01T00:00:00Z']);
  await as(admin);await ops({type:'submissionLink',action:'create',committeeId:ids.ga1,token});
  const linkChange={type:'submissionLink',action:'shareWith',committeeId:ids.ga1,shareWith:'chair@dcmun.example'};
  const staleLink=await operationsExpected(linkChange);
  await ops(linkChange);
  await assert.rejects(()=>ops({...linkChange,shareWith:'stale@dcmun.example'},staleLink),/another device/);
  await asServer();
  const submission=crypto.randomUUID(),doc=submission.slice(0,24)+'000000000001',google='a'.repeat(25);
  const submit=(id:string,source=google,title='Review fixture',tok=token)=>query('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[tok,id,ids.france,title,source]);
  assert.equal(((await submit(submission))[0].r as {status:string}).status,'created');
  assert.equal(((await submit(submission))[0].r as {status:string}).status,'replayed');
  await assert.rejects(()=>submit(submission,'b'.repeat(25)),/idempotency_conflict/);
  await assert.rejects(()=>submit(submission,google,'Changed title'),/idempotency_conflict/);
  await as(admin);
  const otherToken='other_secure_token_123456789';
  await ops({type:'submissionLink',action:'create',committeeId:ids.who,token:otherToken});
  await asServer();await assert.rejects(()=>submit(submission,google,'Review fixture',otherToken),/idempotency_conflict/);
  // The uploaded fallback remains private until its parent document enters the role's workflow.
  const fileSubmission=crypto.randomUUID(),fileDoc=fileSubmission.slice(0,24)+'000000000001';
  const storageKey=`${ids.conference}/${ids.ga1}/${fileDoc}/test.pdf`;
  await query('select public.submit_resolution($1,$2,$3,$4,null,$5,$6,$7,$8)',[token,fileSubmission,ids.france,'File fixture','test.pdf',storageKey,'c'.repeat(64),1024]);
  await asOwner();await query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['resolutions',storageKey,`${ids.conference}/${ids.ga1}/${fileDoc}/orphan.pdf`]);
  for(const user of [approval,logistics]){
   await as(user);assert.equal((await query('select * from public.resolution_links where document_id=$1',[doc])).length,0);
   assert.equal((await query('select * from storage.objects')).length,0,'no Draft or orphan reads');
  }
  await as(chair);assert.equal((await query('select * from storage.objects')).length,1,'chair sees referenced upload only');
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,now())',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'document',id:fileDoc,status:'Submitted'}),'chair','1']);
  await as(approval);assert.equal((await query('select * from storage.objects')).length,1);
  await as(logistics);assert.equal((await query('select * from storage.objects')).length,0,'logistics waits for approval');
  await as(approval);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,now())',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'document',id:fileDoc,status:'Approved'}),'approval','2']);
  await as(logistics);assert.equal((await query('select * from storage.objects')).length,1);
  await as(admin);
  const linkEdit={type:'resolutionLink',documentId:doc,action:'access',access:'ok'};
  const oldRevision=await operationsExpected(linkEdit);await ops(linkEdit);
  await assert.rejects(()=>ops({...linkEdit,access:'problem'},oldRevision),/another device/);
  await assert.rejects(()=>ops(linkEdit,null),/another device/,'missing expected is rejected');
  const school=(await query<{id:string}>('select id from public.schools limit 1'))[0].id;
  const photo={type:'photoSlot',action:'create',schoolId:school,startsAt:'2026-11-12T10:00Z',endsAt:null,location:'Hall',note:''};
  await ops(photo);const slotId=(await query<{id:string}>('select id from public.photo_slots limit 1'))[0].id;
  const update={...photo,action:'update',slotId};const oldPhoto=await operationsExpected(update);await ops(update);
  await assert.rejects(()=>ops({...update,location:'Stale venue'},oldPhoto),/another device/);
 }finally{await db.close();}
});
