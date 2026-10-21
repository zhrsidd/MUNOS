import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {asUser,literal,realDatabase,waitForLock} from './helpers/postgres';
import type {PostgresConnection} from './helpers/postgres';
import {committeeSql,googleDoc,newDocumentCommand} from './helpers/numbering';

const localUrl=process.env.TEST_POSTGRES_URL;

// Real independent server transactions. CI supplies a disposable PostgreSQL 17 service; locally opt in with a loopback URL.
// Contention is made deterministic: one transaction holds the committee row lock and the others are observed waiting on
// it (pg_stat_activity wait_event_type = 'Lock') before it commits, so the race is real rather than assumed from sleeps.
test('PostgreSQL 17 sequential Chair numbering',{skip:!localUrl,timeout:120000},async t=>{
 const db=await realDatabase(localUrl!);
 const {owner,ids,connect,name}=db;
 const conf=literal(ids.conference);
 const chair=randomUUID();
 const tst=committeeSql(ids.conference,'TST'),other=committeeSql(ids.conference,'OTH'),legacy=committeeSql(ids.conference,'LEG');
 await owner.query(`insert into auth.users values(${literal(chair)});${tst.sql}${other.sql}${legacy.sql}
  insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values
   (${conf},${literal(chair)},'chair',${literal(tst.committee)},now()+interval '1 day'),
   (${conf},${literal(chair)},'chair',${literal(other.committee)},now()+interval '1 day'),
   (${conf},${literal(chair)},'chair',${literal(legacy.committee)},now()+interval '1 day');`);
 let seq=0;
 const chairConnection=async(label:string)=>{const c=connect(label);await asUser(c,chair);return c;};
 const serverConnection=async(label:string)=>{const c=connect(label);await c.query('set role service_role;');return c;};
 const create=(c:typeof tst,mutation=randomUUID())=>`select public.apply_conference_mutation(${conf},${literal(mutation)},${literal(newDocumentCommand(c))},'chair',null,'2026-10-21T10:00:00Z');`;
 const submit=(c:typeof tst,submission=randomUUID())=>`select public.submit_resolution(${literal(c.token)},${literal(submission)},${literal(c.delegates[0])},'Protecting civilians online',${literal(googleDoc(`d${seq++}${randomUUID().replaceAll('-','')}`))},null,null,null,null)::text;`;
 const codes=async(c:typeof tst)=>(await owner.query(`select coalesce(string_agg(code,',' order by code),'') from public.documents where committee_id=${literal(c.committee)};`)).split(',').filter(Boolean);
 const sequence=(prefix:string,from:number,to:number)=>Array.from({length:to-from+1},(_,i)=>`${prefix} / ${String(from+i).padStart(2,'0')}`);
 /** Hold the committee lock in `holder`, start every queued statement on its own connection, wait for each to block, release. */
 const raceBehind=async(holder:PostgresConnection,holderSql:string,queued:{label:string;connection:PostgresConnection;sql:string}[])=>{
  await holder.query('begin;');await holder.query(holderSql);
  const running=queued.map(q=>q.connection.query(q.sql));
  for(const q of queued)await waitForLock(owner,`${name}_${q.label}`);
  await holder.query('commit;');
  await Promise.all(running);
 };
 try{
  await t.test('N parallel Chair creates queued behind one lock number exactly 01..N',async()=>{
   const n=8;
   const holder=await chairConnection('n_hold');
   const queued=await Promise.all(Array.from({length:n-1},async(_,i)=>({label:`n_${i}`,connection:await chairConnection(`n_${i}`),sql:create(tst)})));
   await raceBehind(holder,create(tst),queued);
   assert.deepEqual(await codes(tst),sequence('TST',1,n));
  });

  await t.test('unsynchronised parallel Chair creates and public submissions never collide or skip',async()=>{
   const chairs=await Promise.all(Array.from({length:6},(_,i)=>chairConnection(`mix_c${i}`)));
   const servers=await Promise.all(Array.from({length:6},(_,i)=>serverConnection(`mix_s${i}`)));
   await Promise.all([...chairs.map(c=>c.query(create(other))),...servers.map(c=>c.query(submit(other)))]);
   assert.deepEqual(await codes(other),sequence('OTH',1,12));
  });

  await t.test('a Chair create holding the lock and a racing public submission get distinct consecutive numbers',async()=>{
   const holder=await chairConnection('cs_hold'),submitter=await serverConnection('cs_submit');
   await raceBehind(holder,create(tst),[{label:'cs_submit',connection:submitter,sql:submit(tst)}]);
   assert.deepEqual(await codes(tst),sequence('TST',1,10));
  });

  await t.test('a public submission holding the lock and a racing Chair create get distinct consecutive numbers',async()=>{
   const holder=await serverConnection('sc_hold'),chairConn=await chairConnection('sc_chair');
   await raceBehind(holder,submit(tst),[{label:'sc_chair',connection:chairConn,sql:create(tst)}]);
   assert.deepEqual(await codes(tst),sequence('TST',1,12));
  });

  await t.test('the same mutation id sent concurrently adds one document and consumes one number',async()=>{
   const mutation=randomUUID();
   const holder=await chairConnection('same_hold'),again=await chairConnection('same_again');
   // The holder's mutation advisory lock is taken first; its retry waits on that lock, then sees the receipt.
   await holder.query('begin;');await holder.query(create(tst,mutation));
   const retry=again.query(create(tst,mutation));await waitForLock(owner,`${name}_same_again`);
   await holder.query('commit;');await retry;
   assert.deepEqual(await codes(tst),sequence('TST',1,13));
   await again.query(create(tst,mutation));
   assert.deepEqual(await codes(tst),sequence('TST',1,13),'a later replay is a no-op');
   await again.query(create(tst));
   assert.deepEqual(await codes(tst),sequence('TST',1,14),'the next fresh create gets the very next number');
  });

  await t.test('committees do not block each other and number independently',async()=>{
   const holder=await chairConnection('ind_hold'),free=await chairConnection('ind_free');
   await holder.query('begin;');await holder.query(create(tst));
   await free.query("set statement_timeout='2s';");
   await free.query(create(other));
   await holder.query('commit;');
   assert.deepEqual((await codes(other)).slice(-1),['OTH / 13']);
   assert.equal((await codes(tst)).length,15);
  });

  await t.test('legacy hex-coded drafts are ignored by the counter',async()=>{
   await owner.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values
     (gen_random_uuid(),${conf},${literal(legacy.committee)},${literal(legacy.session)},${literal(legacy.delegates[0])},'LEG / ca7640bb','Legacy'),
     (gen_random_uuid(),${conf},${literal(legacy.committee)},${literal(legacy.session)},${literal(legacy.delegates[0])},'LEG / 12345678','Legacy');`);
   const c=await chairConnection('legacy_chair');
   await c.query(create(legacy));
   assert.deepEqual(await codes(legacy),['LEG / 01','LEG / 12345678','LEG / ca7640bb']);
  });
 }finally{await db.close();}
});
