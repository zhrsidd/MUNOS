import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAppUrl,checkHealthEnvironment,checkUsers} from '../scripts/rehearsal/guard';
import {buildScenario,summarize,assignRoles,HUMAN_FLOOR_SECONDS} from '../scripts/rehearsal/scenario';
import {evaluate,percentile,report} from '../scripts/rehearsal/metrics';
test('rehearsal guard refuses production-looking targets with no override',()=>{
 for(const ok of ['http://localhost:3000','http://127.0.0.1:3001','https://munos-3fk29dk1x-dcmun.vercel.app','https://munos-git-claude-drive-ops-dcmun.vercel.app'])assert.ok(checkAppUrl(ok).ok,ok);
 for(const bad of [undefined,'','https://munos.vercel.app','https://munos-dcmun.vercel.app','https://conference.dcmun.org','http://munos-3fk29dk1x-dcmun.vercel.app','https://user:pw@munos-git-x-dcmun.vercel.app','https://munos-3fk29dk1x-dcmun.vercel.app.evil.example','ftp://localhost'])assert.equal(checkAppUrl(bad).ok,false,String(bad));
 assert.equal(checkHealthEnvironment({app:{environment:'production'}}).ok,false);
 assert.equal(checkHealthEnvironment({}).ok,false,'not a Conference OS deployment');
 assert.ok(checkHealthEnvironment({app:{environment:'preview'}}).ok);
 assert.equal(checkUsers(201).ok,false);assert.equal(checkUsers(0).ok,false);assert.ok(checkUsers(200).ok);
});
test('scenario is human-paced, deterministic, bursty at start and role-mixed',()=>{
 const a=buildScenario({users:100,minutes:10,committees:12,seed:7}),b=buildScenario({users:100,minutes:10,committees:12,seed:7});
 assert.deepEqual(a,b,'same seed, same plan');
 const roles=assignRoles(100);assert.equal(roles.length,100);assert.equal(roles.filter(r=>r==='chair').length,35);assert.equal(roles.filter(r=>r==='delegate').length,50);
 for(const u of a){
  assert.ok(u.start<150_000,'everyone opens within the 2.5 minute burst window');
  const writes=u.steps.filter(s=>!['read','health','submitPage','refocus','open'].includes(s.action));
  for(let i=1;i<writes.length;i++)assert.ok(writes[i].at-writes[i-1].at>=HUMAN_FLOOR_SECONDS*1000,'no machine-speed writes');
  assert.ok(u.steps.every(s=>s.at<10*60_000));
 }
 const s=summarize(a,10);assert.ok(s.maxWritesPerUserPerMinute<=60/HUMAN_FLOOR_SECONDS);assert.ok(s.counts.read>0&&s.counts.participation>0&&s.counts.attendance>0);
 assert.equal(buildScenario({users:1,minutes:1,committees:1})[0].role,'chair','smallest run still exercises a Chair');
});
test('metrics: percentiles, outcome classes and readiness verdict',()=>{
 assert.equal(percentile([10,20,30,40,50,60,70,80,90,100],0.95),100);assert.equal(percentile([],0.5),0);
 const r=report([{action:'read',ms:100,outcome:'ok'},{action:'read',ms:300,outcome:'ok'},{action:'queue',ms:200,outcome:'conflict'},{action:'participation',ms:400,outcome:'ok'}]);
 assert.equal(r.conflicts,1);assert.equal(r.errorRate,0);assert.equal(r.actions.read.p50_ms,100);
 assert.ok(evaluate(r,0,0).pass);
 assert.equal(evaluate(r,1,0).pass,false,'duplicates fail');
 assert.equal(evaluate(report([{action:'read',ms:1,outcome:'rate_limited'}]),0,0).pass,false,'rate limits fail');
});
