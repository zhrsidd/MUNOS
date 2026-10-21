import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDatabase} from './helpers/database';
import {committeeSql,newDocumentCommand,googleDoc} from './helpers/numbering';

// Chair-created drafts take the next sequential per-committee number, the same helper public submissions use.
// PGlite replays every committed migration; the concurrent-connection version of these races is
// tests/sequential-chair-numbering-concurrency.test.ts (PostgreSQL 17).
const migration='20261021140000_sequential_chair_numbering.sql';
const chair='65000000-0000-4000-8000-000000000001', chair2='65000000-0000-4000-8000-000000000002';

async function setup(options:{upgradeAt?:string}={}){
 const f=await freshDatabase(options);
 const {db,ids,query,as,asOwner,asServer,grant}=f;
 const tst=committeeSql(ids.conference,'TST'),oth=committeeSql(ids.conference,'OTH');
 await asOwner();await db.exec(tst.sql+oth.sql);
 await grant(chair,'chair',tst.committee);await grant(chair2,'chair',oth.committee);
 const create=async(user:string,c:typeof tst,mutation=randomUUID(),title='Draft')=>{
  await as(user);
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,null,$5)',[ids.conference,mutation,newDocumentCommand(c,title),'chair','2026-10-21T10:00:00Z']);
  return mutation;
 };
 const submit=async(c:typeof tst,submission=randomUUID(),doc='a')=>{
  await asServer();
  const r=await query<{r:{status:string;code:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[c.token,submission,c.delegates[0],'Protecting civilians online',googleDoc(doc)]);
  return r[0].r;
 };
 const codes=async(c:typeof tst)=>{await asOwner();return (await query<{code:string}>('select code from public.documents where committee_id=$1 order by created_at,code',[c.committee])).map(r=>r.code);};
 return {...f,tst,oth,create,submit,codes};
}

test('Chair drafts are numbered 01, 02, 03 and a retried mutation consumes no number',async()=>{
 const f=await setup();const {tst,create,codes,query,asOwner}=f;
 const first=await create(chair,tst);
 await create(chair,tst);
 assert.deepEqual((await codes(tst)).sort(),['TST / 01','TST / 02']);
 await create(chair,tst,first);
 assert.equal((await codes(tst)).length,2,'replay adds no document');
 await create(chair,tst);
 assert.deepEqual((await codes(tst)).sort(),['TST / 01','TST / 02','TST / 03'],'the replay did not burn a number');
 await asOwner();
 const stored=await query<{title:string}>(`select title from public.documents where committee_id=$1 and code='TST / 01'`,[tst.committee]);
 assert.equal(stored[0].title,'Draft','the title compat value is still stored');
});

test('Chair creates and public submissions share one sequence per committee, and committees are independent',async()=>{
 const f=await setup();const {tst,oth,create,submit,codes}=f;
 await create(chair,tst);
 assert.equal((await submit(tst,randomUUID(),'a')).code,'TST / 02');
 await create(chair,tst);
 assert.equal((await submit(tst,randomUUID(),'b')).code,'TST / 04');
 await create(chair2,oth);
 assert.deepEqual(await codes(oth),['OTH / 01'],'another committee counts from 01');
 const submission=randomUUID();
 assert.equal((await submit(oth,submission,'c')).code,'OTH / 02');
 assert.equal((await submit(oth,submission,'c')).status,'replayed','public replay keeps its number');
 await create(chair2,oth);
 assert.deepEqual((await codes(oth)).sort(),['OTH / 01','OTH / 02','OTH / 03']);
});

test('legacy hex-coded drafts are ignored by the counter and left untouched',async()=>{
 const f=await setup();const {tst,asOwner,db,create,codes}=f;
 await asOwner();
 const insert=(code:string)=>db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values($1,$2,$3,$4,$5,$6,'Legacy')`,[randomUUID(),f.ids.conference,tst.committee,tst.session,tst.delegates[0],code]);
 await insert('TST / ca7640bb');await insert('TST / 12345678');await insert('TST / 0fffffff');
 await create(chair,tst);
 assert.ok((await codes(tst)).includes('TST / 01'),'hex legacy codes (even all-digit ones) do not move the counter');
 await asOwner();await insert('TST / 07');
 await create(chair,tst);
 assert.ok((await codes(tst)).includes('TST / 08'),'continues after the highest sequential number, gaps are not filled');
 assert.ok((await codes(tst)).includes('TST / ca7640bb'));
});

test('upgrading from the previous schema keeps existing rows unchanged and continues numbering',async()=>{
 const f=await setup({upgradeAt:migration});const {tst,create,submit,codes,upgrade,query,asOwner}=f;
 await create(chair,tst);                       // old behaviour: hex code
 assert.match((await codes(tst))[0],/^TST \/ [0-9a-f]{8}$/);
 await submit(tst,randomUUID(),'a');            // old behaviour: count + 1 => 02
 await asOwner();
 const before=await query('select id,code,title,status,revision from public.documents order by id');
 await upgrade();
 await asOwner();
 assert.deepEqual(await query('select id,code,title,status,revision from public.documents order by id'),before,'no renumbering');
 const legacy=(await codes(tst))[0];
 await create(chair,tst);
 const after=await codes(tst);
 assert.ok(after.includes(legacy)&&after.includes('TST / 02')&&after.includes('TST / 03'),`got ${after.join(', ')}`);
});

test('the helper is not callable through the API roles',async()=>{
 const f=await setup();
 await f.as(chair);
 await assert.rejects(()=>f.db.query('select private.next_resolution_code($1,$2)',[f.ids.conference,f.tst.committee]),/permission denied/);
});
