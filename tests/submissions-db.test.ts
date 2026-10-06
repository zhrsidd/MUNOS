import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const executive='30000000-0000-4000-8000-000000000001', chair='30000000-0000-4000-8000-000000000002', otherChair='30000000-0000-4000-8000-000000000003', approver='30000000-0000-4000-8000-000000000004';
const token='A'.repeat(10)+'b_c-'+'9'.repeat(10);
const docId='1aBcD_efGhIjKlMnOpQrStUvWxYz0123456789-xyz';
const sha=(c:string)=>c.repeat(64);
test('Google-Doc-first submission: Draft with the Chair, link record, Chair sends to Approval; fallback file; safety',async()=>{
 const {db,ids,query,as,asServer,asOwner,grant,operationsExpected}=await freshDatabase();
 try{
  await grant(executive,'admin');await grant(chair,'chair',ids.ga1);await grant(otherChair,'chair',ids.who);await grant(approver,'approval');
  const receipts=new Map<string,string|null>();
  const ops=async(user:string,command:unknown,id=crypto.randomUUID(),role='admin')=>{await as(user);const expected=receipts.has(id)?receipts.get(id):await operationsExpected(command);receipts.set(id,expected??null);return db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify(command),role,expected,'2026-11-12T08:00:00Z']);};
  // Executive creates the link (chairs cannot); the sharing address can change without a new token.
  await assert.rejects(()=>ops(chair,{type:'submissionLink',action:'create',committeeId:ids.ga1,token,shareWith:'x'},crypto.randomUUID(),'chair'),/Executive access/);
  const create=crypto.randomUUID();
  await ops(executive,{type:'submissionLink',action:'create',committeeId:ids.ga1,token,shareWith:''},create);
  await ops(executive,{type:'submissionLink',action:'create',committeeId:ids.ga1,token,shareWith:''},create);
  await ops(executive,{type:'submissionLink',action:'shareWith',committeeId:ids.ga1,shareWith:'ga1@dcmun.example'});
  await asOwner();assert.deepEqual(await query('select token,share_with from public.submission_links where revoked_at is null'),[{token,share_with:'ga1@dcmun.example'}],'idempotent; same token after address change');
  assert.ok(!JSON.stringify(await query('select details from public.audit_log')).includes(token),'token not copied into audit');
  // RLS: GA1 chair sees its link, WHO chair does not; anonymous and authenticated cannot call the server functions.
  const snap=async(user:string)=>{await as(user);return (await query<{s:{submissionLinks:{token:string}[];resolutionLinks:{documentId:string;workingDocId:string|null;access:string;approvalCopyDocId:string|null;submittedAt:string|null}[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s;};
  assert.equal((await snap(chair)).submissionLinks[0].token,token);
  assert.equal((await snap(otherChair)).submissionLinks.length,0);
  await db.exec('reset role; set role anon;');
  await assert.rejects(()=>db.query('select public.submission_link_info($1)',[token]),/permission denied/);
  await assert.rejects(()=>db.query('select * from public.resolution_links'),/permission denied/);
  await as(chair);
  await assert.rejects(()=>db.query('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null)',[token,crypto.randomUUID(),ids.france,'T',docId]),/permission denied/);
  // Server route (service_role).
  await asServer();
  const info=(await query<{i:Record<string,unknown>}>('select public.submission_link_info($1) i',[token]))[0].i;
  assert.equal(info.committeeId,ids.ga1);assert.equal(info.shareWith,'');
  assert.ok((info.submitters as object[]).every(s=>Object.keys(s).sort().join()==='country,flag,id'),'countries only: no delegate names or emails');
  type R={r:{status:string;code:string}};
  const submit=(id:string,o:Partial<{doc:string|null;key:string|null;sha:string|null;size:number|null;tok:string;submitter:string;title:string}>={})=>query<R>('select public.submit_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[o.tok??token,id,o.submitter??ids.france,o.title??'Protecting civilians online','doc' in o?o.doc:docId,'draft.pdf','key' in o?o.key:null,'sha' in o?o.sha:null,'size' in o?o.size:null]).then(r=>r[0].r);
  await assert.rejects(()=>submit(crypto.randomUUID(),{tok:'z'.repeat(22)}),/invalid_link/);
  await assert.rejects(()=>submit(crypto.randomUUID(),{doc:null}),/invalid_source/,'no source');
  await assert.rejects(()=>submit(crypto.randomUUID(),{doc:'https://evil.example/x'}),/invalid_google_doc/);
  await assert.rejects(()=>submit(crypto.randomUUID(),{submitter:ids.japan.replace(/.$/,'0')}),/invalid_submitter/);
  const submission=crypto.randomUUID(), doc=submission.slice(0,24)+'000000000001';
  const created=await submit(submission);assert.equal(created.status,'created');assert.match(created.code,/^GA1 \/ \d{2}$/);
  assert.deepEqual(await submit(submission),{status:'replayed',code:created.code},'lost-response retry');
  assert.deepEqual(await submit(crypto.randomUUID()),{status:'duplicate',code:created.code,storageKey:null},'same Google Doc twice');
  // Workflow: Draft (with the Chair), link record visible to the GA1 chair and approval, not to WHO.
  await asOwner();assert.equal((await query('select status from public.documents where id=$1',[doc]))[0].status,'Draft');
  const mine=(await snap(chair)).resolutionLinks.find(l=>l.documentId===doc)!;
  assert.equal(mine.workingDocId,docId);assert.equal(mine.access,'unchecked');assert.ok(mine.submittedAt);
  assert.equal((await snap(otherChair)).resolutionLinks.length,0);
  // Chair: can't access → fixed; approval copy; other committee's chair and approval cannot write.
  await assert.rejects(()=>ops(otherChair,{type:'resolutionLink',documentId:doc,action:'access',access:'problem'},crypto.randomUUID(),'chair'),/no access/);
  await assert.rejects(()=>ops(approver,{type:'resolutionLink',documentId:doc,action:'access',access:'problem'},crypto.randomUUID(),'approval'),/Chair access required/);
  await ops(chair,{type:'resolutionLink',documentId:doc,action:'access',access:'problem'},crypto.randomUUID(),'chair');
  assert.equal((await snap(chair)).resolutionLinks.find(l=>l.documentId===doc)!.access,'problem');
  await ops(chair,{type:'resolutionLink',documentId:doc,action:'access',access:'ok'},crypto.randomUUID(),'chair');
  await assert.rejects(()=>ops(chair,{type:'resolutionLink',documentId:doc,action:'approvalCopy',docId:'javascript:alert(1)'},crypto.randomUUID(),'chair'),/check/);
  await ops(chair,{type:'resolutionLink',documentId:doc,action:'approvalCopy',docId:docId.replace('xyz','apr')},crypto.randomUUID(),'chair');
  // Chair sends it to Approval with the EXISTING core command; Approval approves.
  await as(chair);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,now())',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'document',id:doc,status:'Submitted'}),'chair','1']);
  await as(approver);
  const approval=(await snap(approver)).resolutionLinks.find(l=>l.documentId===doc)!;assert.equal(approval.approvalCopyDocId,docId.replace('xyz','apr'));
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,now())',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'document',id:doc,status:'Approved'}),'approval','2']);
  await asOwner();assert.equal((await query('select status from public.documents where id=$1',[doc]))[0].status,'Approved');
  assert.equal((await query('select count(*)::int n from public.operational_changes where mutation_id=$1',[submission]))[0].n,1,'chair notified');
  // Fallback file path: stored key must be inside this committee's folder; same file is a duplicate.
  await asServer();
  const fileSub=crypto.randomUUID(), fileKey=`${ids.conference}/${ids.ga1}/${fileSub.slice(0,24)}000000000001/v.pdf`;
  await assert.rejects(()=>submit(crypto.randomUUID(),{doc:null,key:'elsewhere/evil.pdf',sha:sha('e'),size:10}),/invalid_storage_key/);
  await assert.rejects(()=>submit(crypto.randomUUID(),{doc:docId,key:fileKey,sha:sha('e'),size:10}),/invalid_source/,'not both');
  assert.equal((await submit(fileSub,{doc:null,key:fileKey,sha:sha('a'),size:2048})).status,'created');
  const other=crypto.randomUUID();
  assert.equal((await submit(other,{doc:null,key:`${ids.conference}/${ids.ga1}/${other.slice(0,24)}000000000001/v.pdf`,sha:sha('a'),size:2048})).status,'duplicate');
  await asOwner();
  const version=(await query<{storageKey:string;fileName:string}>('select "storageKey","fileName" from public.document_versions where "documentId"=$1',[fileSub.slice(0,24)+'000000000001']))[0];
  assert.equal(version.storageKey,fileKey);
  // Rotation revokes the old link immediately; rate limit 20 per 10 minutes.
  const rotated='R'.repeat(22);
  await ops(executive,{type:'submissionLink',action:'rotate',committeeId:ids.ga1,token:rotated,shareWith:'ga1@dcmun.example'});
  await asServer();
  await assert.rejects(()=>submit(crypto.randomUUID(),{doc:docId.replace('xyz','new')}),/invalid_link/);
  for(let i=0;i<20;i++)await submit(crypto.randomUUID(),{tok:rotated,doc:docId.replace('xyz',i.toString(36).padStart(3,'q'))});
  await assert.rejects(()=>submit(crypto.randomUUID(),{tok:rotated,doc:docId.replace('xyz','zzz')}),/rate_limited/);
  await asOwner();
  const tables=await query<{rowsecurity:boolean}>("select rowsecurity from pg_tables where schemaname in ('public','private')");assert.ok(tables.every(t=>t.rowsecurity));
  assert.equal((await query("select table_name from information_schema.role_table_grants where grantee='anon' and table_schema='public'")).length,0,'no anonymous table grants');
 }finally{await db.close();}
});
