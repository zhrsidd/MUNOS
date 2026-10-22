import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {postgresBackend,snapshot,globalSnapshot} from './helpers/cleanup-backend';
import {fixtureIds,populateSql} from './helpers/cleanup-fixture';

// The real wrapper process driving the real psql client against a disposable PostgreSQL 17 server (loopback, database munos_test_*).
// Skipped without TEST_POSTGRES_URL. No hosted project is involved: --local-url accepts only loopback and a munos_test_* database.
const localUrl=process.env.TEST_POSTGRES_URL;
const repo=resolve('.');
const tsx=join(repo,'node_modules/.bin/tsx');
const SYN='LOAD TEST · multi-committee · 2 committees';

test('wrapper end to end on PostgreSQL 17: dry run, token, execute, audit evidence, re-run',{skip:!localUrl,timeout:240000},async()=>{
 const b=await postgresBackend(localUrl!);
 const dir=await mkdtemp(join(tmpdir(),'cleanup-wrapper-'));
 try{
  const S=fixtureIds('syn').conference,R=fixtureIds('real').conference;
  await b.exec(populateSql('syn',{name:SYN,storage:true}));await b.exec(populateSql('real',{name:'DCMUN 2026'}));
  await writeFile(join(dir,'.env.local'),`NEXT_PUBLIC_CONFERENCE_ID=${R}\n`);
  const before={r:await snapshot(b,R),g:await globalSnapshot(b)};
  const wrapper=(args:string[])=>new Promise<{code:number;stdout:string;stderr:string}>(done=>{
   const env={...process.env};for(const k of ['STAGING_SUPABASE_REFS','EXPECTED_SUPABASE_REF','NEXT_PUBLIC_CONFERENCE_ID','PROTECTED_CONFERENCE_IDS','SUPABASE_DB_URL'])delete env[k];
   execFile(tsx,['--tsconfig',join(repo,'tsconfig.json'),join(repo,'scripts/cleanup-synthetic.mts'),'--local-url',b.url!,...args],{cwd:dir,timeout:120000,env},(e,stdout,stderr)=>done({code:e?(typeof (e as {code?:unknown}).code==='number'?(e as {code:number}).code:1):0,stdout,stderr}));
  });
  // Dry run is the default: it reports and changes nothing.
  const first=await wrapper(['--conference',S]);
  assert.equal(first.code,0,first.stderr);assert.match(first.stdout,/DRY RUN \(nothing changed\) against local: ready/);
  const token=/Confirmation token[^\n]*\n\s+([0-9a-f]{64})/.exec(first.stdout)?.[1];assert.ok(token,'the dry run prints the token');
  assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,1);
  // A protected id, a wrong token and missing approvals delete nothing.
  const protectedRun=await wrapper(['--conference',R]);assert.equal(protectedRun.code,2);assert.match(protectedRun.stderr,/is protected/);
  const wrong=await wrapper(['--conference',S,'--execute','--token','0'.repeat(64),'--backup-evidence','b','--owner-approval','o']);
  assert.equal(wrong.code,2);assert.match(wrong.stderr,/does not match the current dry run/);
  const noApproval=await wrapper(['--conference',S,'--execute','--token',token!,'--backup-evidence','b']);assert.equal(noApproval.code,2);
  assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,1);
  // Execute with the reviewed token.
  const done=await wrapper(['--conference',S,'--execute','--token',token!,'--backup-evidence','PITR recorded: evidence/01','--owner-approval','owner approval: evidence/02']);
  assert.equal(done.code,0,done.stderr);assert.match(done.stdout,/EXECUTED against local: deleted/);assert.match(done.stdout,/NOT deleted/);
  assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,0);
  assert.deepEqual({r:await snapshot(b,R),g:await globalSnapshot(b)},before);
  // Evidence: a dry-run file, an audit file with the operator's recorded references, the Storage keys and the Auth candidates.
  const runs=await readdir(join(dir,'.test-sessions/cleanup'));assert.equal(runs.length,2);
  const files=await Promise.all(runs.map(r=>readdir(join(dir,'.test-sessions/cleanup',r))));
  const auditRun=runs[files.findIndex(f=>f.includes('execute-audit.json'))];
  const audit=JSON.parse(await readFile(join(dir,'.test-sessions/cleanup',auditRun,'execute-audit.json'),'utf8'));
  assert.equal(audit.status,'deleted');assert.equal(audit.operator.backup_evidence,'PITR recorded: evidence/01');
  assert.equal((await readFile(join(dir,'.test-sessions/cleanup',auditRun,'storage-keys.txt'),'utf8')).trim().split('\n').length,3,'one database key plus two bucket objects');
  // Re-run is idempotent: nothing to delete, and the old token is dead.
  const again=await wrapper(['--conference',S]);assert.equal(again.code,0,again.stderr);assert.match(again.stdout,/nothing_to_delete/);
  const replay=await wrapper(['--conference',S,'--execute','--token',token!,'--backup-evidence','b','--owner-approval','o']);
  assert.equal(replay.code,2);assert.match(replay.stderr,/does not match/);
  assert.deepEqual(await snapshot(b,R),before.r);
 }finally{await rm(dir,{recursive:true,force:true});await b.close();}
});
