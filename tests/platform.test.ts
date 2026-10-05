import test from 'node:test';
import assert from 'node:assert/strict';
import {probe} from '../lib/platform/health-probe';
import {releaseLabel} from '../lib/platform/build-info';
const cloud={NEXT_PUBLIC_DATA_BACKEND:'supabase',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co/',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'pk',SUPABASE_SECRET_KEY:'sb_secret_TEST_VALUE'};
const respond=(map:Record<string,number|Error>)=>(async(url:string|URL|Request,init?:RequestInit)=>{
 const key=Object.keys(map).find(k=>String(url).includes(k))!;const v=map[key];
 if(v instanceof Error)throw v;
 assert.ok(!String(url).includes('//auth') && !String(url).includes('//storage'),'no double slash');
 assert.ok(init?.headers,'apikey header sent');
 return new Response('{}',{status:v});
}) as typeof fetch;
test('health probe reports ok, degraded storage, and down database without leaking secrets',async()=>{
 const ok=await probe(cloud,respond({'/auth/v1/health':200,'/storage/v1/bucket':200}));
 assert.equal(ok.status,'ok');assert.equal(ok.checks.supabase.status,'ok');
 assert.ok(!JSON.stringify(ok).includes('sb_secret_TEST_VALUE'),'secret never appears in report');
 const storage=await probe(cloud,respond({'/auth/v1/health':200,'/storage/v1/bucket':new Error('timeout')}));
 assert.equal(storage.status,'degraded');assert.equal(storage.checks.storage.status,'down');
 const down=await probe(cloud,respond({'/auth/v1/health':503,'/storage/v1/bucket':503}));
 assert.equal(down.status,'down');
 const local=await probe({NEXT_PUBLIC_DATA_BACKEND:'local'},respond({}));
 assert.equal(local.status,'ok');assert.equal(local.checks.supabase.status,'not_configured');
 const noSecret=await probe({...cloud,SUPABASE_SECRET_KEY:undefined},respond({'/auth/v1/health':200}));
 assert.equal(noSecret.checks.storage.status,'not_configured');
});
test('release label identifies version, commit and environment',()=>{
 assert.equal(releaseLabel({version:'0.3.0',commit:'abcdef1234',shortCommit:'abcdef1',branch:'main',environment:'production',deploymentId:'dpl_1',builtAt:''}),'0.3.0 · abcdef1 · production');
 assert.equal(releaseLabel({version:'0.3.0',commit:'',shortCommit:'',branch:'',environment:'development',deploymentId:'',builtAt:''}),'0.3.0 · local build · development');
});
