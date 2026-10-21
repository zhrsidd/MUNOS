import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {freshDatabase} from './helpers/database';
import {committeeSql,newDocumentCommand,googleDoc} from './helpers/numbering';

// The revert procedure in docs/NUMBERING_HOSTED_VERIFICATION.md (section 7) is replayed against the POST-TEST state the
// verification procedure leaves behind: a committee numbered 01..101 (the /99 -> /100 boundary fixture) and a committee with
// legacy hex codes. The SQL under test is the fenced block that starts with `-- REVERT-SQL`, read from the document itself.
// Reverting must keep three-digit numbers working: a plain restore of lpad(n::text,2,'0') truncates 102 to '10' and the old
// skip loop then never terminates while holding the committee lock.
const chair='65000000-0000-4000-8000-000000000021';

async function revertSql(){
 const doc=await readFile('docs/NUMBERING_HOSTED_VERIFICATION.md','utf8');
 const match=/```sql\n(-- REVERT-SQL[\s\S]*?)```/.exec(doc);
 assert.ok(match,'the revert SQL block is missing from the document');
 return match[1];
}

test('after the boundary fixture, reverting keeps Chair and public creation working beyond /100',async()=>{
 const f=await freshDatabase();
 const {db,ids,query,as,asOwner,asServer,grant}=f;
 const bnd=committeeSql(ids.conference,'BND'),tst=committeeSql(ids.conference,'TST');
 await asOwner();await db.exec(bnd.sql+tst.sql);
 await grant(chair,'chair',bnd.committee);await grant(chair,'chair',tst.committee);
 const seed=async(c:typeof bnd,prefix:string,from:number,to:number)=>{await asOwner();await db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title)
  select gen_random_uuid(),$1,$2,$3,$4,$5||' / '||lpad(g::text,greatest(2,length(g::text)),'0'),'Seed' from generate_series($6::int,$7::int) g`,[ids.conference,c.committee,c.session,c.delegates[0],prefix,from,to]);};
 const create=async(c:typeof bnd)=>{await as(chair);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,null,$5)',[ids.conference,randomUUID(),newDocumentCommand(c),'chair','2026-10-21T10:00:00Z']);};
 const submit=async(c:typeof bnd)=>{await asServer();return (await query<{r:{code:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[c.token,randomUUID(),c.delegates[0],'Protecting civilians online',googleDoc(randomUUID().replaceAll('-',''))]))[0].r.code;};
 const codes=async(c:typeof bnd)=>{await asOwner();return (await query<{code:string}>('select code from public.documents where committee_id=$1',[c.committee])).map(r=>r.code);};

 // Post-test state: BND 01..98 seeded, then Chair 99, public 100, Chair 101 (migration 27 applied).
 await seed(bnd,'BND',1,98);await create(bnd);assert.equal(await submit(bnd),'BND / 100');await create(bnd);
 // TST: sequential 01..03 plus legacy hex codes.
 await seed(tst,'TST',1,3);await seed(tst,'TST',7,7);
 await asOwner();await db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values(gen_random_uuid(),$1,$2,$3,$4,'TST / ca7640bb','Legacy')`,[ids.conference,tst.committee,tst.session,tst.delegates[0]]);
 const before=(await codes(bnd)).length;
 assert.ok((await codes(bnd)).includes('BND / 101'));

 await asOwner();
 const pre=await query<{m:string}>(`select md5(pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure)) m`);
 await db.exec(await revertSql());
 const post=await query<{m:string}>(`select md5(pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure)) m`);
 assert.notEqual(pre[0].m,post[0].m,'apply_mutation is restored (it no longer calls the helper)');

 // Chair path is back to the legacy hex code; public path continues beyond 100 without truncating and without hanging.
 const started=Date.now();
 await create(bnd);
 const hex=(await codes(bnd)).filter(c=>/^BND \/ [0-9a-f]{8}$/.test(c));
 assert.equal(hex.length,1,'the reverted Chair path numbers with the legacy 8-character suffix');
 const first=await submit(bnd),second=await submit(bnd);
 assert.match(first,/^BND \/ \d{3,}$/);assert.notEqual(first,second);
 const all=await codes(bnd);assert.equal(new Set(all).size,all.length,'no duplicate code');
 assert.equal(all.length,before+3);
 assert.ok(Date.now()-started<10000,'no loop hang');
 // TST: public submission skips every code already in use (sequential gap and hex), it does not collide.
 const t=await submit(tst);assert.match(t,/^TST \/ \d{2,}$/);
 const tAll=await codes(tst);assert.equal(new Set(tAll).size,tAll.length);
 // ACL unchanged by the revert.
 await asOwner();
 const acl=await query<{proname:string;acl:string}>(`select proname,proacl::text acl from pg_proc where proname in ('apply_mutation','submit_resolution') order by 1`);
 assert.deepEqual(acl.map(r=>r.acl),['{postgres=X/postgres,authenticated=X/postgres}','{postgres=X/postgres,service_role=X/postgres}']);
});
