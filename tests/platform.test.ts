import test from 'node:test';
import assert from 'node:assert/strict';
import {probe} from '../lib/platform/health-probe';
import {releaseLabel} from '../lib/platform/build-info';
const cloud={NEXT_PUBLIC_DATA_BACKEND:'supabase',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co/',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'pk',SUPABASE_SECRET_KEY:'sb_secret_TEST_VALUE'};
type Reply=number|Error|'hang';
// Records every request so tests prove which checks actually ran, with which method and headers.
function respond(map:Record<string,Reply>){
 const calls:{url:string;method:string;headers:Record<string,string>}[]=[];
 const fetcher=(async(url:string|URL|Request,init?:RequestInit)=>{
  const href=String(url);calls.push({url:href,method:init?.method??'GET',headers:(init?.headers??{}) as Record<string,string>});
  assert.ok(!href.includes('//auth')&&!href.includes('//rest')&&!href.includes('//storage'),'no double slash');
  const key=Object.keys(map).find(k=>href.includes(k));assert.ok(key,`unexpected request ${href}`);
  const reply=map[key];
  if(reply instanceof Error)throw reply;
  // A hung upstream; the referenced timer keeps the test process alive until the probe's own timeout aborts it.
  if(reply==='hang')return new Promise<Response>((_,reject)=>{const alive=setTimeout(()=>{},10_000);init?.signal?.addEventListener('abort',()=>{clearTimeout(alive);reject(init.signal!.reason);});});
  return new Response('null',{status:reply});
 }) as typeof fetch;
 return {fetcher,calls};
}
const healthy={'/auth/v1/health':200,'/rest/v1/rpc/submission_link_info':200,'/storage/v1/bucket':200} as Record<string,Reply>;
const noSecretLeak=(report:object)=>assert.ok(!JSON.stringify(report).includes('sb_secret_TEST_VALUE'),'secret never appears in report');
test('health probe: all checks healthy, and the database check is a real read-only PostgREST round trip',async()=>{
 const {fetcher,calls}=respond(healthy);
 const report=await probe(cloud,fetcher);
 assert.equal(report.status,'ok');
 for(const check of ['supabase','database','storage'] as const){assert.equal(report.checks[check].status,'ok');assert.equal(typeof report.checks[check].latencyMs,'number');}
 const db=calls.find(c=>c.url.includes('/rest/v1/'));
 assert.ok(db,'database check executed');
 assert.equal(db.url,'https://example.supabase.co/rest/v1/rpc/submission_link_info?link_token=health-probe');
 assert.equal(db.method,'GET','read-only STABLE function; nothing is written');
 const token=new URL(db.url).searchParams.get('link_token')!;
 assert.ok(token.length<22,'shorter than any issued link token, so it can never return a real committee');
 assert.equal(db.headers.apikey,'sb_secret_TEST_VALUE','server-side credential, never sent to the browser');
 assert.ok(calls.every(c=>c.method==='GET'||c.method==='HEAD'),'no mutation');
 noSecretLeak(report);
});
test('health probe: database failure or timeout is down (HTTP 503 from /api/health)',async()=>{
 const failed=await probe(cloud,respond({...healthy,'/rest/v1/rpc/submission_link_info':503}).fetcher);
 assert.equal(failed.status,'down');assert.equal(failed.checks.database.status,'down');assert.equal(failed.checks.database.detail,'HTTP 503');
 const unreachable=await probe(cloud,respond({...healthy,'/rest/v1/rpc/submission_link_info':new TypeError('fetch failed')}).fetcher);
 assert.equal(unreachable.status,'down');assert.equal(unreachable.checks.database.status,'down');
 const started=Date.now();
 const timedOut=await probe(cloud,respond({...healthy,'/rest/v1/rpc/submission_link_info':'hang'}).fetcher,50);
 assert.ok(Date.now()-started<2000,'timeout stays bounded');
 assert.equal(timedOut.status,'down');assert.equal(timedOut.checks.database.status,'down');assert.equal(timedOut.checks.database.detail,'TimeoutError');
 const refused=await probe(cloud,respond({...healthy,'/rest/v1/rpc/submission_link_info':401}).fetcher);
 assert.equal(refused.status,'degraded','a rejected (4xx) query is degraded, not down');
 for(const r of [failed,unreachable,timedOut,refused])noSecretLeak(r);
});
test('health probe: missing SUPABASE_SECRET_KEY can never report ok in Supabase mode',async()=>{
 const {fetcher,calls}=respond({'/auth/v1/health':200});
 const report=await probe({...cloud,SUPABASE_SECRET_KEY:undefined},fetcher);
 assert.notEqual(report.status,'ok');assert.equal(report.status,'degraded');
 assert.equal(report.checks.supabase.status,'ok');
 assert.equal(report.checks.database.status,'not_configured');assert.equal(report.checks.storage.status,'not_configured');
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/auth/v1/health'],'only the public Auth check can run without the server key');
});
test('health probe: storage failure is degraded; Auth down is down; missing public config is degraded',async()=>{
 const storage=await probe(cloud,respond({...healthy,'/storage/v1/bucket':new Error('timeout')}).fetcher);
 assert.equal(storage.status,'degraded');assert.equal(storage.checks.storage.status,'down');assert.equal(storage.checks.database.status,'ok');
 const auth=await probe(cloud,respond({...healthy,'/auth/v1/health':503}).fetcher);
 assert.equal(auth.status,'down');
 const {fetcher,calls}=respond({});
 const unconfigured=await probe({...cloud,NEXT_PUBLIC_SUPABASE_URL:undefined},fetcher);
 assert.equal(unconfigured.status,'degraded');assert.equal(calls.length,0);
 for(const check of ['supabase','database','storage'] as const)assert.equal(unconfigured.checks[check].status,'not_configured');
 noSecretLeak(storage);noSecretLeak(auth);noSecretLeak(unconfigured);
});
test('health probe: local demo mode checks nothing and reports ok',async()=>{
 const {fetcher,calls}=respond({});
 const local=await probe({NEXT_PUBLIC_DATA_BACKEND:'local',SUPABASE_SECRET_KEY:'sb_secret_TEST_VALUE'},fetcher);
 assert.equal(local.status,'ok');assert.equal(calls.length,0);
 for(const check of ['supabase','database','storage'] as const)assert.equal(local.checks[check].status,'not_configured');
 noSecretLeak(local);
});
test('release label identifies version, commit and environment',()=>{
 assert.equal(releaseLabel({version:'0.3.0',commit:'abcdef1234',shortCommit:'abcdef1',branch:'main',environment:'production',deploymentId:'dpl_1',builtAt:''}),'0.3.0 · abcdef1 · production');
 assert.equal(releaseLabel({version:'0.3.0',commit:'',shortCommit:'',branch:'',environment:'development',deploymentId:'',builtAt:''}),'0.3.0 · local build · development');
});
