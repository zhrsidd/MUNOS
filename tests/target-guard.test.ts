import test from 'node:test';
import assert from 'node:assert/strict';
import {assertToolTarget,checkProductionTarget,checkToolTarget,NEVER_SUPABASE_REFS,parseRefs,PHESMUN_PRODUCTION_REF,supabaseRef,targetConfig,targetProblem} from '../lib/platform/target-guard';
import {probe} from '../lib/platform/health-probe';

const PROD='prodprodprodprodprod';const STAGE='stagestagestagestage';const DEV='devdevdevdevdevdevde';const OTHER='otherotherotherother1';
const url=(ref:string)=>`https://${ref}.supabase.co`;

test('hosted URL parsing refuses credentials, ports, http, wrong hosts and malformed refs',()=>{
 assert.equal(supabaseRef(url(PROD)),PROD);
 assert.equal(supabaseRef(`${url(PROD)}/`),PROD);
 for(const bad of [undefined,'','not a url',`http://${PROD}.supabase.co`,`https://user:pw@${PROD}.supabase.co`,`https://${PROD}.supabase.co:5432`,`https://${PROD}.example.com`,'https://short.supabase.co',`https://${PROD.toUpperCase()}.supabase.co.evil.com`,`https://evil.com/${PROD}.supabase.co`])assert.equal(supabaseRef(bad),null,String(bad));
});

test('ref lists: blanks ignored, duplicates collapsed, any invalid entry is a configuration error',()=>{
 assert.deepEqual(parseRefs(` ${PROD} , ,${STAGE},${PROD}`,'X'),[PROD,STAGE]);
 assert.deepEqual(parseRefs(undefined,'X'),[]);
 assert.throws(()=>parseRefs(`${PROD},nope`,'X'),/invalid project ref/);
});

test('configuration: a project has one role; the PHESMUN production project can never be configured anywhere',()=>{
 assert.deepEqual(targetConfig({}).development,[],'no project is allowed by default; the deleted development project is not a fallback');
 assert.deepEqual(targetConfig({DEVELOPMENT_SUPABASE_REFS:DEV}).development,[DEV]);
 assert.deepEqual(targetConfig({DEVELOPMENT_SUPABASE_REFS:''}).development,[],'an explicit empty list means none');
 assert.throws(()=>targetConfig({EXPECTED_SUPABASE_REF:PROD,STAGING_SUPABASE_REFS:PROD}),/exactly one role/);
 assert.throws(()=>targetConfig({STAGING_SUPABASE_REFS:STAGE,DEVELOPMENT_SUPABASE_REFS:STAGE}),/exactly one role/);
 for(const key of ['EXPECTED_SUPABASE_REF','STAGING_SUPABASE_REFS','DEVELOPMENT_SUPABASE_REFS'])assert.throws(()=>targetConfig({[key]:PHESMUN_PRODUCTION_REF}),/forbidden project/,key);
 assert.throws(()=>targetConfig({EXPECTED_SUPABASE_REF:'bad'}),/not a valid project ref/);
});

test('production target: must equal the configured project; no expectation, a wrong project or a malformed value all refuse',()=>{
 const env={EXPECTED_SUPABASE_REF:PROD};
 assert.deepEqual(checkProductionTarget(url(PROD),env),{ok:true,ref:PROD});
 assert.equal(checkProductionTarget(url(STAGE),env).ok,false);
 assert.equal(checkProductionTarget(url(DEV),env).ok,false,'the development project is not production');
 const unset=checkProductionTarget(url(PROD),{});
 assert.equal(unset.ok,false);assert.match((unset as {reason:string}).reason,/EXPECTED_SUPABASE_REF is not set/);
 assert.equal(checkProductionTarget(undefined,env).ok,false);
 assert.equal(checkProductionTarget(url(PROD),{EXPECTED_SUPABASE_REF:'bad'}).ok,false);
 const phesmun=checkProductionTarget(url(PHESMUN_PRODUCTION_REF),{EXPECTED_SUPABASE_REF:PHESMUN_PRODUCTION_REF});
 assert.equal(phesmun.ok,false,'even if mis-set as the expectation, PHESMUN production is refused');
});

test('tools: only an explicitly listed staging or development project; never production; fail closed without a list',()=>{
 const env={EXPECTED_SUPABASE_REF:PROD,STAGING_SUPABASE_REFS:STAGE};
 assert.deepEqual(checkToolTarget(url(STAGE),env),{ok:true,ref:STAGE});
 assert.equal(checkToolTarget(url(DEV),env).ok,false,'no development project is allowed unless listed');
 assert.deepEqual(checkToolTarget(url(DEV),{...env,DEVELOPMENT_SUPABASE_REFS:DEV}),{ok:true,ref:DEV});
 assert.equal(checkToolTarget(url('opmydpozhdgkpcnjwpqb'),env).ok,false,'the deleted development project is not a fallback');
 assert.equal(checkToolTarget(url(PROD),env).ok,false,'production is never a tool target');
 assert.equal(checkToolTarget(url(OTHER),env).ok,false,'an unlisted project is refused');
 assert.equal(checkToolTarget(url(DEV),{DEVELOPMENT_SUPABASE_REFS:''}).ok,false,'no allow-list at all: refuse');
 assert.equal(checkToolTarget(url(PHESMUN_PRODUCTION_REF),env).ok,false);
 assert.equal(checkToolTarget('http://localhost:54321',env).ok,false,'only hosted projects');
 assert.equal(checkToolTarget(url(STAGE),{STAGING_SUPABASE_REFS:'bad'}).ok,false,'malformed configuration refuses');
 assert.throws(()=>assertToolTarget(url(PROD),env),/Target guard refused.*Nothing was contacted/);
 assert.equal(assertToolTarget(url(STAGE),env),STAGE);
});

test('targetProblem: PHESMUN production is always refused; Vercel Production must match; other environments pass',()=>{
 assert.equal(targetProblem(url(PHESMUN_PRODUCTION_REF),{}),'forbidden project');
 assert.equal(targetProblem(url(PHESMUN_PRODUCTION_REF),{VERCEL_ENV:'preview'}),'forbidden project');
 assert.equal(targetProblem(url(PROD),{VERCEL_ENV:'production',EXPECTED_SUPABASE_REF:PROD}),null);
 assert.ok(targetProblem(url(DEV),{VERCEL_ENV:'production',EXPECTED_SUPABASE_REF:PROD}));
 assert.ok(targetProblem(url(PROD),{VERCEL_ENV:'production'}),'production without an expectation fails closed');
 assert.equal(targetProblem(url(DEV),{VERCEL_ENV:'preview'}),null);
 assert.equal(targetProblem(url(DEV),{}),null);
 assert.ok(NEVER_SUPABASE_REFS.includes(PHESMUN_PRODUCTION_REF));
});

test('health probe: a refused target reports down and contacts nothing; an allowed target is probed',async()=>{
 let calls=0;
 const fetcher=(async()=>{calls++;return new Response('{}',{status:200});}) as typeof fetch;
 const base={NEXT_PUBLIC_DATA_BACKEND:'supabase',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'pk',SUPABASE_SECRET_KEY:'sk'};
 const wrong=await probe({...base,NEXT_PUBLIC_SUPABASE_URL:url(PHESMUN_PRODUCTION_REF)},fetcher);
 assert.equal(wrong.status,'down');assert.equal(wrong.checks.database.detail,'Wrong Supabase project');assert.equal(calls,0);
 const mismatch=await probe({...base,VERCEL_ENV:'production',EXPECTED_SUPABASE_REF:PROD,NEXT_PUBLIC_SUPABASE_URL:url(DEV)},fetcher);
 assert.equal(mismatch.status,'down');assert.equal(calls,0);
 assert.ok(!JSON.stringify(mismatch).includes('sk'),'no secret in the report');
 const ok=await probe({...base,VERCEL_ENV:'production',EXPECTED_SUPABASE_REF:PROD,NEXT_PUBLIC_SUPABASE_URL:url(PROD)},fetcher);
 assert.ok(calls>0);assert.notEqual(ok.checks.supabase.detail,'Wrong Supabase project');
 calls=0;
 const local=await probe({NEXT_PUBLIC_DATA_BACKEND:'local'},fetcher);
 assert.equal(local.status,'ok');assert.equal(calls,0);
});
