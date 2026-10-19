import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import {DurableRepository,ConflictError,type Transport} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {MAX_BATCH,MIN_REFRESH_GAP_MS,POLL_CONNECTED_MS,POLL_DISCONNECTED_MS,classifyError,errorCode,pollDelay,retryDelay} from '../lib/sync/backoff';
import {systemStatus,type StatusInput} from '../lib/platform/system-status';
import type {Health} from '../lib/sync/repository';
import type {HealthReport} from '../lib/platform/health-probe';

// Regression tests for the Day 1 (16 Oct) synchronisation incident: one full snapshot read per queued action,
// lockstep retries, and passive triggers (focus / Realtime / peer tabs / writes) that ignored backoff.
const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let n=0;n<500;n++){if(check())return;await pause();}assert.ok(check(),'repository did not settle');}
const mutation=():Mutation=>({id:crypto.randomUUID(),actorId:'chair-test',createdAt:new Date().toISOString(),role:'chair',state:'pending',expected:null,command:{type:'participation',sessionId:'s1',delegateId:'d0',resolutionId:'r1',categoryId:'speech',points:2}});
class Server implements Transport {
 actorId='chair-test';data=createSeed();reads=0;sends=0;receipts=new Set<string>();readError:unknown=undefined;subscribe?:(refresh:()=>void,state:(connected:boolean)=>void)=>()=>void;conflictOn=new Set<string>();order:string[]=[];unconfirmed=0;maxConfirmed=0;
 async read(){this.reads++;await pause();if(this.readError)throw this.readError;this.maxConfirmed=Math.max(this.maxConfirmed,this.unconfirmed);this.unconfirmed=0;return structuredClone(this.data);}
 async send(m:Mutation){this.sends++;this.unconfirmed++;await pause();if(this.conflictOn.has(m.id))throw new ConflictError('Another Chair changed this item. Review before applying.');if(!this.receipts.has(m.id)){this.data=applyCommand(this.data,m.command,m.role,m);this.receipts.add(m.id);this.order.push(m.id);}}
}
async function setup(server:Server,pending:Mutation[]){
 const key=crypto.randomUUID(),store=new DurableStore(key);await store.update(key,()=>({key,base:createSeed(),pending,savedAt:new Date(Date.now()-3600000).toISOString()}));
 const repo=new DurableRepository(key,createSeed,store,server);return {key,store,repo,close:async()=>{repo.dispose();await store.close();}};
}

test('a long queue is confirmed by one snapshot read per batch, not one per action',async()=>{
 const server=new Server(),queue=Array.from({length:60},mutation);const {repo,store,key,close}=await setup(server,queue);
 try{
  await repo.ready();await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,60);assert.equal(server.receipts.size,60);
  assert.equal(server.reads,Math.ceil(60/MAX_BATCH),'3 reads instead of 60');
  assert.deepEqual(server.order,queue.map(m=>m.id),'server receives actions in recorded order');
  const saved=(await store.read(key))!;assert.equal(saved.pending.length,0);assert.equal(saved.base.events.length,createSeed().events.length+60,'each action applied exactly once locally');
 }finally{await close();}
});

test('a failed confirming read never discards, replays or double-applies acknowledged actions',async()=>{
 const server=new Server(),queue=Array.from({length:10},mutation);server.readError=Object.assign(Error('canceling statement due to statement timeout'),{code:'57014'});
 const {repo,store,key,close}=await setup(server,queue);
 try{
  await repo.ready();await until(()=>server.reads===1&&!!repo.getHealth().errorKind);
  assert.equal(server.sends,10);assert.equal((await store.read(key))!.pending.length,10,'durable outbox is untouched');
  assert.equal(repo.getHealth().awaitingConfirmation,10);assert.equal(repo.getSnapshot()!.events.length,createSeed().events.length+10,'projection still shows each action once');
  server.readError=undefined;await repo.flush();
  assert.equal(server.sends,10,'acknowledged actions are not sent again');assert.equal(repo.getHealth().pending,0);assert.equal(repo.getHealth().awaitingConfirmation,undefined);
  assert.equal(repo.getSnapshot()!.events.length,createSeed().events.length+10);
 }finally{await close();}
});

test('a conflict mid-batch settles earlier actions and keeps the conflict and everything behind it',async()=>{
 const server=new Server(),[a,b,c,d]=[mutation(),mutation(),mutation(),mutation()];server.conflictOn.add(c.id);
 const {repo,store,key,close}=await setup(server,[a,b,c,d]);
 try{
  await repo.ready();await until(()=>repo.getHealth().conflicts===1);await pause();
  const pending=(await store.read(key))!.pending;
  assert.deepEqual(pending.map(m=>[m.id,m.state]),[[c.id,'conflict'],[d.id,'pending']],'a and b confirmed; c and d retained for review');
  assert.equal(server.sends,3,'d is never sent past the conflict');assert.deepEqual(server.order,[a.id,b.id]);
  assert.equal(repo.getSnapshot()!.events.length,createSeed().events.length+3,'projection = confirmed a,b + pending d; conflicted c excluded');
 }finally{await close();}
});

test('while failing, passive triggers and new actions do not hit the server; the explicit Retry does',async()=>{
 const server=new Server();server.readError=Object.assign(Error('timeout'),{code:'57014'});const {repo,close}=await setup(server,[mutation()]);
 try{
  await repo.ready();await until(()=>server.reads===1&&!!repo.getHealth().retryAt);
  const {reads,sends}=server;assert.equal(repo.getHealth().errorKind,'overload');assert.equal(repo.getHealth().errorCode,'57014');assert.ok(repo.getHealth().retryAt,'next retry is visible');assert.equal(repo.getHealth().retryAttempt,1);
  repo.refresh();repo.refresh();repo.refresh();await pause();await pause();
  assert.equal(server.reads,reads,'focus / Realtime / peer-tab triggers respect backoff');assert.equal(server.sends,sends);
  await repo.execute(mutation().command,'chair');await pause();await pause();
  assert.equal(server.sends,sends,'a new action is saved locally and waits for the retry timer');assert.equal(repo.getHealth().pending,2);
  server.readError=undefined;repo.retry();await until(()=>repo.getHealth().pending===0);
  assert.equal(server.receipts.size,2);assert.equal(repo.getHealth().errorKind,undefined);assert.equal(repo.getHealth().retryAt,undefined);
 }finally{await close();}
});

test('passive refresh does not re-read right after a refresh, but an explicit sync always does',async()=>{
 const server=new Server();const {repo,close}=await setup(server,[]);
 try{
  await repo.ready();await until(()=>server.reads===1&&repo.getHealth().state==='saved');await pause();
  repo.refresh();repo.refresh();await pause();await pause();
  assert.equal(server.reads,1,`no passive read within ${MIN_REFRESH_GAP_MS} ms of the last refresh`);
  await repo.flush();assert.equal(server.reads,2,'explicit sync still reads');
 }finally{await close();}
});

test('passive refresh with queued work still sends it',async()=>{
 const server=new Server();const {repo,close}=await setup(server,[]);
 try{
  await repo.ready();await until(()=>server.reads===1&&repo.getHealth().state==='saved');
  await repo.execute(mutation().command,'chair');await until(()=>repo.getHealth().pending===0);
  assert.equal(server.receipts.size,1);
 }finally{await close();}
});

test('retry delay: never faster than the old ladder, jittered, slower and capped for server overload',()=>{
 for(const [attempt,floor] of [[1,2000],[2,4000],[3,8000],[4,16000],[5,32000],[6,60000],[9,60000]] as const){
  assert.equal(retryDelay(attempt,'network',()=>0),floor);assert.equal(retryDelay(attempt,'network',()=>0.999999),Math.round(floor*1.5));
 }
 for(const [attempt,floor] of [[1,8000],[2,16000],[3,32000],[4,64000],[5,90000],[12,90000]] as const){
  assert.equal(retryDelay(attempt,'overload',()=>0),floor);assert.ok(retryDelay(attempt,'overload',()=>0.999999)<=135000);
 }
 const samples=new Set(Array.from({length:50},()=>retryDelay(3,'overload')));assert.ok(samples.size>20,'devices failing together spread out');
 assert.ok(retryDelay(1,'overload',()=>0)>retryDelay(1,'network',()=>0));
});

test('steady polling is jittered ±20% and slower when Realtime is connected',()=>{
 assert.equal(pollDelay(true,()=>0),POLL_CONNECTED_MS*0.8);assert.equal(pollDelay(true,()=>1),POLL_CONNECTED_MS*1.2);
 assert.equal(pollDelay(false,()=>0),POLL_DISCONNECTED_MS*0.8);assert.equal(pollDelay(false,()=>1),POLL_DISCONNECTED_MS*1.2);
 assert.ok(POLL_CONNECTED_MS>POLL_DISCONNECTED_MS);
});

test('errors are classified as server overload, network or other',()=>{
 assert.equal(classifyError({code:'57014',message:'canceling statement due to statement timeout'}),'overload');
 assert.equal(classifyError({code:'PGRST003',message:'Timed out acquiring connection from connection pool.'}),'overload');
 assert.equal(classifyError({code:'PGRST002'}),'overload');
 assert.equal(classifyError({status:504,message:''}),'overload');assert.equal(classifyError({status:429}),'overload');
 assert.equal(classifyError(new TypeError('Failed to fetch')),'network');assert.equal(classifyError(Error('network unavailable')),'network');
 assert.equal(classifyError(Error('Renew device access before syncing.')),'other');assert.equal(classifyError(undefined),'other');
 assert.equal(errorCode({code:'57014'}),'57014');assert.equal(errorCode(Error('x')),undefined);
});

test('System health says the database is busy (not unreachable) and never leaks error codes',()=>{
 const healthy:Health={mode:'supabase',state:'saved',pending:0,conflicts:0,realtime:true,latency:180,message:'Synced',detail:''};
 const report:HealthReport={status:'ok',checkedAt:'',app:{version:'1',commit:'abc1234',shortCommit:'abc1234',branch:'main',environment:'production',deploymentId:'',builtAt:''},checks:{supabase:{status:'ok'},database:{status:'ok'},storage:{status:'ok'}}};
 const input=(h:Partial<Health>):StatusInput=>({health:{...healthy,...h},online:true,cloudExpected:true,server:report,clientCommit:'abc1234',now:Date.now()});
 const busy=systemStatus(input({state:'waiting',pending:5,errorKind:'overload',errorCode:'57014'}));
 assert.equal(busy.level,'yellow');assert.equal(busy.headline,'Conference database busy');assert.match(busy.message,/5 changes saved on this device/);
 assert.ok(!JSON.stringify(busy).includes('57014'));
 assert.equal(systemStatus(input({state:'waiting',pending:5,errorKind:'network'})).headline,'Conference database unreachable');
 const confirming=systemStatus(input({state:'waiting',pending:5,awaitingConfirmation:3}));
 assert.match(confirming.items.find(i=>i.key==='device')!.text,/3 received by the server, confirming/);
 assert.equal(systemStatus(input({})).level,'green');
});

test('the first read after opening is never coalesced away, even when Realtime connects during startup and the cache is fresh',async()=>{
 const server=new Server();server.subscribe=(refresh,state)=>{state(true);refresh();return()=>{};};
 const key=crypto.randomUUID(),store=new DurableStore(key);await store.update(key,()=>({key,base:createSeed(),pending:[],savedAt:new Date().toISOString()}));
 const repo=new DurableRepository(key,createSeed,store,server);
 try{
  (globalThis as {window?:unknown}).window=new EventTarget();
  await repo.ready();await until(()=>!!repo.getHealth().lastSynced);
  assert.equal(server.reads,1,'startup reconciliation happened exactly once');
 }finally{Reflect.deleteProperty(globalThis,'window');repo.dispose();await store.close();}
});

const overload=()=>Object.assign(Error('canceling statement due to statement timeout'),{code:'57014'});

test('MAX_BATCH covers the whole confirmation batch: after repeated failed read-backs a 60-action queue never confirms more than 25 per read and sends nothing new until acknowledged actions are confirmed',async()=>{
 const server=new Server(),queue=Array.from({length:60},mutation);server.readError=overload();
 const {repo,store,key,close}=await setup(server,queue);
 try{
  await repo.ready();await until(()=>server.reads===1&&!!repo.getHealth().errorKind);
  assert.equal(server.sends,MAX_BATCH);assert.equal(repo.getHealth().awaitingConfirmation,MAX_BATCH);
  for(let round=2;round<=4;round++){repo.retry();await until(()=>server.reads===round&&!repo.getHealth().retryAt===false);await pause();}
  assert.equal(server.sends,MAX_BATCH,'repeated read-back failures confirm the acknowledged prefix first and never send more');
  assert.equal((await store.read(key))!.pending.length,60,'nothing leaves the durable outbox without a successful read');
  server.readError=undefined;await repo.flush();
  assert.equal(repo.getHealth().pending,0);assert.equal(server.sends,60,'no action is ever re-sent');assert.equal(server.receipts.size,60);
  assert.ok(server.maxConfirmed<=MAX_BATCH,`a single read confirmed ${server.maxConfirmed} actions`);
  assert.deepEqual(server.order,queue.map(m=>m.id),'mutation order preserved');
  assert.equal((await store.read(key))!.base.events.length,createSeed().events.length+60,'each action applied exactly once');
 }finally{await close();}
});

test('a deferred passive refresh timer cannot bypass overload backoff that began after it was armed',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const server=new Server();const {repo,store,key,close}=await setup(server,[]);
 try{
  await repo.ready();await until(()=>server.reads===1&&repo.getHealth().state==='saved');
  repo.refresh();await until(()=>true);for(let i=0;i<20;i++)await pause(); // within the coalescing window: a deferred timer is armed
  assert.equal(server.reads,1);
  server.readError=overload();repo.retry();await until(()=>server.reads===2&&!!repo.getHealth().errorKind);for(let i=0;i<20;i++)await pause();
  assert.equal(repo.getHealth().errorKind,'overload');
  await store.update(key,old=>({...old!,savedAt:new Date(Date.now()-60_000).toISOString()})); // window elapsed: only the backoff gate remains
  server.readError=undefined;
  t.mock.timers.tick(6_000);for(let i=0;i<30;i++)await pause();
  assert.equal(server.reads,2,'the deferred timer must not read while the retry timer owns recovery');
  assert.equal(repo.getHealth().state,'waiting');
 }finally{await close();}
});

test('a conflict blocking hundreds of queued actions throttles passive reads; explicit Retry and operator resolution still work',async()=>{
 const server=new Server(),conflict={...mutation(),state:'conflict' as const,message:'Another Chair changed this item. Review before applying.'};
 const behind=Array.from({length:300},mutation);
 const {repo,store,key,close}=await setup(server,[conflict,...behind]);
 try{
  await repo.ready();await until(()=>server.reads===1&&repo.getHealth().state==='conflict');
  assert.equal(server.sends,0,'nothing is sent past a conflict');
  for(let i=0;i<20;i++)repo.refresh();await pause();await pause();
  await repo.execute(mutation().command,'chair');await repo.execute(mutation().command,'chair');await pause();await pause();
  assert.equal(server.reads,1,'focus / Realtime / poll triggers and new actions behind the conflict cost no snapshot reads');
  assert.equal(server.sends,0);assert.equal(repo.getHealth().pending,303);
  repo.retry();await until(()=>server.reads===2);await pause();
  assert.equal(server.sends,0,'explicit Retry still reconciles, and still never sends past the conflict');
  assert.equal((await store.read(key))!.pending[0].id,conflict.id);assert.equal((await store.read(key))!.pending.length,303,'nothing discarded or auto-resolved');
  await repo.resolveConflict(conflict.id); // explicit operator action
  await until(()=>repo.getHealth().pending===0);
  assert.equal(server.receipts.size,302);assert.deepEqual(server.order.slice(0,300),behind.map(m=>m.id),'order preserved after resolution');
  assert.ok(server.maxConfirmed<=MAX_BATCH);
 }finally{await close();}
});

test('a failed snapshot read with an empty outbox is not shown as "All changes synced"',async()=>{
 const {saveStatus}=await import('../lib/save-status');
 const server=new Server();server.readError=Object.assign(Error('Gateway Timeout'),{status:504});
 const {repo,close}=await setup(server,[]);
 try{
  await repo.ready();await until(()=>server.reads>=1&&repo.getHealth().state==='waiting');
  const h=repo.getHealth();assert.equal(h.pending,0);
  const s=saveStatus({health:h,online:true,access:'active'});
  assert.notEqual(s.label,'All changes synced');assert.equal(s.tone,'attention');assert.equal(s.details,true);
 }finally{await close();}
});
