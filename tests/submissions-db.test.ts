import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const executive='30000000-0000-4000-8000-000000000001', chair='30000000-0000-4000-8000-000000000002', otherChair='30000000-0000-4000-8000-000000000003', approver='30000000-0000-4000-8000-000000000004';
const token='A'.repeat(10)+'b_c-'+'9'.repeat(10);
const sha=(c:string)=>c.repeat(64);
test('submission links + unauthenticated submission enter the existing Submitted workflow safely',async()=>{
 const {db,ids,query,as,asServer,asOwner,grant}=await freshDatabase();
 try{
  await grant(executive,'admin');await grant(chair,'chair',ids.ga1);await grant(otherChair,'chair',ids.who);await grant(approver,'approval');
  const ops=(user:string,command:unknown,id=crypto.randomUUID(),role='admin')=>as(user).then(()=>db.query('select public.apply_operations_mutation($1,$2,$3,$4,null,$5)',[ids.conference,id,JSON.stringify(command),role,'2026-11-12T08:00:00Z']));
  // Only the Executive can create links; chairs cannot.
  await assert.rejects(()=>ops(chair,{type:'submissionLink',action:'create',committeeId:ids.ga1,token,contact:'x'},crypto.randomUUID(),'chair'),/Executive access/);
  const create=crypto.randomUUID();
  await ops(executive,{type:'submissionLink',action:'create',committeeId:ids.ga1,token,contact:'resolutions@example.com'},create);
  await ops(executive,{type:'submissionLink',action:'create',committeeId:ids.ga1,token,contact:'resolutions@example.com'},create);
  await asOwner();assert.equal((await query('select count(*)::int n from public.submission_links'))[0].n,1,'replayed mutation is idempotent');
  assert.ok(!JSON.stringify(await query('select details from public.audit_log order by "createdAt" desc limit 1')).includes(token),'token not copied into audit');
  // RLS: GA1 chair sees its link, the WHO chair does not, anonymous has no access at all.
  const snap=async(user:string)=>{await as(user);return (await query<{s:{submissionLinks:{token:string}[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s;};
  assert.equal((await snap(chair)).submissionLinks[0].token,token);
  assert.equal((await snap(otherChair)).submissionLinks.length,0);
  await db.exec('reset role; set role anon;');
  await assert.rejects(()=>db.query('select public.submission_link_info($1)',[token]),/permission denied/);
  await assert.rejects(()=>db.query('select * from public.submission_links'),/permission denied/);
  await as(chair);
  await assert.rejects(()=>db.query('select public.submit_resolution($1,$2,$3,$4,$5,$6,$7,$8)',[token,crypto.randomUUID(),ids.france,'T','f.pdf','k',sha('a'),1]),/permission denied/);
  // Server route (service_role): link info exposes committee and countries only.
  await asServer();
  const info=(await query<{i:Record<string,unknown>}>('select public.submission_link_info($1) i',[token]))[0].i;
  assert.equal(info.committeeId,ids.ga1);assert.equal(info.contact,'resolutions@example.com');
  assert.ok((info.submitters as {country:string}[]).some(s=>s.country==='France'));
  assert.ok((info.submitters as object[]).every(s=>Object.keys(s).sort().join()==='country,flag,id'),'countries only: no delegate names or emails');
  assert.equal((await query<{i:unknown}>('select public.submission_link_info($1) i',['x'.repeat(22)]))[0].i,null);
  const submission=crypto.randomUUID(), doc=submission.slice(0,24)+'000000000001';
  const key=`${ids.conference}/${ids.ga1}/${doc}/${submission.slice(0,24)}000000000002.pdf`;
  const submit=(id:string,overrides:Partial<{submitter:string;title:string;key:string;sha:string;tok:string}>={})=>query<{r:{status:string;code:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,$6,$7,$8) r',[overrides.tok??token,id,overrides.submitter??ids.france,overrides.title??'Protecting civilians online','draft.pdf',overrides.key??key,overrides.sha??sha('a'),2048]).then(r=>r[0].r);
  await assert.rejects(()=>submit(crypto.randomUUID(),{submitter:ids.japan.replace(/.$/,'0')}),/invalid_submitter/);
  await assert.rejects(()=>submit(crypto.randomUUID(),{key:'elsewhere/evil.pdf',sha:sha('e')}),/invalid_storage_key/);
  await assert.rejects(()=>submit(submission,{tok:'z'.repeat(22)}),/invalid_link/);
  const created=await submit(submission);
  assert.equal(created.status,'created');assert.match(created.code,/^GA1 \/ \d{2}$/);
  assert.deepEqual(await submit(submission),{status:'replayed',code:created.code},'lost-response retry returns the same document');
  const other=crypto.randomUUID();
  const duplicate=await submit(other,{key:`${ids.conference}/${ids.ga1}/${other.slice(0,24)}000000000001/v.pdf`});
  assert.deepEqual(duplicate,{status:'duplicate',code:created.code},'same file is not submitted twice');
  // The resolution is in the existing workflow: Submitted, with a stored version, visible to Approval and the GA1 chair.
  await as(approver);
  const snapshot=(await query<{s:{documents:{id:string;status:string;versionIds:string[]}[];versions:{id:string;storageKey:string}[]}}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const document=snapshot.documents.find(d=>d.id===doc)!;
  assert.equal(document.status,'Submitted');
  assert.equal(snapshot.versions.find(v=>v.id===document.versionIds[0])!.storageKey,key);
  // Approval continues the normal workflow with the existing command.
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,now())',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'document',id:doc,status:'Approved'}),'approval','1']);
  await asOwner();
  assert.equal((await query('select status from public.documents where id=$1',[doc]))[0].status,'Approved');
  assert.equal((await query('select count(*)::int n from public.operational_changes where mutation_id=$1',[submission]))[0].n,1,'chair and approval are notified');
  // Rotation revokes the old link immediately.
  const rotated='R'.repeat(22);
  await ops(executive,{type:'submissionLink',action:'rotate',committeeId:ids.ga1,token:rotated,contact:''});
  await asServer();
  await assert.rejects(()=>submit(crypto.randomUUID(),{sha:sha('b')}),/invalid_link/);
  // Rate limit: at most 20 accepted submissions per link per 10 minutes.
  for(let i=0;i<20;i++){const id=crypto.randomUUID();await submit(id,{tok:rotated,sha:i.toString(16).padStart(2,'0').repeat(32),key:`${ids.conference}/${ids.ga1}/${id.slice(0,24)}000000000001/v.pdf`});}
  const id=crypto.randomUUID();
  await assert.rejects(()=>submit(id,{tok:rotated,sha:sha('f'),key:`${ids.conference}/${ids.ga1}/${id.slice(0,24)}000000000001/v.pdf`}),/rate_limited/);
  await asOwner();
  const tables=await query<{rowsecurity:boolean}>("select rowsecurity from pg_tables where schemaname in ('public','private')");assert.ok(tables.every(t=>t.rowsecurity));
  const anonGrants=await query("select table_name from information_schema.role_table_grants where grantee='anon' and table_schema='public'");assert.equal(anonGrants.length,0,'no anonymous table grants');
 }finally{await db.close();}
});
