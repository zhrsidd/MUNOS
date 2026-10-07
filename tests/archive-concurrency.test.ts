import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {asUser,literal,realDatabase,waitForLock} from './helpers/postgres';
const localUrl=process.env.TEST_POSTGRES_URL;
for(const first of ['redemption','archive'])test(`committee archive vs redemption: ${first} commits first`,{skip:!localUrl,timeout:30000},async()=>{
 const db=await realDatabase(localUrl!);const {owner,ids,connect,name}=db;const admin=randomUUID(),device=randomUUID();
 try{
  await owner.query(`insert into auth.users values(${literal(admin)}),(${literal(device)});
   insert into public.user_access(conference_id,user_id,role,expires_at) values(${literal(ids.conference)},${literal(admin)},'admin',now()+interval '1 day');
   update public.documents set status='Closed',outcome='Withdrawn' where committee_id=${literal(ids.ga1)} and status='In Debate';`);
  const executive=connect('archiver'),chair=connect('redeemer');await asUser(executive,admin);await asUser(chair,device);
  const credential=await executive.json<{code:string}>(`select public.rotate_access_code(${literal(ids.conference)},'chair',${literal(ids.ga1)},now()+interval '1 day');`);
  const archive=`select public.apply_conference_mutation(${literal(ids.conference)},${literal(randomUUID())},${literal(JSON.stringify({type:'committeeLifecycle',action:'archive',id:ids.ga1}))}::jsonb,'admin','1',now());`;
  const redeem=`select public.redeem_access_code(${literal(ids.conference)},${literal(credential.code)});`;
  if(first==='redemption'){
   await chair.query('begin;');assert.equal((await chair.json<{status:string}>(redeem)).status,'ok');
   const waiting=executive.query(archive);await waitForLock(owner,`${name}_archiver`);await chair.query('commit;');await waiting;
  }else{
   await executive.query('begin;');await executive.query(archive);
   const waiting=chair.json<{status:string}>(redeem);await waitForLock(owner,`${name}_redeemer`);await executive.query('commit;');assert.equal((await waiting).status,'invalid');
  }
  assert.equal(await owner.query(`select count(*) from public.user_access where user_id=${literal(device)} and revoked_at is null;`),'0');
  assert.equal(await owner.query(`select count(*) from private.access_credentials where committee_id=${literal(ids.ga1)} and role='chair' and revoked_at is null;`),'0');
  assert.equal(await chair.query('select count(*) from public.delegates;'),'0');
  assert.equal(await owner.query(`select archived from public.committees where id=${literal(ids.ga1)};`),'t');
 }finally{await db.close();}
});

test('archive does not invert the conference foreign-key lock of an in-flight Chair grant',{skip:!localUrl,timeout:30000},async()=>{
 const db=await realDatabase(localUrl!);const {owner,ids,connect,name}=db;const admin=randomUUID(),device=randomUUID();
 try{
  await owner.query(`insert into auth.users values(${literal(admin)}),(${literal(device)});
   insert into public.user_access(conference_id,user_id,role,expires_at) values(${literal(ids.conference)},${literal(admin)},'admin',now()+interval '1 day');
   update public.documents set status='Closed',outcome='Withdrawn' where committee_id=${literal(ids.ga1)} and status='In Debate';`);
  const executive=connect('archive_barrier'),chair=connect('grant_barrier'),barrier=connect('barrier');await asUser(executive,admin);await asUser(chair,device);
  const credential=await executive.json<{code:string}>(`select public.rotate_access_code(${literal(ids.conference)},'chair',${literal(ids.ga1)},now()+interval '1 day');`);
  await owner.query(`create function public.test_pause_grant() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(982751);return new;end$$;
   create trigger test_pause_grant before insert on public.user_access for each row execute function public.test_pause_grant();`);
  await barrier.query('begin;select pg_advisory_xact_lock(982751);');
  const redeem=chair.json<{status:string}>(`select public.redeem_access_code(${literal(ids.conference)},${literal(credential.code)});`);
  await waitForLock(owner,`${name}_grant_barrier`);
  const archive=executive.query(`select public.apply_conference_mutation(${literal(ids.conference)},${literal(randomUUID())},${literal(JSON.stringify({type:'committeeLifecycle',action:'archive',id:ids.ga1}))}::jsonb,'admin','1',now());`);
  const results=Promise.allSettled([redeem,archive]);
  await waitForLock(owner,`${name}_archive_barrier`);await barrier.query('commit;');
  const completed=await results;assert.ok(completed.every(r=>r.status==='fulfilled'),completed.map(r=>r.status==='rejected'?String(r.reason):r.status).join('\n'));
  assert.equal(await owner.query(`select count(*) from public.user_access where user_id=${literal(device)} and revoked_at is null;`),'0');
 }finally{await db.close();}
});
