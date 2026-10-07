import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import {DurableRepository,ConflictError,type Transport} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let n=0;n<300;n++){if(check())return;await pause();}assert.ok(check(),'repository did not settle');}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
const mutation=():Mutation=>({id:crypto.randomUUID(),actorId:'chair-test',createdAt:new Date().toISOString(),role:'chair',state:'pending',expected:null,command:{type:'participation',sessionId:'s1',delegateId:'d0',resolutionId:'r1',categoryId:'speech',points:2}});
class CountingServer implements Transport {
 actorId='chair-test';data=createSeed();reads=0;sends=0;active=0;maximum=0;receipts=new Set<string>();
 readGate?:ReturnType<typeof gate>;failRead=false;loseResponse=false;
 async read(){this.reads++;this.active++;this.maximum=Math.max(this.maximum,this.active);try{await this.readGate?.promise;if(this.failRead)throw Error('Read failed');return structuredClone(this.data);}finally{this.active--;}}
 async send(m:Mutation){this.sends++;this.active++;this.maximum=Math.max(this.maximum,this.active);try{await pause();if(!this.receipts.has(m.id)){this.data=applyCommand(this.data,m.command,m.role,m);this.receipts.add(m.id);}if(this.loseResponse){this.loseResponse=false;throw Error('Response lost');}}finally{this.active--;}}
}
async function setup(server:CountingServer,pending:Mutation[]){
 const key=crypto.randomUUID(),store=new DurableStore(key);await store.update(key,()=>({key,base:createSeed(),pending,savedAt:new Date().toISOString()}));
 const repo=new DurableRepository(key,createSeed,store,server);return {key,store,repo,close:async()=>{repo.dispose();await store.close();}};
}
test('batch acknowledgement keeps required read-back, one in-flight sync, and no extra final read',async()=>{
 const server=new CountingServer();server.readGate=gate();const a=mutation(),b=mutation();const {repo,store,key,close}=await setup(server,[a,b]);
 try{
  await repo.ready();await until(()=>server.reads===1);
  assert.equal(server.sends,1);assert.deepEqual((await store.read(key))!.pending.map(m=>m.id),[a.id,b.id],'acknowledgement alone must not remove durable intent');
  await Promise.all(Array.from({length:12},()=>repo.flush()));repo.retry();repo.retry();
  assert.equal(server.reads,1);assert.equal(server.maximum,1);
  server.readGate.release();await until(()=>repo.getHealth().pending===0);await pause();
  assert.equal(server.sends,2);assert.equal(server.reads,2,'one read-back per mutation; no third final snapshot');assert.equal(server.maximum,1);
  assert.equal((await store.read(key))!.base.events.length,createSeed().events.length+2);
  await repo.flush();assert.equal(server.reads,3,'empty-outbox recovery polling still reads');
 }finally{server.readGate.release();await close();}
});
test('intent appended while the acknowledgement read is in flight stays in the same batch',async()=>{
 const server=new CountingServer();server.readGate=gate();const {repo,close}=await setup(server,[mutation()]);
 try{
  await repo.ready();await until(()=>server.reads===1);
  await repo.execute(mutation().command,'chair');assert.equal(repo.getHealth().pending,2);
  server.readGate.release();await until(()=>repo.getHealth().pending===0);await pause();
  assert.equal(server.sends,2);assert.equal(server.reads,2);assert.equal(server.maximum,1);
 }finally{server.readGate.release();await close();}
});
test('failed read-back retains acknowledged UUID and retry is exactly once',async()=>{
 const server=new CountingServer();server.failRead=true;const m=mutation();const {repo,store,key,close}=await setup(server,[m]);
 try{
  await repo.ready();await until(()=>server.reads===1&&repo.getHealth().state==='waiting');await pause();
  assert.equal((await store.read(key))!.pending[0].id,m.id);assert.equal(server.receipts.size,1);
  server.failRead=false;await repo.flush();assert.equal(repo.getHealth().pending,0);
  assert.equal(server.sends,2);assert.equal(server.reads,2);assert.equal(server.receipts.size,1);assert.equal(server.data.events.length,createSeed().events.length+1);
 }finally{await close();}
});
test('lost send response retains UUID and recovers with one successful read-back',async()=>{
 const server=new CountingServer();server.loseResponse=true;const m=mutation();const {repo,close}=await setup(server,[m]);
 try{
  await repo.ready();await until(()=>server.sends===1&&repo.getHealth().state==='waiting');await pause();
  assert.equal(repo.getHealth().pending,1);assert.equal(server.reads,0);
  await repo.flush();assert.equal(repo.getHealth().pending,0);assert.equal(server.sends,2);assert.equal(server.receipts.size,1);assert.equal(server.reads,1);
 }finally{await close();}
});
test('existing conflict still reconciles and blocks subsequent pending intent',async()=>{
 const server=new CountingServer(),first={...mutation(),state:'conflict' as const,message:'Review stale attendance'},second=mutation();
 const {repo,store,key,close}=await setup(server,[first,second]);
 try{
  await repo.ready();await until(()=>!!repo.getHealth().lastSynced&&repo.getHealth().state==='conflict');await pause();await repo.flush();
  assert.equal(server.sends,0);assert.equal(server.reads,2);assert.equal(repo.getHealth().conflicts,1);
  assert.deepEqual((await store.read(key))!.pending.map(m=>[m.id,m.state]),[[first.id,'conflict'],[second.id,'pending']]);
 }finally{await close();}
});
test('new conflict preserves failed and subsequent intent without a final read',async()=>{
 const server=new CountingServer();server.send=async()=>{server.sends++;throw new ConflictError('Review change');};
 const first=mutation(),second=mutation();const {repo,store,key,close}=await setup(server,[first,second]);
 try{
  await repo.ready();await until(()=>repo.getHealth().conflicts===1);await pause();
  assert.equal(server.reads,0);assert.equal(server.sends,1);assert.equal(repo.getHealth().pending,2);
  assert.deepEqual((await store.read(key))!.pending.map(m=>m.id),[first.id,second.id]);
 }finally{await close();}
});
