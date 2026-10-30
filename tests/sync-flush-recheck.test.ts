import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import {DurableRepository,ConflictError,type Transport} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {MAX_BATCH,retryDelay} from '../lib/sync/backoff';

// Regression: an action recorded while the device's sync read (opening, idle or confirmation) is in flight used to wait for
// the next poll (60 s, 120 s with Realtime) because execute()'s flush() returned at once while that flush was running.
// After a SUCCESSFUL flush the outbox is now re-checked. Failures follow the existing backoff path, never an immediate loop.
const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let n=0;n<500;n++){if(check())return;await pause();}assert.ok(check(),'repository did not settle');}
const mutation=():Mutation=>({id:crypto.randomUUID(),actorId:'chair-test',createdAt:new Date().toISOString(),role:'chair',state:'pending',expected:null,command:{type:'participation',committeeId:'ga1',delegateId:'d0',resolutionId:'r1',categoryId:'speech',points:2}});
const command=()=>mutation().command;
const OVERLOAD=()=>Object.assign(Error('canceling statement due to statement timeout'),{code:'57014'});

/** Manual clock for the repository's timers (>= 250 ms). Short timeouts (fake-indexeddb internals) pass straight through. */
function fakeTimers(){
 const real={set:globalThis.setTimeout,clear:globalThis.clearTimeout,random:Math.random};
 let now=0,next=0;const timers=new Map<object,{at:number;fn:()=>void}>();
 globalThis.setTimeout=((fn:()=>void,ms?:number,...args:unknown[])=>{
  if((ms??0)<250)return real.set(fn,ms,...args);
  const id={n:++next};timers.set(id,{at:now+(ms??0),fn:()=>fn()});return id;
 })as unknown as typeof setTimeout;
 globalThis.clearTimeout=((id:unknown)=>{if(id&&typeof id==='object'&&timers.has(id as object))timers.delete(id as object);else real.clear(id as never);})as typeof clearTimeout;
 Math.random=()=>0; // jitter off: poll 60 s / 120 s with Realtime, retry ladder at its floor
 return {
  pending:()=>timers.size,now:()=>now,
  /** Runs every timer due within `ms`, letting the async work each one starts settle before time moves on. */
  async advance(ms:number){
   const end=now+ms;
   for(;;){
    await pause();await pause();
    const due=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn();
   }
   now=end;await pause();await pause();
  },
  restore(){globalThis.setTimeout=real.set;globalThis.clearTimeout=real.clear;Math.random=real.random;},
 };
}
function gate(){let ok!:()=>void,bad!:(e:unknown)=>void;const promise=new Promise<void>((res,rej)=>{ok=res;bad=rej;});promise.catch(()=>undefined);return {promise,release:ok,fail:bad};}
class Server implements Transport {
 actorId='chair-test';data=createSeed();reads=0;sends=0;receipts=new Set<string>();order:string[]=[];conflictOn=new Set<string>();
 held:ReturnType<typeof gate>[]=[];active=0;maximum=0;unconfirmed=0;maxConfirmed=0;
 subscribe?:(refresh:()=>void,state:(connected:boolean)=>void)=>()=>void;
 /** The next read() waits until the returned gate is released (or failed). */
 hold(){const g=gate();this.held.push(g);return g;}
 async read(){
  this.reads++;this.active++;this.maximum=Math.max(this.maximum,this.active);
  try{const g=this.held.shift();if(g)await g.promise;await pause();this.maxConfirmed=Math.max(this.maxConfirmed,this.unconfirmed);this.unconfirmed=0;return structuredClone(this.data);}finally{this.active--;}
 }
 async send(m:Mutation){
  this.sends++;this.unconfirmed++;this.active++;this.maximum=Math.max(this.maximum,this.active);
  try{await pause();if(this.conflictOn.has(m.id))throw new ConflictError('Another Chair changed this item. Review before applying.');
   if(!this.receipts.has(m.id)){this.data=applyCommand(this.data,m.command,m.role,m);this.receipts.add(m.id);this.order.push(m.id);}}finally{this.active--;}
 }
}
async function setup(server:Server,pending:Mutation[]=[]){
 const key=crypto.randomUUID(),store=new DurableStore(key);await store.update(key,()=>({key,base:createSeed(),pending,savedAt:new Date(Date.now()-3600000).toISOString()}));
 const repo=new DurableRepository(key,createSeed,store,server);return {key,store,repo,close:async()=>{repo.dispose();await store.close();}};
}
async function withClock(fn:(clock:ReturnType<typeof fakeTimers>)=>Promise<void>){const clock=fakeTimers();try{await fn(clock);}finally{clock.restore();}}
type Win={window?:unknown};

test('(a)(i) opening read in flight: an action recorded meanwhile is sent when the read completes, not at pollDelay (Realtime on)',()=>withClock(async clock=>{
 const server=new Server(),opening=server.hold();let connect!:(c:boolean)=>void;server.subscribe=(_refresh,state)=>{connect=state;return()=>undefined;};
 (globalThis as Win).window={addEventListener(){},removeEventListener(){}};
 const {repo,store,key,close}=await setup(server);
 try{
  await repo.ready();connect(true);await until(()=>server.reads===1);
  assert.equal(repo.getHealth().realtime,true);
  await repo.execute(command(),'chair');assert.equal(repo.getHealth().pending,1);assert.equal(server.sends,0,'the opening read is still in flight');
  opening.release();
  await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,1,'sent right after the read completed');assert.equal(clock.now(),0,'no timer had to fire');
  assert.equal((await store.read(key))!.pending.length,0);assert.equal(server.maximum,1,'still one request at a time');
  await clock.advance(200_000);assert.equal(server.sends,1,'exactly once: the later poll finds nothing to send');
 }finally{delete (globalThis as Win).window;await close();}
}));

test('(b) idle read in flight: an action recorded meanwhile is sent when the read completes',()=>withClock(async clock=>{
 const server=new Server();const {repo,close}=await setup(server);
 try{
  await repo.ready();await until(()=>server.reads===1&&clock.pending()===1);
  const idle=server.hold();void repo.flush(); // empty outbox: this is the idle reconciliation read
  await until(()=>server.reads===2);
  await repo.execute(command(),'chair');assert.equal(server.sends,0);
  idle.release();await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,1);assert.equal(clock.now(),0,'not waiting for the poll timer');assert.equal(server.maximum,1);
 }finally{await close();}
}));

test('(c) confirmation read in flight: an action recorded meanwhile joins the next pass and nothing is sent twice',()=>withClock(async clock=>{
 const server=new Server();const first=mutation();const {repo,close}=await setup(server,[first]);
 try{
  const confirming=server.hold();
  await repo.ready();await until(()=>server.reads===1&&server.sends===1);
  const later=mutation();await repo.execute(later.command,'chair');assert.equal(repo.getHealth().pending,2);
  confirming.release();await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,2,'each action sent exactly once');assert.equal(server.receipts.size,2);assert.equal(server.maximum,1);assert.equal(clock.now(),0);
 }finally{await close();}
}));

test('(d) a failed read is not retried in a loop: it follows the existing backoff, then recovers once',()=>withClock(async clock=>{
 const server=new Server(),opening=server.hold();const {repo,close}=await setup(server);
 try{
  await repo.ready();await until(()=>server.reads===1);
  await repo.execute(command(),'chair');
  opening.fail(Error('Failed to fetch'));await until(()=>repo.getHealth().errorKind==='network');await pause();await pause();
  assert.equal(server.reads,1,'no immediate re-flush');assert.equal(server.sends,0);assert.equal(repo.getHealth().pending,1);assert.equal(repo.getHealth().retryAttempt,1);
  const delay=retryDelay(1,'network',()=>0);assert.equal(clock.pending(),1,'exactly the backoff timer');
  await clock.advance(delay-1);assert.equal(server.reads,1,'backoff not yet elapsed');
  await clock.advance(1);await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,1);assert.equal(repo.getHealth().retryAttempt,undefined);
 }finally{await close();}
}));

test('(e) conflict: an action recorded behind a conflicting item stays unsent after the read completes',()=>withClock(async()=>{
 const server=new Server(),blocked={...mutation(),state:'conflict' as const,message:'Review stale attendance'};
 const {repo,store,key,close}=await setup(server,[blocked]);
 try{
  const reading=server.hold();
  await repo.ready();await until(()=>server.reads===1);
  const behind=mutation();await repo.execute(behind.command,'chair');
  reading.release();await until(()=>!!repo.getHealth().lastSynced);await pause();await pause();
  assert.equal(server.sends,0,'nothing is sent behind a conflict');assert.equal(server.reads,1,'no extra read either');
  const pending=(await store.read(key))!.pending;assert.equal(pending.length,2);assert.equal(pending[0].state,'conflict');assert.equal(pending[1].state,'pending');
  assert.equal(repo.getHealth().conflicts,1);
 }finally{await close();}
}));

test('(f) overload backoff is honoured: no send during it, and a failed retry read neither loops nor shortens the ladder',()=>withClock(async clock=>{
 const server=new Server(),opening=server.hold();const {repo,close}=await setup(server);
 try{
  await repo.ready();await until(()=>server.reads===1);
  opening.fail(OVERLOAD());await until(()=>repo.getHealth().errorKind==='overload');await pause();
  await repo.execute(command(),'chair');await pause();
  assert.equal(server.sends,0,'a new action adds no request against a saturated server');assert.equal(server.reads,1);
  const first=retryDelay(1,'overload',()=>0),second=retryDelay(2,'overload',()=>0);assert.ok(second>first);
  // the retry sends the first action; its confirming read is in flight when another is recorded, then fails with overload
  const retryRead=server.hold();await clock.advance(first);await until(()=>server.reads===2);assert.equal(server.sends,1);
  await repo.execute(command(),'chair');assert.equal(server.sends,1);
  retryRead.fail(OVERLOAD());await until(()=>repo.getHealth().retryAttempt===2);await pause();await pause();
  assert.equal(server.reads,2,'no immediate re-flush after the failure');assert.equal(server.sends,1,'the acknowledged action is not resent, the new one waits');assert.equal(repo.getHealth().pending,2);
  await clock.advance(second-1);assert.equal(server.reads,2,'second rung of the ladder not yet reached');
  await clock.advance(1);await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,2);assert.equal(server.receipts.size,2);
 }finally{await close();}
}));

test('(g) dispose during an in-flight read: nothing is flushed afterwards and no timer is left behind',()=>withClock(async clock=>{
 const server=new Server(),opening=server.hold();const {repo,close}=await setup(server);
 try{
  await repo.ready();await until(()=>server.reads===1);
  await repo.execute(command(),'chair');
  repo.dispose();opening.release();await pause();await pause();await pause();
  assert.equal(server.sends,0,'no flush after dispose');assert.equal(server.reads,1);assert.equal(clock.pending(),0,'no timers leaked');
  await clock.advance(300_000);assert.equal(server.sends,0);assert.equal(server.reads,1);
 }finally{await close();}
}));

test('(h) MAX_BATCH is respected: more than one batch drains across successive passes, one request at a time',()=>withClock(async clock=>{
 const server=new Server(),opening=server.hold();const {repo,store,key,close}=await setup(server);const total=MAX_BATCH+7;
 try{
  await repo.ready();await until(()=>server.reads===1);
  for(let n=0;n<total;n++)await repo.execute(command(),'chair');
  assert.equal(server.sends,0);opening.release();
  await until(()=>repo.getHealth().pending===0);
  assert.equal(server.sends,total);assert.equal(server.receipts.size,total,'each action applied once');
  assert.equal(server.reads,1+Math.ceil(total/MAX_BATCH),'one opening read, then one confirming read per batch');
  assert.ok(server.maxConfirmed<=MAX_BATCH,`never more than ${MAX_BATCH} actions per confirming read (saw ${server.maxConfirmed})`);
  assert.equal(server.maximum,1,'never more than one request in flight');assert.equal(clock.now(),0);
  assert.equal((await store.read(key))!.pending.length,0);
 }finally{await close();}
}));
