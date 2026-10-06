import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAppUrl,checkHealthEnvironment,checkUsers} from '../scripts/rehearsal/guard';
import {buildScenario,summarize,assignStaffRoles,subscribers,HUMAN_FLOOR_SECONDS,READS} from '../scripts/rehearsal/scenario';
import {evaluate,percentile,report} from '../scripts/rehearsal/metrics';
test('rehearsal guard refuses production-looking targets with no override',()=>{
 for(const ok of ['http://localhost:3000','http://127.0.0.1:3001','https://munos-3fk29dk1x-dcmun.vercel.app','https://munos-git-claude-drive-ops-dcmun.vercel.app'])assert.ok(checkAppUrl(ok).ok,ok);
 for(const bad of [undefined,'','https://munos.vercel.app','https://munos-dcmun.vercel.app','https://conference.dcmun.org','http://munos-3fk29dk1x-dcmun.vercel.app','https://user:pw@munos-git-x-dcmun.vercel.app','https://munos-3fk29dk1x-dcmun.vercel.app.evil.example','ftp://localhost'])assert.equal(checkAppUrl(bad).ok,false,String(bad));
 assert.equal(checkHealthEnvironment({app:{environment:'production'}}).ok,false);
 assert.equal(checkHealthEnvironment({}).ok,false,'not a Conference OS deployment');
 assert.ok(checkHealthEnvironment({app:{environment:'preview'}}).ok);
 assert.equal(checkUsers(201).ok,false);assert.equal(checkUsers(0).ok,false);assert.ok(checkUsers(200).ok);
});
test('staff scenario is human-paced, deterministic, bursty at start and staff-only',()=>{
 const a=buildScenario({staff:50,minutes:10,committees:14,seed:7}),b=buildScenario({staff:50,minutes:10,committees:14,seed:7});
 assert.deepEqual(a,b,'same seed, same plan');
 const roles=assignStaffRoles(50);assert.equal(roles.length,50);assert.equal(roles.filter(r=>r==='chair').length,35);
 assert.ok(!(roles as string[]).includes('delegate'),'staff population contains no delegates');
 for(const u of a){
  assert.ok(u.start<150_000,'every staff device opens within the 2.5 minute burst window');
  const writes=u.steps.filter(s=>!READS.includes(s.action));
  for(let i=1;i<writes.length;i++)assert.ok(writes[i].at-writes[i-1].at>=HUMAN_FLOOR_SECONDS*1000,'no machine-speed writes');
  assert.ok(u.steps.every(s=>s.at<10*60_000));
  assert.ok(u.steps.every(s=>s.action!=='submitPage'&&s.action!=='submit'),'staff never use the public form');
 }
 assert.equal(buildScenario({staff:1,minutes:1,committees:1})[0].role,'chair','smallest run still exercises a Chair');
});
test('chair procedure: one floor device per committee drives speeches; others never start speeches',()=>{
 const users=buildScenario({staff:50,minutes:20,committees:14,seed:11});
 const chairs=users.filter(u=>u.role==='chair');
 for(let c=0;c<14;c++)assert.equal(chairs.filter(u=>u.floor&&u.committee===c).length,1,`committee ${c} has exactly one floor device`);
 const floorOnly=['currentSession','speechStart','speechScore','speechFinish','poiAllowance','poiAdd','poiRecognize','queueOrder'];
 for(const u of users.filter(u=>!u.floor))assert.ok(u.steps.every(s=>!floorOnly.includes(s.action)),'only the floor device runs the floor');
 for(const u of chairs.filter(u=>u.floor)){
  assert.equal(u.steps.find(s=>s.action!=='open')?.action,'currentSession','floor sets the shared Current session first');
  const seq=u.steps.map(s=>s.action).filter(a=>['speechStart','speechScore','speechFinish'].includes(a));
  for(let i=0;i<seq.length;i++)if(seq[i]==='speechScore')assert.equal(seq[i-1],'speechStart','score follows a start');
 }
 assert.ok(chairs.some(u=>u.steps.some(s=>s.action==='poiRecognize')),'POIs are exercised');
});
test('read amplification: every write fans out to the committee Chairs and all conference-wide staff',()=>{
 const users=buildScenario({staff:50,minutes:10,committees:14,seed:5});
 const writer=users.find(u=>u.floor)!;
 const fan=subscribers(users,writer);
 assert.ok(fan.every(u=>u!==writer&&(u.role!=='chair'||u.committee===writer.committee)));
 assert.equal(fan.filter(u=>u.role!=='chair').length,users.filter(u=>u.role!=='chair').length,'every non-Chair device refreshes on every write');
 const s=summarize(users,10);
 assert.ok(s.staffApp.readAmplification>=3,'at least the writer\'s own three reads per write');
 assert.ok(s.staffApp.snapshotReadsPerMinute>s.staffApp.writesPerMinute*3);
});
test('delegates are a separate public-form population: page load + optional submission, no staff actions, no sessions',()=>{
 const users=buildScenario({staff:20,delegates:150,minutes:10,committees:14,delegateWindowSeconds:120,submitFraction:0.3,seed:3});
 const delegates=users.filter(u=>u.role==='delegate');
 assert.equal(delegates.length,150);
 for(const d of delegates){
  assert.equal(d.steps[0].action,'submitPage');assert.ok(d.start<120_000,'all page loads inside the delegate window');
  assert.ok(d.steps.every(s=>s.action==='submitPage'||s.action==='submit'),'only the public form');
  if(d.steps[1])assert.ok(d.steps[1].at-d.steps[0].at>=HUMAN_FLOOR_SECONDS*1000,'reads the page before submitting');
 }
 const s=summarize(users,10);
 assert.equal(s.delegatePublicForm.pageLoads,150);assert.equal(s.delegatePublicForm.authSessions,0);
 assert.ok(s.delegatePublicForm.submissions>20&&s.delegatePublicForm.submissions<75);
 assert.ok(s.staffApp.steps>0&&s.staffApp.writesPerMinute>0);
});
test('metrics: percentiles, outcome classes and readiness verdict',()=>{
 assert.equal(percentile([10,20,30,40,50,60,70,80,90,100],0.95),100);assert.equal(percentile([],0.5),0);
 const r=report([{action:'read',ms:100,outcome:'ok'},{action:'read',ms:300,outcome:'ok'},{action:'queue',ms:200,outcome:'conflict'},{action:'participation',ms:400,outcome:'ok'}]);
 assert.equal(r.conflicts,1);assert.equal(r.errorRate,0);assert.equal(r.actions.read.p50_ms,100);
 assert.ok(evaluate(r,0,0).pass);
 assert.equal(evaluate(r,1,0).pass,false,'duplicates fail');
 assert.equal(evaluate(report([{action:'read',ms:1,outcome:'rate_limited'}]),0,0).pass,false,'rate limits fail');
});
