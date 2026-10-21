import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDatabase} from './helpers/database';
import {committeeSql,newDocumentCommand,googleDoc} from './helpers/numbering';

// lpad('100',2,'0') returns '10' in PostgreSQL (it truncates), so the 99 -> 100 boundary needs its own coverage.
const chair='65000000-0000-4000-8000-000000000011';

async function setup(){
 const f=await freshDatabase();
 const {db,ids,query,as,asOwner,asServer,grant}=f;
 const tst=committeeSql(ids.conference,'TST');
 await asOwner();await db.exec(tst.sql);await grant(chair,'chair',tst.committee);
 const seedRange=async(from:number,to:number)=>{await asOwner();await db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title)
  select gen_random_uuid(),$1,$2,$3,$4,'TST / '||lpad(g::text,greatest(2,length(g::text)),'0'),'Seed' from generate_series($5::int,$6::int) g`,[ids.conference,tst.committee,tst.session,tst.delegates[0],from,to]);};
 const seedLegacy=async()=>{await asOwner();await db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values(gen_random_uuid(),$1,$2,$3,$4,'TST / ca7640bb','Legacy')`,[ids.conference,tst.committee,tst.session,tst.delegates[0]]);};
 const create=async()=>{await as(chair);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,null,$5)',[ids.conference,randomUUID(),newDocumentCommand(tst),'chair','2026-10-21T10:00:00Z']);};
 const submit=async()=>{await asServer();return (await query<{r:{code:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[tst.token,randomUUID(),tst.delegates[0],'Protecting civilians online',googleDoc(randomUUID().replaceAll('-',''))]))[0].r.code;};
 const latest=async()=>{await asOwner();return (await query<{code:string}>(`select code from public.documents where committee_id=$1 order by created_at desc,code desc limit 1`,[tst.committee]))[0].code;};
 const has=async(code:string)=>{await asOwner();return (await query('select 1 from public.documents where committee_id=$1 and code=$2',[tst.committee,code])).length===1;};
 return {seedRange,seedLegacy,create,submit,latest,has};
}

test('only /99 present: the next Chair create is /100, not a truncated /10',async()=>{
 const f=await setup();await f.seedRange(99,99);await f.create();
 assert.ok(await f.has('TST / 100'));assert.ok(!await f.has('TST / 10'));
});

test('only /99 present: the next public submission is /100',async()=>{
 const f=await setup();await f.seedRange(99,99);
 assert.equal(await f.submit(),'TST / 100');
});

test('dense 01..99 continues at 100 promptly, then 101, 102; a legacy hex code is still ignored',async()=>{
 const f=await setup();await f.seedRange(1,99);await f.seedLegacy();
 const started=Date.now();await f.create();
 assert.ok(Date.now()-started<5000,'no loop hang');
 assert.ok(await f.has('TST / 100'));
 assert.equal(await f.submit(),'TST / 101');
 await f.create();assert.ok(await f.has('TST / 102'));
 assert.ok(await f.has('TST / ca7640bb'));
});

test('six-digit boundary: /99999 gives /100000 for a Chair create and a public submission',async()=>{
 const f=await setup();await f.seedRange(99999,99999);await f.create();
 assert.ok(await f.has('TST / 100000'));
 assert.equal(await f.submit(),'TST / 100001');
 const g=await setup();await g.seedRange(99999,99999);
 assert.equal(await g.submit(),'TST / 100000');
});

test('upper bound: at /999999 both paths raise a clear error instead of emitting an unreadable 7-digit code',async()=>{
 const f=await setup();await f.seedRange(999999,999999);
 await assert.rejects(()=>f.create(),/No free resolution number/);
 const g=await setup();await g.seedRange(999999,999999);
 await assert.rejects(()=>g.submit(),/No free resolution number/);
 assert.ok(!await g.has('TST / 1000000'));
});

test('a legacy hex code alone still starts at 01, and /100 is parsed as the integer 100',async()=>{
 const f=await setup();await f.seedLegacy();await f.create();assert.ok(await f.has('TST / 01'));
 const g=await setup();await g.seedRange(98,98);await g.create();await g.create();
 assert.ok(await g.has('TST / 99'));assert.ok(await g.has('TST / 100'));
});
