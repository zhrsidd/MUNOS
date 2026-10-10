import test from 'node:test';
import assert from 'node:assert/strict';
import {systemStatus,type StatusInput} from '../lib/platform/system-status';
import type {Health} from '../lib/sync/repository';
import type {HealthReport} from '../lib/platform/health-probe';
const now=Date.parse('2026-11-12T10:00:00Z');
const healthy:Health={mode:'supabase',state:'saved',pending:0,conflicts:0,realtime:true,latency:180,message:'Synced',detail:''};
const report=(storage:'ok'|'down'|'not_configured'='ok',commit='abc1234'):HealthReport=>({status:storage==='down'?'degraded':'ok',checkedAt:'',app:{version:'1',commit,shortCommit:commit.slice(0,7),branch:'main',environment:'production',deploymentId:'',builtAt:''},checks:{supabase:{status:'ok'},database:{status:'ok'},storage:{status:storage}}});
const base:StatusInput={health:healthy,online:true,cloudExpected:true,server:report(),clientCommit:'abc1234',now};
const run=(p:Partial<StatusInput>,h:Partial<Health>={})=>systemStatus({...base,...p,health:{...healthy,...h}});
test('green when everything is connected and synced',()=>{
 const s=run({});assert.equal(s.level,'green');assert.equal(s.headline,'All systems operational');
});
test('offline with pending changes is yellow and says changes will sync',()=>{
 const s=run({online:false,oldestPendingAt:new Date(now-60000).toISOString()},{state:'waiting',pending:4,realtime:false});
 assert.equal(s.level,'yellow');assert.equal(s.headline,'Internet unavailable');
 assert.match(s.message,/4 changes saved on this device and will sync automatically/);
});
test('realtime outage is yellow with an operations-can-continue message',()=>{
 const s=run({},{realtime:false});assert.equal(s.level,'yellow');assert.equal(s.headline,'Live updates temporarily unavailable');assert.match(s.message,/Committee operations can continue/);
});
test('storage outage is yellow and specific to documents',()=>{
 const s=run({server:report('down')});assert.equal(s.level,'yellow');assert.equal(s.headline,'Document storage is temporarily unavailable');
 assert.equal(run({server:report('not_configured')}).level,'green','unused storage is not reported');
});
test('database unreachable while online is yellow',()=>{
 const s=run({},{state:'waiting',realtime:false});assert.equal(s.level,'yellow');assert.equal(s.headline,'Conference database unreachable');
});
test('red: conflicts, device storage failure, stale outbox, cloud expected but local fallback',()=>{
 assert.equal(run({},{state:'conflict',pending:2,conflicts:1}).level,'red');
 const storage=run({},{state:'error'});assert.equal(storage.level,'red');assert.equal(storage.headline,'This device cannot save changes');
 const stale=run({oldestPendingAt:new Date(now-20*60000).toISOString()},{state:'waiting',pending:3});
 assert.equal(stale.level,'red');assert.match(stale.message,/over 15 minutes/);
 const fallback=run({},{mode:'local',realtime:false});assert.equal(fallback.level,'red');assert.equal(fallback.headline,'Not connected to the conference');
});
test('conflict review grammar is correct for singular and plural counts',()=>{
 const one=run({},{state:'conflict',pending:1,conflicts:1});
 assert.equal(one.headline,'1 change needs review');
 assert.match(one.items.find(i=>i.key==='device')?.text ?? '',/^1 change needs review$/);
 const two=run({},{state:'conflict',pending:2,conflicts:2});
 assert.equal(two.headline,'2 changes need review');
 assert.match(two.items.find(i=>i.key==='device')?.text ?? '',/^2 changes need review$/);
});
test('local demo is yellow and never red when no cloud is expected',()=>{
 const s=run({cloudExpected:false,server:report('not_configured')},{mode:'local',realtime:false});assert.equal(s.level,'yellow');assert.equal(s.headline,'Demo mode');
});
test('version mismatch and unreachable service are yellow, slow database is yellow',()=>{
 assert.equal(run({server:report('ok','fff0000')}).headline,'New version available');
 assert.equal(run({server:'unreachable'}).level,'yellow');
 assert.equal(run({},{latency:4200}).headline,'Connection is slow');
});
test('messages never expose raw technical errors',()=>{
 const s=run({},{state:'waiting',detail:'PGRST301 JWT expired at 12:00'});
 assert.ok(!JSON.stringify(s).includes('PGRST'));
});
