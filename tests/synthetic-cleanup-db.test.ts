import test from 'node:test';
import assert from 'node:assert/strict';
import {assemble,buildScript,parseConferenceIds,parseReport,type Mode,type Report} from '../scripts/cleanup/engine';
import {backends,globalSnapshot,snapshot,sqlDir,type Backend} from './helpers/cleanup-backend';
import {fixtureIds,populateSql,uid,type FixtureOptions} from './helpers/cleanup-fixture';

// The guarded synthetic-conference deletion, proven on embedded PGlite and (with TEST_POSTGRES_URL) a real PostgreSQL 17 server.
// Nothing here touches a hosted project: both engines are disposable and local.
const SYN='LOAD TEST · multi-committee · 2 committees';
const REAL='DCMUN 2026';
const SHARED='99999999-9999-4999-8999-999999999999';
const NOBODY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hex=/^[0-9a-f]{64}$/;

const add=(b:Backend,tag:string,o:Partial<FixtureOptions>&{name:string})=>b.exec(populateSql(tag,{sharedUser:SHARED,...o}));
const id=(tag:string)=>fixtureIds(tag).conference;
const run=async(b:Backend,mode:Mode,ids:string[],protectedIds:string[],token?:string,label='local')=>parseReport(await b.runner.run(await buildScript(sqlDir,{mode,label,ids,protectedIds,token})));
const dry=(b:Backend,ids:string[],protectedIds:string[],label?:string)=>run(b,'dry-run',ids,protectedIds,undefined,label);
const refused=(promise:Promise<unknown>,pattern:RegExp)=>assert.rejects(promise,(e:Error)=>{assert.match(e.message,pattern);return true;});
const sorted=<T,>(v:T[])=>[...v].sort();

for(const [label,make,skip] of backends){
 const t=(name:string,fn:(b:Backend)=>Promise<void>)=>test(`${label}: ${name}`,{skip,timeout:240000},async()=>{const b=await make();try{await fn(b);}finally{await b.close();}});

 t('dry run reports exactly the named conference, per table, with Storage keys and Auth candidates, and changes nothing',async b=>{
  await add(b,'syn',{name:SYN,storage:true});await add(b,'other',{name:SYN+' (not listed)'});await add(b,'real',{name:REAL});
  const [S,O,R]=[id('syn'),id('other'),id('real')];
  const before={s:await snapshot(b,S),o:await snapshot(b,O),r:await snapshot(b,R),g:await globalSnapshot(b)};
  // Every public and private table is populated for the synthetic conference: the fixture exercises the whole schema.
  for(const [table,snap] of Object.entries(before.s))assert.ok(snap.n>0,`fixture leaves ${table} empty`);

  const report=await dry(b,[S],[R]);
  assert.equal(report.kind,'dry-run');assert.equal(report.status,'ready');assert.match(report.token,hex);
  assert.deepEqual(report.conferences.map(c=>c.id),[S]);assert.deepEqual(report.absent_ids,[]);
  // Counts equal an independent, catalogue-derived count of the synthetic conference's rows.
  const deletes=report.tables.filter(r=>r.kind==='delete');
  assert.equal(deletes.length,Object.keys(before.s).length,'one delete rule per table');
  for(const row of deletes)assert.equal(row.rows,before.s[row.table].n,`${row.table} count`);
  assert.equal(report.total_rows_deleted_if_executed,Object.values(before.s).reduce((a,x)=>a+x.n,0));
  assert.equal(report.tables.find(r=>r.kind==='update')!.rows,1,'one committee has a current session to detach');
  // Storage: the key recorded in the database, plus the object and an orphan that exist under the conference prefix.
  const key=`${S}/${fixtureIds('syn').committee}/${uid('syn','doc')}/resolution.pdf`;
  assert.deepEqual(report.storage.document_version_keys,[key]);
  assert.deepEqual(sorted(report.storage.bucket_objects.map(o=>o.key)),sorted([key,key.replace('resolution.pdf','orphan.pdf')]));
  assert.ok(report.storage.bucket_objects.every(o=>o.bucket==='resolutions'&&o.key.startsWith(`${S}/`)));
  // Auth users only the named conference references; the user shared with another conference is kept.
  assert.deepEqual(sorted(report.auth_user_candidates),sorted(['user-chair','user-exec','user-device','user-staff'].map(n=>uid('syn',n))));
  assert.ok(!report.auth_user_candidates.includes(SHARED));
  // Deterministic, and read only: nothing changed.
  assert.equal((await dry(b,[S],[R])).token,report.token);
  assert.deepEqual({s:await snapshot(b,S),o:await snapshot(b,O),r:await snapshot(b,R),g:await globalSnapshot(b)},before);
  // The dry run cannot write even if a statement is appended to it.
  const script=await assemble(sqlDir,{mode:'dry-run',label:'local',ids:S,protected:R},'dry-run');
  await refused(b.runner.run(script.replace(/rollback;\s*$/,'delete from public.schools;\nrollback;')),/read-only/i);
  assert.deepEqual(await snapshot(b,S),before.s);
 });

 t('hard refusals: empty list, protected, not synthetic, flagged real, active access, bad input',async b=>{
  await add(b,'syn',{name:SYN});await add(b,'real',{name:REAL});
  await add(b,'flag',{name:SYN,features:{real:true}});
  await add(b,'lower',{name:'load test · lower case'});await add(b,'mid',{name:'Copy of '+SYN});
  await add(b,'prefix',{name:'DCMUN Development Test'});
  const kinds=['grant','credential','submission link','amendment link'] as const;
  for(const k of kinds)await add(b,`act${kinds.indexOf(k)}`,{name:SYN,active:k});
  const [S,R]=[id('syn'),id('real')];
  const before={s:await snapshot(b,S),r:await snapshot(b,R),g:await globalSnapshot(b)};
  const raw=(settings:Record<string,string>,mode:Mode='dry-run')=>assemble(sqlDir,{mode,label:'local',ids:S,protected:R,...settings},mode).then(s=>b.runner.run(s));

  // Empty list: refused by the engine, and (defence in depth) by the SQL on its own.
  assert.equal(parseConferenceIds([]).ok,false);assert.equal(parseConferenceIds([' , ']).ok,false);
  await assert.rejects(buildScript(sqlDir,{mode:'dry-run',label:'local',ids:[],protectedIds:[R]}),/invalid ids/);
  await refused(raw({ids:''}),/no conference ids/);
  await refused(raw({ids:' '}),/no conference ids/);
  // Malformed or duplicated ids.
  for(const bad of ['not-a-uuid',S.toUpperCase(),`${S},${S}`,`${S},xyz`])await refused(raw({ids:bad}),/REFUSED/);
  assert.equal(parseConferenceIds([`${S},${S}`]).ok,false);assert.equal(parseConferenceIds(['nope']).ok,false);
  // Protected: listed id equals a protected id; the protected list is empty, missing or malformed (fail closed).
  await refused(raw({protected:S}),/is protected/);
  await refused(raw({ids:`${S},${R}`,protected:R}),/is protected/);   // one bad id refuses the whole list
  await refused(raw({protected:''}),/protected conference list is empty/);
  await refused(raw({protected:'garbage'}),/protected conference id is not/);
  await refused(assemble(sqlDir,{mode:'dry-run',label:'local',ids:S},'dry-run').then(s=>b.runner.run(s)),/protected conference list is empty/);
  // Not synthetic: the real-looking conference, case and position of the prefix, and an unmarked listing among marked ones.
  await refused(dry(b,[R],[S]),/is not marked synthetic/);
  await refused(dry(b,[id('lower')],[R]),/is not marked synthetic/);
  await refused(dry(b,[id('mid')],[R]),/is not marked synthetic/);
  await refused(dry(b,[S,R],[uid('x','y')]),/is not marked synthetic/);
  // Flagged real beats a synthetic name.
  await refused(dry(b,[id('flag')],[R]),/flagged real/);
  // The approved prefix 'DCMUN Development Test' is only a name rule: with active access it is still refused, and unlisted here it is not touched.
  assert.equal((await dry(b,[id('prefix')],[R])).status,'ready');
  // Active access of every kind: revoke first.
  for(const k of kinds){
   const c=id(`act${kinds.indexOf(k)}`);
   await refused(dry(b,[c],[R]),/active access remains/);
   await refused(run(b,'execute',[c],[R],'0'.repeat(64)),/active access remains/);
  }
  await refused(dry(b,[id('act0')],[R]),/1 grants, 0 credentials, 0 submission links, 0 amendment links/);
  // Mode and label.
  await refused(raw({mode:'delete'}),/unknown mode/);
  await refused(raw({label:'Bad Label!'}),/target label/);
  await refused(raw({label:''}),/target label/);
  // A role that cannot see every row is refused: counts under row-level security would silently be zero.
  await b.exec(`do $$begin if not exists(select from pg_roles where rolname='munos_plain') then create role munos_plain nologin; end if; end$$; grant usage on schema public to munos_plain;`);
  try{
   const script=await buildScript(sqlDir,{mode:'dry-run',label:'local',ids:[S],protectedIds:[R]});
   await refused(b.runner.run(`set role munos_plain;\n${script}`),/neither bypass row-level security/);
  }finally{await b.exec('drop owned by munos_plain; drop role munos_plain;').catch(()=>undefined);}
  // None of it changed anything.
  assert.deepEqual({s:await snapshot(b,S),r:await snapshot(b,R),g:await globalSnapshot(b)},before);
 });

 t('the confirmation token binds the project, the ids and the exact data; a wrong, stale or foreign token deletes nothing',async b=>{
  await add(b,'syn',{name:SYN});await add(b,'two',{name:SYN+' two'});await add(b,'real',{name:REAL});
  const [S,T,R]=[id('syn'),id('two'),id('real')];
  const before={s:await snapshot(b,S),t:await snapshot(b,T),r:await snapshot(b,R)};
  const good=await dry(b,[S],[R]);
  const exec=(ids:string[],token?:string,label?:string)=>run(b,'execute',ids,[R],token,label);
  const unchanged=async()=>assert.deepEqual({s:await snapshot(b,S),t:await snapshot(b,T),r:await snapshot(b,R)},before);
  // Missing, malformed and wrong tokens.
  await assert.rejects(buildScript(sqlDir,{mode:'execute',label:'local',ids:[S],protectedIds:[R]}),/64-hex/);
  await refused(assemble(sqlDir,{mode:'execute',label:'local',ids:S,protected:R},'execute').then(s=>b.runner.run(s)),/token is missing or malformed/);
  await refused(assemble(sqlDir,{mode:'execute',label:'local',ids:S,protected:R,token:'abc'},'execute').then(s=>b.runner.run(s)),/token is missing or malformed/);
  await refused(exec([S],'0'.repeat(64)),/does not match/);
  // A token from different input: another id list, another project label, and a dry run that listed an extra id.
  await refused(exec([S],(await dry(b,[T],[R])).token),/does not match/);
  await refused(exec([S],good.token,'other-project'),/does not match/);
  await refused(exec([S,T],good.token),/does not match/);
  assert.notEqual((await dry(b,[S],[R],'other-project')).token,good.token);
  // Stale input: the data changed after the dry run (a name, a new row, a removed row).
  for(const change of [
   `update public.delegates set name='changed' where id='${uid('syn','del-1')}';`,
   `insert into public.schools(id,conference_id,name) values ('${uid('syn','late-school')}','${S}','Late school');`,
   `delete from public.schools where id='${uid('syn','late-school')}';`,
  ]){
   const token=(await dry(b,[S],[R])).token;await b.exec(change);
   await refused(exec([S],token),/does not match/);
   assert.notEqual((await dry(b,[S],[R])).token,token);
  }
  await b.exec(`update public.delegates set name='Delegate 1' where id='${uid('syn','del-1')}';`);
  // The conference name is part of the token too.
  const named=(await dry(b,[S],[R])).token;await b.exec(`update public.conferences set name=name||' x' where id='${S}';`);
  await refused(exec([S],named),/does not match/);
  await b.exec(`update public.conferences set name='${SYN}' where id='${S}';`);
  assert.deepEqual({t:await snapshot(b,T),r:await snapshot(b,R)},{t:before.t,r:before.r});
  assert.equal((await dry(b,[S],[R])).token,good.token,'back to the reviewed state: the original token is valid again');
 });

 t('execute removes exactly the named conference, leaves every other conference byte for byte, and is idempotent',async b=>{
  await add(b,'syn',{name:SYN,storage:true,expiredUnrevoked:true});await add(b,'two',{name:SYN+' two',storage:true});await add(b,'real',{name:REAL,storage:true});
  const [S,T,R]=[id('syn'),id('two'),id('real')];
  const seed=(await b.rows<{id:string}>(`select id from public.conferences where id not in ('${S}','${T}','${R}')`)).map(r=>r.id);
  assert.ok(seed.length>=1,'the seed conference exists too');
  const keep=async()=>({t:await snapshot(b,T),r:await snapshot(b,R),seed:await Promise.all(seed.map(c=>snapshot(b,c))),g:await globalSnapshot(b)});
  const before=await keep();const beforeS=await snapshot(b,S);
  const reviewed=await dry(b,[S],[R,T]);                       // T is protected here too: listing it would be refused
  assert.equal(reviewed.status,'ready');
  const done=await run(b,'execute',[S],[R,T],reviewed.token);
  assert.equal(done.kind,'execute');assert.equal(done.status,'deleted');assert.equal(done.token,reviewed.token);
  // Per-table: every delete matched the dry run exactly (the epoch table may only exceed it), and the totals agree.
  for(const row of done.tables){
   if(row.table==='public.photo_list_epochs')assert.ok(row.affected!>=row.expected!);else assert.equal(row.affected,row.expected,`${row.table}`);
   if(row.kind==='delete'&&row.table!=='public.photo_list_epochs')assert.equal(row.affected,beforeS[row.table].n);
  }
  assert.ok(done.total_rows_deleted!>=reviewed.total_rows_deleted_if_executed!);
  // The synthetic conference is gone, in every table; including expired-but-unrevoked access.
  for(const [table,snap] of Object.entries(await snapshot(b,S)))assert.equal(snap.n,0,`${table} still has rows`);
  assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,0);
  // Everything else is byte for byte what it was, including the Auth users and Storage objects (those are separate steps).
  assert.deepEqual(await keep(),before);
  // The audit lists the Storage keys and Auth users, and says Storage was not touched.
  assert.equal(done.storage.document_version_keys.length,1);assert.equal(done.storage.bucket_objects.length,2);assert.match(done.storage.note!,/NOT deleted/);
  assert.equal(done.auth_user_candidates.length,4);
  assert.equal((await b.rows<{n:number}>(`select count(*)::int n from storage.objects where name like '${S}/%'`))[0].n,2,'Storage objects are never deleted by SQL');
  // The old token is dead (the state moved on).
  await refused(run(b,'execute',[S],[R,T],reviewed.token),/does not match/);
  // Re-run: dry run says nothing to delete (and still lists the leftover Storage objects), execute is a no-op, nothing else moves.
  const again=await dry(b,[S],[R,T]);
  assert.equal(again.status,'nothing_to_delete');assert.deepEqual(again.absent_ids,[S]);assert.equal(again.total_rows_deleted_if_executed,0);
  assert.equal(again.storage.bucket_objects.length,2);assert.equal(again.storage.document_version_keys.length,0);
  const noop=await run(b,'execute',[S],[R,T],again.token);
  assert.equal(noop.status,'nothing_to_delete');assert.equal(noop.total_rows_deleted,0);
  assert.deepEqual(await keep(),before);
  // A second run naming a present conference and the already-removed one removes only the present one.
  const both=await dry(b,[S,T],[R]);
  assert.equal(both.status,'ready');assert.deepEqual(both.absent_ids,[S]);
  const second=await run(b,'execute',[S,T],[R],both.token);
  assert.equal(second.status,'deleted');
  for(const snap of Object.values(await snapshot(b,T)))assert.equal(snap.n,0);
  assert.deepEqual(await snapshot(b,R),before.r);assert.deepEqual((await globalSnapshot(b)).authUsers,before.g.authUsers);
 });

 t('a count mismatch aborts the whole transaction: nothing is deleted',async b=>{
  await add(b,'syn',{name:SYN});await add(b,'real',{name:REAL});
  const [S,R]=[id('syn'),id('real')];
  // A trigger that makes the NEXT step (speaker_queue) find fewer rows than the dry run counted.
  await b.exec(`create function public.test_sabotage() returns trigger language plpgsql as $f$begin delete from public.speaker_queue where id='${uid('syn','queue')}'; return null; end$f$;
   create trigger test_sabotage after delete on public.attendance for each statement execute function public.test_sabotage();`);
  const before={s:await snapshot(b,S),r:await snapshot(b,R),g:await globalSnapshot(b)};
  const reviewed=await dry(b,[S],[R]);
  assert.equal(reviewed.tables.find(r=>r.table==='public.speaker_queue')!.rows,1);
  await refused(run(b,'execute',[S],[R],reviewed.token),/COUNT MISMATCH at step 19 \(public\.speaker_queue\)/);
  // Earlier steps (1-18) had already deleted rows inside the transaction: all of it is rolled back.
  assert.deepEqual({s:await snapshot(b,S),r:await snapshot(b,R),g:await globalSnapshot(b)},before);
  assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,1);
  // Remove the sabotage and the same reviewed token works: the failure left no residue.
  await b.exec('drop trigger test_sabotage on public.attendance; drop function public.test_sabotage();');
  assert.equal((await run(b,'execute',[S],[R],reviewed.token)).status,'deleted');
  assert.deepEqual(await snapshot(b,R),before.r);
 });

 t('a foreign-key violation aborts the whole transaction: nothing is deleted',async b=>{
  await add(b,'syn',{name:SYN});await add(b,'real',{name:REAL});
  const [S,R]=[id('syn'),id('real')];
  // A row of ANOTHER conference that references a synthetic document through a single-column key: the scope cannot reach it, so the delete must fail.
  await b.exec(`insert into private.resolution_submissions(id,conference_id,committee_id,link_id,document_id,google_doc_id,request_payload)
   values ('${uid('real','rsub-x')}','${R}','${fixtureIds('real').committee}','${uid('real','sublink')}','${uid('syn','doc')}','${'B'.repeat(30)}','{}');`);
  const before={s:await snapshot(b,S),r:await snapshot(b,R),g:await globalSnapshot(b)};
  const reviewed=await dry(b,[S],[R]);
  await assert.rejects(run(b,'execute',[S],[R],reviewed.token),/foreign key/i);
  assert.deepEqual({s:await snapshot(b,S),r:await snapshot(b,R),g:await globalSnapshot(b)},before);
 });

 t('schema drift is refused: a new table, a table outside public/private referencing conferences, a missing table',async b=>{
  await add(b,'syn',{name:SYN});await add(b,'real',{name:REAL});
  const [S,R]=[id('syn'),id('real')];
  const before=await snapshot(b,S);
  await b.exec('create table public.new_scoped(id uuid primary key, conference_id uuid not null references public.conferences(id));');
  await refused(dry(b,[S],[R]),/without a cleanup rule.*public\.new_scoped/);
  await refused(run(b,'execute',[S],[R],'1'.repeat(64)),/without a cleanup rule.*public\.new_scoped/);
  await b.exec('drop table public.new_scoped; create table private.unclassified(x int);');
  await refused(dry(b,[S],[R]),/without a cleanup rule.*private\.unclassified/);
  await b.exec('drop table private.unclassified; create schema extra; create table extra.t(c uuid references public.conferences(id));');
  await refused(dry(b,[S],[R]),/outside public\/private reference conferences: extra\.t/);
  await b.exec('drop schema extra cascade; alter table public.timers rename to timers_gone;');
  await refused(dry(b,[S],[R]),/(do not exist|without a cleanup rule)/);
  await b.exec('alter table public.timers_gone rename to timers;');
  assert.equal((await dry(b,[S],[R])).status,'ready');
  assert.deepEqual(await snapshot(b,S),before);
 });
}
export type {Report};
