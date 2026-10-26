import test from 'node:test';
import assert from 'node:assert/strict';
import {asUser,literal,realDatabase,waitForLock} from './helpers/postgres';
const url=process.env.TEST_POSTGRES_URL;
const dbTest=url?test:test.skip;
const actor='92000000-0000-4000-8000-000000000001';
const phaseLock='6210692840397143';
const revoke=`update public.user_access set revoked_at=now(); update private.access_credentials set revoked_at=now(); update public.submission_links set revoked_at=now(); update public.amendment_links set revoked_at=now();`;

for(const path of ['code rotation','staff amendment link','procedure'])dbTest(`promotion wins the phase lock before ${path}; stale test authority cannot create production work`,async()=>{
 const d=await realDatabase(url!);
 try{
  const {conference,ga1,session}=d.ids;
  await d.owner.query(`insert into auth.users values('${actor}'); insert into public.user_access(conference_id,user_id,role,expires_at) values('${conference}','${actor}','admin',now()+interval '1 day'); insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values('${conference}','${actor}','chair','${ga1}',now()+interval '1 day');`);
  const worker=d.connect('late_worker');await asUser(worker,actor);
  await d.owner.query(`begin; select pg_advisory_xact_lock(${phaseLock}::bigint);`);
  const command=path==='staff amendment link'?{type:'amendmentLink',action:'create',committeeId:ga1,token:'late_test_'+'A'.repeat(24)}:{type:'debateMode',sessionId:session,mode:'closed',phase:'against'};
  const request=path==='code rotation'
   ?`select public.rotate_access_code('${conference}','chair','${ga1}',now()+interval '1 hour');`
   :`select public.apply_conference_mutation('${conference}','${crypto.randomUUID()}',${literal(JSON.stringify(command))},'${path==='procedure'?'chair':'admin'}',null,'2026-10-26T00:00:00Z');`;
  const pending=worker.query(request);const denied=assert.rejects(pending,/Executive access required|no access|Access denied/);
  await waitForLock(d.owner,`${d.name}_late_worker`);
  await d.owner.query(`${revoke} update private.project_lifecycle set phase='production'; commit;`);
  await denied;
  assert.equal(await d.owner.query('select count(*) from private.access_credentials where not test_only;'),'0');
  assert.equal(await d.owner.query('select count(*) from public.amendment_links where not test_only;'),'0');
 }finally{await d.close()}
});

dbTest('an in-flight accepted write drains before promotion; exact retry after promotion acknowledges its single receipt',async()=>{
 const d=await realDatabase(url!);
 try{
  await d.owner.query(`insert into auth.users values('${actor}'); insert into public.user_access(conference_id,user_id,role,expires_at) values('${d.ids.conference}','${actor}','admin',now()+interval '1 day');`);
  const writer=d.connect('writer');await asUser(writer,actor);
  const mid=crypto.randomUUID();const request=`select public.apply_conference_mutation('${d.ids.conference}','${mid}','{"type":"school","name":"TEST draining write"}','admin',null,'2026-10-26T00:00:00Z');`;
  await writer.query(`begin; ${request}`);
  const promote=d.connect('promote');const pending=promote.query(`begin; select pg_advisory_xact_lock(${phaseLock}::bigint); ${revoke} update private.project_lifecycle set phase='production'; commit;`);
  await waitForLock(d.owner,`${d.name}_promote`);
  await writer.query('commit;');await pending;
  await writer.query(request);
  assert.equal(await d.owner.query(`select count(*) from private.mutation_receipts where id='${mid}';`),'1');
  assert.equal(await d.owner.query(`select count(*) from public.schools where name='TEST draining write';`),'1');
 }finally{await d.close()}
});
