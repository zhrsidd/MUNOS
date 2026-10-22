import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {postgresBackend,sqlDir} from './helpers/cleanup-backend';
import {populateSql,fixtureIds} from './helpers/cleanup-fixture';
import {buildScript,parseReport} from '../scripts/cleanup/engine';

test('committed cleanup with a lost acknowledgement reports unknown and retains reconciliation evidence',{skip:!process.env.TEST_POSTGRES_URL,timeout:240000},async()=>{
 const b=await postgresBackend(process.env.TEST_POSTGRES_URL!);
 const dir=await mkdtemp(join(tmpdir(),'cleanup-unknown-'));
 try{
  const S=fixtureIds('syn').conference,R=fixtureIds('real').conference;
  await b.exec(populateSql('syn',{name:'LOAD TEST · unknown outcome'})+populateSql('real',{name:'DCMUN 2026'}));
  const dry=parseReport(await b.runner.run(await buildScript(sqlDir,{mode:'dry-run',label:'local',ids:[S],protectedIds:[R]})));
  const shim=join(dir,'lost-ack.cjs');
  await writeFile(shim,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process'); const r=spawnSync(${JSON.stringify(process.env.PSQL_BIN??'psql')},process.argv.slice(2),{stdio:'inherit'}); if(r.status===0){process.stderr.write('connection lost after server commit\\n');process.exit(2);} process.exit(r.status??1);\n`);
  await chmod(shim,0o700);
  await writeFile(join(dir,'.env.local'),`NEXT_PUBLIC_CONFERENCE_ID=${R}\n`);
  const repo=resolve('.'),out=join(dir,'evidence');
  const env:NodeJS.ProcessEnv={...process.env,PSQL_BIN:shim};
  delete env.NEXT_PUBLIC_CONFERENCE_ID;delete env.PROTECTED_CONFERENCE_IDS;
  const result=await new Promise<{code:number;stderr:string}>(done=>execFile(join(repo,'node_modules/.bin/tsx'),['--tsconfig',join(repo,'tsconfig.json'),join(repo,'scripts/cleanup-synthetic.mts'),'--local-url',b.url!,'--conference',S,'--execute','--token',dry.token,'--backup-evidence','local-test','--owner-approval','local-test','--out',out],{cwd:dir,env,timeout:120000},(e,_o,stderr)=>done({code:e?1:0,stderr})));
  assert.equal(result.code,1);assert.match(result.stderr,/outcome is unknown/);assert.match(result.stderr,/Do not retry execution/);
  assert.doesNotMatch(result.stderr,/nothing was deleted|transaction was rolled back/i);
  assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,0,'the deletion actually committed');
  const evidence=JSON.parse(await readFile(join(out,'execute-unknown.json'),'utf8'));
  assert.equal(evidence.outcome,'unknown');assert.deepEqual(evidence.requested_ids,[S]);
  assert.equal(evidence.candidate_report.status,'deleted');assert.equal(evidence.token,dry.token);
 }finally{await rm(dir,{recursive:true,force:true});await b.close();}
});
