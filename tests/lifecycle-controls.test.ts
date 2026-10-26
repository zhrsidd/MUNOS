import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

const actor='91000000-0000-4000-8000-000000000001';
const newActor='91000000-0000-4000-8000-000000000002';
const raw='1234567890ABCDEF12345678';
const ref='kllhswucdhqqywnzxado';

async function retire(d:Awaited<ReturnType<typeof freshDatabase>>){
 await d.asOwner();
 await d.db.exec(`update public.user_access set revoked_at=now() where test_only;
 update private.access_credentials set revoked_at=now() where test_only;
 update public.submission_links set revoked_at=now() where test_only;
 update public.amendment_links set revoked_at=now() where test_only;`);
}

test('phase status exposes only fixed metadata; no API role can change the marker or authority classification',async()=>{
 const d=await freshDatabase();
 try{
  for(const role of ['anon','authenticated']){
   await d.asOwner();await d.db.exec(`set role ${role}`);
   const [r]=await d.query<{s:unknown}>('select public.preproduction_status() s');
   assert.deepEqual(r.s,{projectRef:ref,phase:'preproduction',revision:1,canTest:true});
   await assert.rejects(d.db.exec("update private.project_lifecycle set phase='production'"),/permission denied/);
   await assert.rejects(d.db.exec("update public.user_access set test_only=false"),/permission denied/);
  }
  await d.asServer();await assert.rejects(d.query('select public.preproduction_status()'),/permission denied/);
  await d.asOwner();
  const allowed=await d.query<{n:string}>("select n.nspname||'.'||p.proname n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and has_function_privilege('anon',p.oid,'EXECUTE') order by 1");
  assert.deepEqual(allowed.map(x=>x.n),['public.preproduction_status']);
  await assert.rejects(d.db.exec('truncate private.project_lifecycle'),/Lifecycle removal refused/);
  await assert.rejects(d.db.exec('delete from private.project_lifecycle'),/Lifecycle removal refused/);
 }finally{await d.db.close()}
});

test('promotion refuses active test access; class gates staff reads, writes, links and code redemption after promotion',async()=>{
 const d=await freshDatabase({storage:true});
 try{
  const {conference,ga1,session}=d.ids;
  await d.grant(actor,'admin');await d.grant(actor,'chair',ga1);
  await d.db.query(`insert into private.access_credentials(conference_id,role,credential_hash,expires_at) values($1,'admin',encode(sha256(convert_to($2,'UTF8')),'hex'),now()+interval '1 day')`,[conference,raw]);
  await d.db.query(`insert into public.submission_links(conference_id,committee_id,token) values($1,$2,$3) on conflict do nothing`,[conference,ga1,'R'.repeat(32)]);
  await d.db.query(`insert into public.amendment_links(conference_id,committee_id,token) values($1,$2,$3) on conflict do nothing`,[conference,ga1,'A'.repeat(32)]);
  await assert.rejects(d.db.exec("update private.project_lifecycle set phase='production'"),/Revoke all test/);
  // An accepted exact staff receipt must remain acknowledged across phase/revocation, with no new effect.
  await d.as(actor);
  const mid=crypto.randomUUID(),cmd={type:'school',name:'TEST accepted before promotion'},time='2026-10-26T00:00:00Z';
  const send=(command:unknown,id=mid)=>d.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[conference,id,JSON.stringify(command),'admin',null,time]);
  await send(cmd);
  await retire(d);await d.db.exec("update private.project_lifecycle set phase='production'");
  // Deliberately reactivate old test rows as owner: the class barrier must deny even if revocation was missed.
  await d.db.exec('update public.user_access set revoked_at=null; update private.access_credentials set revoked_at=null; update public.submission_links set revoked_at=null; update public.amendment_links set revoked_at=null;');
  await d.as(actor);
  assert.deepEqual(await d.query('select * from public.user_access'),[]);
  assert.deepEqual(await d.query('select * from public.conferences'),[]);
  assert.deepEqual(await d.query('select * from public.submission_links'),[]);
  assert.deepEqual(await d.query('select * from storage.objects'),[]);
  await assert.rejects(d.query('select public.conference_state_snapshot($1)',[conference]),/access has not been granted/);
  await send(cmd); // acknowledgement, not a new write
  await assert.rejects(send({...cmd,name:'different'}),/Idempotency/);
  await assert.rejects(send(cmd,crypto.randomUUID()),/no access/);
  const [badCode]=await d.query<{r:{status:string}}>('select public.redeem_access_code($1,$2) r',[conference,raw]);assert.equal(badCode.r.status,'invalid');
  await d.asServer();
  for(const fn of ['submission_link_info','amendment_link_info'])assert.equal((await d.query<{s:unknown}>(`select public.${fn}($1) s`,[fn==='submission_link_info'?'R'.repeat(32):'A'.repeat(32)]))[0].s,null);
  await assert.rejects(d.query('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null)',['R'.repeat(32),crypto.randomUUID(),d.ids.france,'Synthetic','d'.repeat(32)]),/invalid_link/);
  await assert.rejects(d.query('select public.submit_amendment($1,$2,$3,$4,$5,$6,$7)',['A'.repeat(32),crypto.randomUUID(),d.ids.france,d.ids.resolution,'Add','1','Synthetic']),/invalid_link/);
  await d.asOwner();
  assert.equal((await d.query<{n:number}>('select count(*)::int n from private.mutation_receipts where id=$1',[mid]))[0].n,1);
  await assert.rejects(d.db.exec("update private.project_lifecycle set phase='preproduction'"),/Production demotion refused/);
  // First real authority can only come from the human production bootstrap, never the old test admin.
  await d.db.query('insert into auth.users values($1)',[newActor]);
  await d.db.exec('update private.access_credentials set revoked_at=now()');
  await d.db.query(`insert into private.access_credentials(conference_id,role,credential_hash,expires_at,test_only) values($1,'admin',encode(sha256(convert_to($2,'UTF8')),'hex'),now()+interval '1 day',false)`,[conference,raw.split('').reverse().join('')]);
  await d.as(newActor);
  assert.equal((await d.query<{r:{status:string}}>('select public.redeem_access_code($1,$2) r',[conference,raw.split('').reverse().join('')]))[0].r.status,'ok');
  assert.equal((await d.query<{test_only:boolean}>('select test_only from public.user_access'))[0].test_only,false);
  const [rotated]=await d.query<{r:{id:string}}>("select public.rotate_access_code($1,'chair',$2,now()+interval '1 hour') r",[conference,ga1]);
  await d.asOwner();assert.equal((await d.query<{test_only:boolean}>('select test_only from private.access_credentials where id=$1',[rotated.r.id]))[0].test_only,false);
  assert.ok(session);
 }finally{await d.db.close()}
});

test('missing lifecycle state fails closed for access, defaults, writes and metadata',async()=>{
 const d=await freshDatabase();
 try{
  await d.grant(actor,'admin');
  await d.db.exec('alter table private.project_lifecycle disable trigger user; delete from private.project_lifecycle; alter table private.project_lifecycle enable trigger user;');
  await d.as(actor);
  assert.deepEqual(await d.query('select * from public.user_access'),[]);
  assert.equal((await d.query<{s:{canTest:boolean;phase:string}}>('select public.preproduction_status() s'))[0].s.canTest,false);
  await assert.rejects(d.query('select public.rotate_access_code($1,$2,null,now()+interval \'1 hour\')',[d.ids.conference,'admin']),/Lifecycle unavailable/);
  await d.asOwner();await assert.rejects(d.db.query(`insert into private.access_credentials(conference_id,role,credential_hash,expires_at) values($1,'admin',$2,now()+interval '1 hour')`,[d.ids.conference,'0'.repeat(64)]),/Lifecycle unavailable/);
 }finally{await d.db.close()}
});
