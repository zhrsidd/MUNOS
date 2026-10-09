import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAppUrl,checkHealthEnvironment,checkUsers} from '../scripts/rehearsal/guard';
import {buildScenario,summarize,assignStaffRoles,subscribers,recipients,receives,TOPIC_OF,HUMAN_FLOOR_SECONDS,READS,type SimUser} from '../scripts/rehearsal/scenario';
import {SimClient,RECOVERY_MS,REALTIME_DEBOUNCE_MS} from '../scripts/rehearsal/client-model';
import {VirtualClock,estimate} from '../scripts/rehearsal/estimate';
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
test('legacy model (kept for comparison): every write fanned out to committee Chairs and all conference-wide staff',()=>{
 const users=buildScenario({staff:50,minutes:10,committees:14,seed:5});
 const writer=users.find(u=>u.floor)!;
 const fan=subscribers(users,writer);
 assert.ok(fan.every(u=>u!==writer&&(u.role!=='chair'||u.committee===writer.committee)));
 assert.equal(fan.filter(u=>u.role!=='chair').length,users.filter(u=>u.role!=='chair').length,'every non-Chair device refreshes on every write');
 const s=summarize(users,10);
 assert.ok(s.legacyHarnessModel.readAmplification>=3,'legacy: three writer reads per write');
 assert.ok(s.legacyHarnessModel.snapshotReadsPerMinute>s.staffApp.writesPerMinute*3);
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

// ---- Production client model (mirrors lib/sync/repository.ts DurableRepository) ----------------------------------
type Item={name:string};
function client(clock:VirtualClock,o:{readMs?:number;sendMs?:number;failReads?:number}={}){
 const log:string[]=[];let fail=o.failReads??0;let inFlight=0,maxInFlight=0;
 const c=new SimClient<Item>({isConflict:()=>false,
  read:async source=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);log.push(`${clock.now()} read:${source}`);await clock.sleep(o.readMs??1000);inFlight--;if(fail>0){fail--;throw Error('timeout');}},
  send:async item=>{log.push(`${clock.now()} send:${item.name}`);await clock.sleep(o.sendMs??300);}},clock);
 return {c,log,max:()=>maxInFlight};
}
const at=(clock:VirtualClock,ms:number,fn:()=>void)=>clock.setTimeout(fn,ms);
test('client model: a trigger while a flush is running is dropped, not queued (no dirty flag, no follow-up)',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log,max}=client(clock);
 c.open();                                      // read 0–1000
 at(clock,100,()=>c.focus());                   // dropped
 at(clock,200,()=>c.notify());                  // realtime trigger at 550 → dropped
 await clock.run(59_000);
 assert.deepEqual(log,['0 read:open'],'exactly one refresh; the dropped triggers did not run later');
 assert.equal(c.stats.dropped.refocus,1);assert.equal(c.stats.dropped.realtime,1);
 await clock.run(RECOVERY_MS+1000+1000);        // recovery timer: 60 s after the flush ended (+jitter 0 here)
 assert.deepEqual(log,['0 read:open','61000 read:periodic']);
 assert.equal(max(),1,'never two full refreshes at once on one device');
});
test('client model: a write recorded during an empty-outbox refresh waits for the next trigger (as production does)',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=client(clock);
 c.open();                                      // recovery read 0–1000 (empty outbox)
 at(clock,500,()=>c.execute({name:'A'}));       // flush() returns immediately: still pending
 await clock.run(30_000);
 assert.equal(c.pending,1,'not sent by the dropped trigger');
 at(clock,10_000,()=>c.notify());               // t=40 s: someone else's change arrives → flush sends A
 await clock.run(45_000);
 assert.deepEqual(log,['0 read:open','40350 send:A','40650 read:postWrite'],'read-back only: no extra final read after an acknowledged write');
 assert.equal(c.pending,0);
});
test('client model: writes recorded while the send loop runs are sent by that loop (send + read-back per item, no final read)',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=client(clock);
 c.execute({name:'A'});                         // send 0–300, read 300–1300
 at(clock,100,()=>c.execute({name:'B'}));       // trigger dropped, but the running loop picks B up
 await clock.run(10_000);
 assert.deepEqual(log,['0 send:A','300 read:postWrite','1300 send:B','1600 read:postWrite']);
 assert.equal(c.stats.reads.postWrite,2,'one read-back per acknowledged item');assert.equal(c.stats.dropped.postWrite,1);
});
test('client model: failed refresh backs off exponentially, then returns to the 60 s recovery timer',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=client(clock,{failReads:1});
 c.open();await clock.run(70_000);
 assert.deepEqual(log.slice(0,3),['0 read:open','3000 read:periodic','64000 read:periodic'],'retry 2 s after the failed flush ended, then 60 s');
});
test('client model: Realtime notifications use a trailing 350 ms debounce that resets on every event',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=client(clock);
 for(const t of [0,200,400])at(clock,t,()=>c.notify());
 await clock.run(5_000);
 assert.deepEqual(log,[`${400+REALTIME_DEBOUNCE_MS} read:realtime`]);assert.equal(c.stats.attempted.realtime,1);
});
// ---- Realtime topics --------------------------------------------------------------------------------------------
const dev=(id:number,role:SimUser['role'],committee:number):SimUser=>({id,role,committee,start:0,steps:[]});
test('topics: the server emits chair/documents events per the function definitions; timer emits none',()=>{
 for(const a of ['currentSession','attendance','queueAdd','queueOrder','speechStart','speechScore','poiAllowance','poiAdd','poiRecognize','speechFinish','photoAck'] as const)assert.equal(TOPIC_OF[a],'chair',a);
 for(const a of ['sendToApproval','approve','print','submit'] as const)assert.equal(TOPIC_OF[a],'documents',a);
 assert.equal(TOPIC_OF.timer,null,'apply_mutation skips operational_changes for timer');
});
test('topic-aware Realtime: Chair stays committee-scoped; Approval/Admins ignore chair; Executive receives chair',()=>{
 const chairA=dev(0,'chair',3),chairA2=dev(1,'chair',3),chairB=dev(2,'chair',4),approval=dev(3,'approval',0),admins=dev(4,'admins',1),exec=dev(5,'executive',2),delegate=dev(6,'delegate',3);
 const all=[chairA,chairA2,chairB,approval,admins,exec,delegate];
 assert.deepEqual(recipients('topic-aware',all,{topic:'chair',committee:3}),[chairA,chairA2,exec],'chair event: same-committee Chairs (incl. the writer) + Executive only');
 assert.ok(!receives('topic-aware',chairB,{topic:'chair',committee:3}),'other committee never notified');
 assert.ok(!receives('topic-aware',approval,{topic:'chair',committee:3}));assert.ok(!receives('topic-aware',admins,{topic:'chair',committee:3}));
 assert.deepEqual(recipients('topic-aware',all,{topic:'documents',committee:3}),[chairA,chairA2,approval,admins,exec],'documents reach the committee Chairs and every workflow role');
 assert.deepEqual(recipients('topic-aware',all,{topic:'configuration',committee:4}),[chairB,approval,admins,exec],'configuration reaches the scoped Chair and every non-Chair role');
 assert.deepEqual(recipients('current',all,{topic:'chair',committee:3}),[chairA,chairA2,approval,admins,exec],'current main: non-Chair roles refresh on every change');
 assert.ok(all.every(u=>!receives('current',delegate,{topic:'documents',committee:u.committee})),'delegates never subscribe');
});
test('estimate: deterministic, one refresh in flight per device, and topic-aware removes Approval/Admins chair refreshes',async()=>{
 const users=buildScenario({staff:50,minutes:5,committees:14});
 const a=await estimate(users,{minutes:5,readMs:600,sendMs:300,model:'topic-aware'}),b=await estimate(users,{minutes:5,readMs:600,sendMs:300,model:'topic-aware'});
 assert.deepEqual(a,b,'same scenario, same counts');
 const cur=await estimate(users,{minutes:5,readMs:600,sendMs:300,model:'current'});
 assert.equal(a.maxConcurrentReadsPerDevice,1);assert.equal(cur.maxConcurrentReadsPerDevice,1);
 assert.ok(a.byRole.approval<cur.byRole.approval/5&&a.byRole.admins<cur.byRole.admins/5,'Approval/Admins no longer refresh on chair events');
 assert.ok(Math.abs(a.byRole.executive-cur.byRole.executive)/cur.byRole.executive<0.05,'Executive keeps every topic');
 assert.equal(a.writes,cur.writes,'same writes either way');
 const slow=await estimate(users,{minutes:5,readMs:7000,sendMs:300,model:'topic-aware'});
 assert.ok(slow.triggersDropped>a.triggersDropped&&slow.refreshes<a.refreshes,'slower refreshes drop more triggers instead of stacking reads');
 const legacy=summarize(users,5).legacyHarnessModel.refreshes;
 assert.ok(cur.refreshes<legacy,'one-in-flight model issues fewer refreshes than the legacy overlapping model');
});
// ---- Fresh fixture ----------------------------------------------------------------------------------------------
import {buildFixture,derivedUuid} from '../scripts/rehearsal/fixture';
test('LEGACY fresh fixture (historical comparison only, never readiness): 14 floors in ONE scoped Chair committee, single-role grants, no Auth users',()=>{
 const users={chair:'00000000-0000-4000-8000-0000000000c1',approval:'00000000-0000-4000-8000-0000000000a1',admins:'00000000-0000-4000-8000-0000000000l1',executive:'00000000-0000-4000-8000-0000000000e1'};
 const o={mode:'legacy-floors' as const,conference:'11111111-1111-4111-8111-111111111111',committees:14,delegates:420,floors:14,grantHours:3,users};
 const a=buildFixture(o),b=buildFixture(o);
 assert.deepEqual(a,b,'same conference id → identical committees, sessions and floors');
 assert.equal(a.committees.length,14);assert.equal(a.floors.length,14);assert.equal(new Set(a.floors).size,14);
 assert.equal(a.floors[0],a.committees[0].session,'floor 0 is the Chair committee\'s own session');
 assert.match(derivedUuid('x'),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 const grants=a.sql.slice(a.sql.indexOf('insert into public.user_access')).split('\n').filter(l=>l.startsWith(' ('));
 assert.equal(grants.length,4,'exactly one grant per identity');
 assert.ok(grants[0].includes(`'chair','${a.committees[0].id}'`),'Chair scoped to one committee');
 for(const [g,role] of [[grants[1],'approval'],[grants[2],'logistics'],[grants[3],'admin']])assert.ok(g.includes(`'${role}',null`),role);
 assert.equal((a.sql.match(/'active'\)/g)??[]).length,14+13,'14 committee sessions + 13 extra floors');
 assert.equal(a.delegates.length,420,'legacy mode uses the same deterministic delegate model');
 assert.ok(!/auth\.|service_role|sb_secret|access_token|refresh_token/i.test(a.sql),'never touches Auth or embeds credentials');
});
// ---- PR #10 Executive Chair-topic window ----------------------------------------------------------------------------
import {EXECUTIVE_CHAIR_WINDOW_MS} from '../scripts/rehearsal/client-model';
function execClient(clock:VirtualClock,windowMs=EXECUTIVE_CHAIR_WINDOW_MS){
 const log:string[]=[];
 const c=new SimClient<Item>({isConflict:()=>false,read:async source=>{log.push(`${clock.now()} read:${source}`);await clock.sleep(100);},send:async()=>{}},clock,{executiveChairWindowMs:windowMs});
 return {c,log};
}
test('Executive window: first Chair event starts a FIXED 2 s window; later Chair events do not extend it; a later event opens a new window',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=execClient(clock);
 for(const t of [0,500,1500,1999])at(clock,t,()=>c.notify('chair'));
 at(clock,2500,()=>c.notify('chair'));
 await clock.run(10_000);
 assert.deepEqual(log,['2000 read:realtime','4500 read:realtime'],'one refresh per window, never postponed by sustained Chair traffic');
 assert.equal(c.stats.chairWindows,2);assert.equal(c.stats.chairEventsCoalesced,3);assert.equal(c.stats.attempted.realtime,2);
});
test('Executive window: a non-Chair event cancels the pending Chair window and uses the 350 ms trailing debounce',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=execClient(clock);
 at(clock,0,()=>c.notify('chair'));          // window would fire at 2000
 at(clock,1000,()=>c.notify('documents'));   // cancels it → debounce to 1350
 at(clock,1200,()=>c.notify('configuration'));// resets debounce → 1550
 await clock.run(10_000);
 assert.deepEqual(log,['1550 read:realtime'],'no extra refresh at 2000: the fast read reconciles Chair state too');
 assert.equal(c.stats.attempted.realtime,1);
});
test('Executive window: Chair events during a pending fast debounce add no timer; after it fires a new Chair event opens a window',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=execClient(clock);
 at(clock,0,()=>c.notify('documents'));      // debounce → 350
 at(clock,100,()=>c.notify('chair'));        // absorbed (debounce pending)
 at(clock,300,()=>c.notify('chair'));        // absorbed
 at(clock,1000,()=>c.notify('chair'));       // debounce done → window → 3000
 await clock.run(10_000);
 assert.deepEqual(log,['350 read:realtime','3000 read:realtime']);
 assert.equal(c.stats.chairEventsCoalesced,2);assert.equal(c.stats.chairWindows,1);
});
test('Executive window applies only to Executive-only devices; other roles keep the plain trailing debounce for Chair events',async()=>{
 const clock=new VirtualClock(()=>0);const {c,log}=execClient(clock,0); // window disabled = Chair/mixed/older-core behaviour
 for(const t of [0,500,1500])at(clock,t,()=>c.notify('chair'));
 await clock.run(10_000);
 assert.deepEqual(log,[`${REALTIME_DEBOUNCE_MS} read:realtime`,`${500+REALTIME_DEBOUNCE_MS} read:realtime`,`${1500+REALTIME_DEBOUNCE_MS} read:realtime`],'events further apart than 350 ms each refresh (vs one per 2 s window for Executive)');assert.equal(c.stats.chairWindows,0);
});
test('estimate: the PR #10 window materially reduces Executive Chair-triggered refreshes and leaves other roles unchanged',async()=>{
 const users=buildScenario({staff:100,minutes:5,committees:14});
 const before=await estimate(users,{minutes:5,readMs:600,sendMs:300,model:'topic-aware',executiveChairWindowMs:0});
 const after=await estimate(users,{minutes:5,readMs:600,sendMs:300,model:'topic-aware',executiveChairWindowMs:2000});
 const again=await estimate(users,{minutes:5,readMs:600,sendMs:300,model:'topic-aware',executiveChairWindowMs:2000});
 assert.deepEqual(after,again,'deterministic');
 assert.ok(after.executive.realtimeTriggers<before.executive.realtimeTriggers*0.7,'materially fewer Executive Realtime refresh triggers');
 assert.ok(after.byRole.executive<before.byRole.executive,'fewer Executive refreshes');
 assert.equal(after.byRole.approval,before.byRole.approval);assert.equal(after.byRole.admins,before.byRole.admins);
 assert.equal(after.executive.realtimeEvents,before.executive.realtimeEvents,'same events delivered; only coalescing differs');
});
