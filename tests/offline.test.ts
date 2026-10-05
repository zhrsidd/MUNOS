import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableRepository,ConflictError,type Transport} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
const speech={type:'participation' as const,delegateId:'d0',sessionId:'s1',resolutionId:'r1',categoryId:'speech',points:2};
const tick=()=>new Promise(r=>setTimeout(r,15));
class TestServer implements Transport{
 actorId='test-chair'; data=createSeed(); online=false; loseResponse=false; receipts=new Set<string>();calls=0;
 async read(){if(!this.online)throw Error('network unavailable');return structuredClone(this.data);}
 async send(m:Mutation){this.calls++;if(!this.online)throw Error('network unavailable');if(!this.receipts.has(m.id)){this.data=applyCommand(this.data,m.command,m.role,m);this.receipts.add(m.id);}if(this.loseResponse){this.loseResponse=false;throw Error('Response lost after commit');}}
}
test('offline actions survive restart, lost response and duplicate retry exactly once',async()=>{
 const name='outbox-'+crypto.randomUUID();const store=new DurableStore(name),server=new TestServer();
 let repo=new DurableRepository('ga1',createSeed,store,server);await repo.ready();await tick();
 const initial=repo.getSnapshot()!.events.length;
 await repo.execute(speech,'chair');await repo.execute(speech,'chair');
 await repo.execute({type:'attendance',delegateId:'d0',sessionId:'s1',status:'Present & Voting'},'chair');
 await repo.execute({type:'timer',sessionId:'s1',remaining:90,duration:90,startedAt:Date.now()},'chair');
 await repo.execute({type:'queue',sessionId:'s1',advance:true},'chair');
 await tick();assert.equal(repo.getHealth().pending,5);assert.equal(repo.getSnapshot()!.events.length,initial+2);
 repo.dispose();await store.close();
 const reopened=new DurableStore(name);repo=new DurableRepository('ga1',createSeed,reopened,server);await repo.ready();await tick();assert.equal(repo.getHealth().pending,5);
 server.online=true;server.loseResponse=true;await repo.flush();assert.equal(server.receipts.size,1);assert.equal(repo.getHealth().pending,5);
 await repo.flush();assert.equal(repo.getHealth().pending,0);assert.equal(server.receipts.size,5);assert.equal(server.data.events.length,initial+2);
 repo.dispose();await reopened.close();
});
test('a conflict stays durable and prevents dependent changes from silently syncing',async()=>{
 const store=new DurableStore('conflict-'+crypto.randomUUID()),server=new TestServer();
 server.send=async()=>{throw new ConflictError('Another chair changed attendance');};
 const repo=new DurableRepository('ga1',createSeed,store,server);await repo.ready();await tick();
 await repo.execute({type:'attendance',delegateId:'d0',sessionId:'s1',status:'Absent'},'chair');await tick();
 assert.equal(repo.getHealth().conflicts,1);assert.equal(repo.getHealth().pending,1);
 const exported=JSON.parse(await repo.exportRecovery());assert.equal(exported.pending[0].state,'conflict');
 await repo.resolveConflict(exported.pending[0].id);await tick();assert.equal(repo.getHealth().pending,0);
 repo.dispose();await store.close();
});
test('local tabs update from the durable transaction without losing each other’s events',async()=>{
 const store=new DurableStore('tabs-'+crypto.randomUUID());const a=new DurableRepository('ga1',createSeed,store),b=new DurableRepository('ga1',createSeed,store);
 await a.ready();await b.ready();const initial=a.getSnapshot()!.events.length;
 await Promise.all([a.execute(speech,'chair'),b.execute(speech,'chair')]);
 assert.equal((await store.read('ga1'))!.base.events.length,initial+2);a.dispose();b.dispose();await store.close();
});
