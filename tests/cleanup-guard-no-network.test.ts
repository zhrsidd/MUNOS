import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm,chmod,access,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Runs the real wrapper (scripts/cleanup-synthetic.mts) as a child process in a throwaway directory with every network attempt
// recorded and blocked, and with PSQL_BIN pointing at a stub that records whether it was ever started. A refusal must happen
// BEFORE any connection: zero network attempts and the stub never started. Valid input must reach the stub (positive control).
const repo=resolve('.');
const tsx=join(repo,'node_modules/.bin/tsx');
const preload=join(repo,'tests/helpers/no-network.mjs');
const script='scripts/cleanup-synthetic.mts';
const REF='kllhswucdhqqywnzxado';
const OTHER_REF='tsrqponmlkjihgfedcba';
const PHESMUN='gglltljhdpkfjnyjmnif';
const PROTECTED='0331ceb6-3fa8-4731-92cb-2b4c0316d0cb';
const EXTRA_PROTECTED='1d3c2b1a-0000-4000-8000-00000000000a';
const SYNTHETIC='8f5f0b28-17e6-4e91-998d-41556d4afa28';
const TOKEN='a'.repeat(64);
const PASSWORD='s3cretpassw0rd';
const poolerUrl=(ref:string)=>`postgresql://postgres.${ref}:${PASSWORD}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const CANNED={kind:'dry-run',status:'ready',label:REF,token:'b'.repeat(64),conferences:[{id:SYNTHETIC,name:'LOAD TEST · x',venue:'Development only'}],absent_ids:[],kept_conferences:[{id:PROTECTED,name:'DCMUN 2026',venue:'Doha',created_at:'2026-10-05T00:00:00Z'}],
 tables:[{seq:1,table:'public.schools',kind:'delete',rows:1,exact:true,fingerprint:'x'},{seq:43,table:'public.conferences',kind:'delete',rows:1,exact:true,fingerprint:'y'}],total_rows_deleted_if_executed:2,
 storage:{document_version_keys:['k/1'],bucket_objects:[]},auth_user_candidates:['11111111-1111-4111-8111-111111111111'],auth_users_kept_because_referenced_elsewhere:0};

interface Options{env?:Record<string,string|null>;noEnvFile?:boolean;stub?:'ok'|'refuse'|'execute'}
async function workdir(o:Options={}){
 const dir=await mkdtemp(join(tmpdir(),'cleanup-guard-'));
 const base:Record<string,string|null>={NEXT_PUBLIC_SUPABASE_URL:`https://${REF}.supabase.co`,STAGING_SUPABASE_REFS:REF,NEXT_PUBLIC_CONFERENCE_ID:PROTECTED,PROTECTED_CONFERENCE_IDS:EXTRA_PROTECTED,SUPABASE_DB_URL:poolerUrl(REF),...o.env};
 if(!o.noEnvFile)await writeFile(join(dir,'.env.local'),Object.entries(base).filter(([,v])=>v!==null).map(([k,v])=>`${k}=${v}`).join('\n'));
 const report=JSON.stringify(o.stub==='execute'?{...CANNED,kind:'execute',status:'deleted',total_rows_deleted:2,tables:CANNED.tables.map(t=>({seq:t.seq,table:t.table,kind:t.kind,expected:1,affected:1}))}:CANNED);
 const body=o.stub==='refuse'?`echo "psql:-:12: ERROR:  REFUSED: conference ${SYNTHETIC} is not marked synthetic" >&2\nexit 3`:`cat >/dev/null\nprintf 'MUNOS_CLEANUP_JSON %s\\n' '${report}'`;
 await writeFile(join(dir,'psql-stub.sh'),`#!/bin/sh\ntouch "${join(dir,'psql-started')}"\n${body}\n`);await chmod(join(dir,'psql-stub.sh'),0o755);
 return dir;
}
function run(dir:string,args:string[],extraEnv:Record<string,string>={}){
 return new Promise<{code:number;stderr:string;stdout:string}>(done=>{
  // Configuration comes only from the throwaway .env.local: drop ambient values (they would override it).
  const env={...process.env};for(const key of ['STAGING_SUPABASE_REFS','DEVELOPMENT_SUPABASE_REFS','EXPECTED_SUPABASE_REF','NEXT_PUBLIC_CONFERENCE_ID','PROTECTED_CONFERENCE_IDS','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_DB_URL','PSQL_BIN'])delete env[key];
  execFile(tsx,['--tsconfig',join(repo,'tsconfig.json'),'--import',preload,join(repo,script),...args],{cwd:dir,timeout:60000,env:{...env,PSQL_BIN:join(dir,'psql-stub.sh'),...extraEnv}},(error,stdout,stderr)=>done({code:error?(typeof (error as {code?:unknown}).code==='number'?(error as {code:number}).code:1):0,stdout,stderr}));
 });
}
const attempts=(stderr:string)=>stderr.split('\n').filter(l=>l.startsWith('NETWORK '));
const exists=(p:string)=>access(p).then(()=>true,()=>false);
const dry=(...ids:string[])=>ids.flatMap(i=>['--conference',i]);
const exec=['--execute','--token',TOKEN,'--backup-evidence','PITR snapshot recorded in evidence/01','--owner-approval','owner message 2026-11-02'];

// [label, options, args]
const refusals:[string,Options,string[]][]=[
 ['no ids',{},[]],
 ['blank id list',{},['--conferences',' , ']],
 ['malformed id',{},dry('not-a-uuid')],
 ['duplicate id',{},dry(SYNTHETIC,SYNTHETIC.toUpperCase())],
 ['unknown flag',{},[...dry(SYNTHETIC),'--force']],
 ['duplicate output directory',{},[...dry(SYNTHETIC),...exec,'--out','a','--out','b']],
 ['positional argument',{},[...dry(SYNTHETIC),'all']],
 ['flag without a value',{},['--conference']],
 ['pattern selection is not a thing',{},['--all']],
 ['id equals NEXT_PUBLIC_CONFERENCE_ID',{},dry(PROTECTED)],
 ['id equals NEXT_PUBLIC_CONFERENCE_ID in upper case',{},dry(PROTECTED.toUpperCase())],
 ['id in PROTECTED_CONFERENCE_IDS',{},dry(SYNTHETIC,EXTRA_PROTECTED)],
 ['protected conference not configured',{env:{NEXT_PUBLIC_CONFERENCE_ID:null}},dry(SYNTHETIC)],
 ['protected conference blank',{env:{NEXT_PUBLIC_CONFERENCE_ID:''}},dry(SYNTHETIC)],
 ['protected conference placeholder',{env:{NEXT_PUBLIC_CONFERENCE_ID:'your-conference-uuid'}},dry(SYNTHETIC)],
 ['PROTECTED_CONFERENCE_IDS malformed',{env:{PROTECTED_CONFERENCE_IDS:'nope'}},dry(SYNTHETIC)],
 ['no .env.local',{noEnvFile:true},dry(SYNTHETIC)],
 ['project not on the allow-list',{env:{STAGING_SUPABASE_REFS:OTHER_REF}},dry(SYNTHETIC)],
 ['no allow-list at all',{env:{STAGING_SUPABASE_REFS:''}},dry(SYNTHETIC)],
 ['production-classified project',{env:{STAGING_SUPABASE_REFS:'',EXPECTED_SUPABASE_REF:REF}},dry(SYNTHETIC)],
 ['production and staging both name the project',{env:{EXPECTED_SUPABASE_REF:REF}},dry(SYNTHETIC)],
 ['PHESMUN production project',{env:{NEXT_PUBLIC_SUPABASE_URL:`https://${PHESMUN}.supabase.co`,STAGING_SUPABASE_REFS:PHESMUN,SUPABASE_DB_URL:poolerUrl(PHESMUN)}},dry(SYNTHETIC)],
 ['supabase url missing',{env:{NEXT_PUBLIC_SUPABASE_URL:null}},dry(SYNTHETIC)],
 ['supabase url malformed',{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.com'}},dry(SYNTHETIC)],
 ['database url missing',{env:{SUPABASE_DB_URL:null}},dry(SYNTHETIC)],
 ['database url names another project',{env:{SUPABASE_DB_URL:poolerUrl(OTHER_REF)}},dry(SYNTHETIC)],
 ['database url on a foreign host',{env:{SUPABASE_DB_URL:`postgresql://postgres:${PASSWORD}@db.example.com:5432/postgres`}},dry(SYNTHETIC)],
 ['database url direct host of another project',{env:{SUPABASE_DB_URL:`postgresql://postgres:${PASSWORD}@db.${OTHER_REF}.supabase.co:5432/postgres`}},dry(SYNTHETIC)],
 ['execute without a token',{},[...dry(SYNTHETIC),'--execute','--backup-evidence','x','--owner-approval','y']],
 ['execute with a malformed token',{},[...dry(SYNTHETIC),'--execute','--token','abc','--backup-evidence','x','--owner-approval','y']],
 ['execute without backup evidence',{},[...dry(SYNTHETIC),'--execute','--token',TOKEN,'--owner-approval','y']],
 ['execute without owner approval',{},[...dry(SYNTHETIC),'--execute','--token',TOKEN,'--backup-evidence','x']],
 ['token given to a dry run',{},[...dry(SYNTHETIC),'--token',TOKEN]],
 ['execute against the protected conference',{},[...dry(PROTECTED),...exec]],
 ['execute against a production-classified project',{env:{STAGING_SUPABASE_REFS:'',EXPECTED_SUPABASE_REF:REF}},[...dry(SYNTHETIC),...exec]],
 ['local url not on loopback',{},[...dry(SYNTHETIC),'--local-url','postgresql://postgres@db.example.com:5432/munos_test_abc']],
 ['local url to a database not named munos_test_*',{},[...dry(SYNTHETIC),'--local-url','postgresql://postgres@127.0.0.1:5432/postgres']],
 ['local url malformed',{},[...dry(SYNTHETIC),'--local-url','garbage']],
];

// The specific reason each case must be refused for (a refusal for the wrong reason would hide a hole).
const reasons:Record<string,RegExp>={
 'duplicate output directory':/--out was given more than once/,
 'no ids':/no conference ids/,'blank id list':/no conference ids/,'malformed id':/not a UUID/,'duplicate id':/listed twice/,'unknown flag':/unknown argument --force/,
 'positional argument':/positional arguments/,'flag without a value':/needs a value/,'pattern selection is not a thing':/unknown argument --all/,
 'id equals NEXT_PUBLIC_CONFERENCE_ID':/is protected/,'id equals NEXT_PUBLIC_CONFERENCE_ID in upper case':/is protected/,'id in PROTECTED_CONFERENCE_IDS':/is protected/,
 'protected conference not configured':/NEXT_PUBLIC_CONFERENCE_ID is missing/,'protected conference blank':/NEXT_PUBLIC_CONFERENCE_ID is missing/,'protected conference placeholder':/NEXT_PUBLIC_CONFERENCE_ID is missing/,
 'PROTECTED_CONFERENCE_IDS malformed':/PROTECTED_CONFERENCE_IDS contains/,'no .env.local':/\.env\.local could not be read/,
 'project not on the allow-list':/not listed in STAGING_SUPABASE_REFS/,'no allow-list at all':/not listed in STAGING_SUPABASE_REFS/,
 'production-classified project':/is the production project/,'production and staging both name the project':/exactly one role/,'PHESMUN production project':/PHESMUN production project/,
 'supabase url missing':/NEXT_PUBLIC_SUPABASE_URL is not set/,'supabase url malformed':/not a hosted Supabase project URL/,
 'database url missing':/SUPABASE_DB_URL is not set/,'database url names another project':/names project tsrqponmlkjihgfedcba/,'database url on a foreign host':/not a Supabase Postgres URL/,'database url direct host of another project':/names project tsrqponmlkjihgfedcba/,
 'execute without a token':/needs --token/,'execute with a malformed token':/needs --token/,'execute without backup evidence':/--backup-evidence/,'execute without owner approval':/--owner-approval/,'token given to a dry run':/apply only with --execute/,
 'execute against the protected conference':/is protected/,'execute against a production-classified project':/is the production project/,
 'local url not on loopback':/must be on loopback/,'local url to a database not named munos_test_*':/must be named munos_test_/,'local url malformed':/not a URL/,
};

test('every refusal case has an expected reason',()=>{assert.deepEqual(refusals.map(r=>r[0]).filter(l=>!reasons[l]),[]);assert.equal(Object.keys(reasons).length,refusals.length);});

test('the wrapper refuses every unsafe invocation with zero network attempts, no database process and no secret in the output',async()=>{
 await Promise.all(refusals.map(async([label,options,args])=>{
  const dir=await workdir(options);
  try{
   const r=await run(dir,args);
   assert.notEqual(r.code,0,`must refuse: ${label}`);
   assert.match(r.stderr,/Refused/,`names the refusal: ${label}: ${r.stderr.slice(0,300)}`);
   assert.match(r.stderr,reasons[label]??/^$/,`refused for the wrong reason: ${label}`);
   assert.deepEqual(attempts(r.stderr),[],`network attempts before refusing: ${label}`);
   assert.equal(await exists(join(dir,'psql-started')),false,`database client started before refusing: ${label}`);
   assert.ok(!(r.stderr+r.stdout).includes(PASSWORD),`secret printed: ${label}`);
   assert.equal(await exists(join(dir,'.test-sessions')),false,`evidence written for a refusal: ${label}`);
  }finally{await rm(dir,{recursive:true,force:true});}
 }));
});

test('positive control: a valid dry run starts the database client only after the guards pass, defaults to dry-run and prints a token but no secret',async()=>{
 const dir=await workdir();
 try{
  const r=await run(dir,dry(SYNTHETIC));
  assert.equal(r.code,0,r.stderr);
  assert.ok(await exists(join(dir,'psql-started')),'the stub database client was reached');
  assert.match(r.stdout,/DRY RUN \(nothing changed\)/);assert.match(r.stdout,/conferences that stay \(1\): "DCMUN 2026"/);assert.ok(r.stdout.includes('b'.repeat(64)),'prints the confirmation token');
  assert.ok(!(r.stdout+r.stderr).includes(PASSWORD));assert.deepEqual(attempts(r.stderr),[]);
  const runs=await readdir(join(dir,'.test-sessions/cleanup'));assert.equal(runs.length,1);assert.ok(runs[0].endsWith(`-${REF}`));
  const evidence=join(dir,'.test-sessions/cleanup',runs[0]);
  assert.equal((await stat(join(evidence,'dry-run.json'))).mode&0o777,0o600);
  assert.equal((await readFile(join(evidence,'storage-keys.txt'),'utf8')).trim(),'resolutions-db\tk/1');
  assert.ok(!(await readFile(join(evidence,'dry-run.json'),'utf8')).includes(PASSWORD));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('positive control: --execute with the token and recorded approvals reaches the database client and writes the audit file',async()=>{
 const dir=await workdir({stub:'execute'});
 try{
  const r=await run(dir,[...dry(SYNTHETIC),...exec]);
  assert.equal(r.code,0,r.stderr);
  assert.ok(await exists(join(dir,'psql-started')));
  assert.match(r.stdout,/EXECUTED against kllhswucdhqqywnzxado: deleted/);assert.match(r.stdout,/NOT deleted/);
  const [name]=await readdir(join(dir,'.test-sessions/cleanup'));
  const audit=JSON.parse(await readFile(join(dir,'.test-sessions/cleanup',name,'execute-audit.json'),'utf8'));
  assert.equal(audit.operator.backup_evidence,'PITR snapshot recorded in evidence/01');assert.equal(audit.operator.owner_approval,'owner message 2026-11-02');
  assert.deepEqual(audit.requested_ids,[SYNTHETIC]);assert.ok(!JSON.stringify(audit).includes(PASSWORD));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a refusal raised inside the database transaction is reported as a refusal, not a crash, and writes no evidence',async()=>{
 const dir=await workdir({stub:'refuse'});
 try{
  const r=await run(dir,dry(SYNTHETIC));
  assert.equal(r.code,2);assert.match(r.stderr,/Refused: conference .* is not marked synthetic/);
  assert.equal(await exists(join(dir,'.test-sessions')),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('positive control: the network blocker is live',async()=>{
 const r=await new Promise<string>(done=>execFile(process.execPath,['--import',preload,'-e',"fetch('http://localhost:3999/x').catch(()=>{})"],{timeout:20000},(_e,_o,stderr)=>done(stderr)));
 assert.deepEqual(attempts(r),['NETWORK fetch http://localhost:3999/x']);
});
