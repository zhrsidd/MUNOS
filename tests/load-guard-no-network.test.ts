import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Runs the real operator scripts as child processes in a throwaway directory, with every network attempt (fetch, sockets, DNS)
// recorded and blocked. A refusal must happen with ZERO attempts; a valid fixture must reach the network (positive control).
const repo=resolve('.');
const tsx=join(repo,'node_modules/.bin/tsx');
const preload=join(repo,'tests/helpers/no-network.mjs');
const REF='abcdefghijklmnopqrst';
const PROTECTED='0331ceb6-3fa8-4731-92cb-2b4c0316d0cb';
const SYNTHETIC='8f5f0b28-17e6-4e91-998d-41556d4afa28';

/** protectedLine: the NEXT_PUBLIC_CONFERENCE_ID line of .env.local (null = absent). */
async function workdir(fixtureConference:unknown,protectedLine:string|null=`NEXT_PUBLIC_CONFERENCE_ID=${PROTECTED}`){
 const dir=await mkdtemp(join(tmpdir(),'load-guard-'));
 await mkdir(join(dir,'.test-sessions'),{recursive:true});await mkdir(join(dir,'supabase'),{recursive:true});
 await writeFile(join(dir,'.env.local'),[`NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co`,'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test',`STAGING_SUPABASE_REFS=${REF}`,...(protectedLine===null?[]:[protectedLine])].join('\n'));
 await writeFile(join(dir,'supabase/fixture-ids.json'),'{}');
 await writeFile(join(dir,'.test-sessions/development.json'),JSON.stringify({access_token:'x',refresh_token:'y',user:{id:'11111111-1111-4111-8111-111111111111'}}));
 const fixture={conference:fixtureConference,committees:[{id:'22222222-2222-4222-8222-222222222222',session:'33333333-3333-4333-8333-333333333333',code:'GA1'}],delegates:[]};
 await writeFile(join(dir,'.test-sessions/load-fixtures.json'),JSON.stringify(fixture));
 return dir;
}
function run(dir:string,script:string,args:string[]){
 return new Promise<{code:number;stderr:string;stdout:string}>(done=>{
  // The child's configuration comes only from the throwaway .env.local: drop any ambient values (they would override it).
  const env={...process.env};for(const key of ['STAGING_SUPABASE_REFS','DEVELOPMENT_SUPABASE_REFS','EXPECTED_SUPABASE_REF','NEXT_PUBLIC_CONFERENCE_ID','PROTECTED_CONFERENCE_IDS','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])delete env[key];
  execFile(tsx,['--tsconfig',join(repo,'tsconfig.json'),'--import',preload,join(repo,script),...args],{cwd:dir,timeout:60000,env},(error,stdout,stderr)=>done({code:error?(typeof (error as {code?:unknown}).code==='number'?(error as {code:number}).code:1):0,stdout,stderr}));
 });
}
const attempts=(stderr:string)=>stderr.split('\n').filter(l=>l.startsWith('NETWORK '));
const scripts:[string,string[]][]=[
 ['scripts/rehearsal-run.mts',['--app','http://localhost:3999']],
 ['scripts/rehearsal-snapshots.mts',['--identities','.test-sessions/none.json']],
 ['scripts/load-test.mts',[]],
];
// [fixture conference, NEXT_PUBLIC_CONFERENCE_ID line]
const refusals:[unknown,string|null][]=[
 [PROTECTED,`NEXT_PUBLIC_CONFERENCE_ID=${PROTECTED}`],
 [PROTECTED.toUpperCase(),`NEXT_PUBLIC_CONFERENCE_ID=${PROTECTED}`],
 ['not-a-uuid',`NEXT_PUBLIC_CONFERENCE_ID=${PROTECTED}`],
 [undefined,`NEXT_PUBLIC_CONFERENCE_ID=${PROTECTED}`],
 [SYNTHETIC,null],                                  // protection configuration missing: fail closed
 [SYNTHETIC,'NEXT_PUBLIC_CONFERENCE_ID='],          // blank
 [SYNTHETIC,'NEXT_PUBLIC_CONFERENCE_ID=your-conference-uuid'], // malformed
];

for(const [script,args] of scripts){
 test(`${script}: refuses protected, malformed or unverifiable fixture/configuration with zero network requests`,async()=>{
  await Promise.all(refusals.map(async([conference,line])=>{
   const dir=await workdir(conference,line);
   try{
    const r=await run(dir,script,args);
    const label=`${script} fixture=${String(conference)} config=${String(line)}`;
    assert.notEqual(r.code,0,`must refuse: ${label}`);
    assert.match(r.stderr,/Refused/,`names the refusal: ${label}: ${r.stderr.slice(0,400)}`);
    assert.deepEqual(attempts(r.stderr),[],`network attempts before refusing: ${label}`);
   }finally{await rm(dir,{recursive:true,force:true});}
  }));
 });
}

test('positive control: the network blocker is live, and rehearsal-run reaches /api/health only after the guards pass',async()=>{
 const dir=await workdir(SYNTHETIC);
 try{
  const r=await run(dir,'scripts/rehearsal-run.mts',['--app','http://localhost:3999']);
  assert.notEqual(r.code,0);
  assert.deepEqual(attempts(r.stderr),['NETWORK fetch http://localhost:3999/api/health']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
