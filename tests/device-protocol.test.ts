import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableRepository,type Transport} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {SupabaseTransport} from '../lib/supabase/repository';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import {committeeOfCommand,displayedLabel} from '../lib/sessions/display';
import type {ConferenceData} from '../lib/domain';
import type {SupabaseClient} from '@supabase/supabase-js';

// Device protocol (docs/SESSION_MODEL.md 4, 5, 7): a stable device id, a sequence that only grows, the session the device displayed, and a clock
// report before anything is sent. Evidence only: none of it changes what is saved or applied.
const speech={type:'participation' as const,delegateId:'d0',sessionId:'s1',resolutionId:'r1',categoryId:'speech',points:2};
const tick=()=>new Promise(r=>setTimeout(r,15));
class Server implements Transport{
 actorId='test-chair';data=createSeed();online=true;sent:Mutation[]=[];clockCalls:string[]=[];clockFails=false;
 async read(){return structuredClone(this.data);}
 async send(m:Mutation){this.sent.push(structuredClone(m));this.data=applyCommand(this.data,m.command,m.role,m);}
 async syncClock(device:string){this.clockCalls.push(device);if(this.clockFails)throw Error('clock unavailable');}
}
const scheduled=(data:ConferenceData,at:number):ConferenceData=>{
 const committeeId=data.sessions.find(s=>s.id==='s1')!.committeeId;
 return {...data,sessionSchedules:[{committeeId,timeZone:'Asia/Qatar',overrides:[],versions:[{effectiveFrom:new Date(at-86400000).toISOString(),leadMinutes:5,graceMinutes:20,automationEnabled:true,
  sessions:[{id:'s1',start:new Date(at-3600000).toISOString(),end:new Date(at+3600000).toISOString()}]}]}]};
};

test('the device id is stable across restarts and the sequence only grows, across tabs',async()=>{
 const name='device-'+crypto.randomUUID();
 const store=new DurableStore(name);
 const a=await store.nextDeviceSeq(),b=await store.nextDeviceSeq();
 assert.equal(a.deviceId,b.deviceId);assert.equal(b.deviceSeq,a.deviceSeq+1);
 const results=await Promise.all([1,2,3,4,5].map(()=>store.nextDeviceSeq()));
 assert.equal(new Set(results.map(r=>r.deviceSeq)).size,5,'concurrent allocations never repeat');
 await store.close();
 const reopened=new DurableStore(name);
 const c=await reopened.nextDeviceSeq();
 assert.equal(c.deviceId,a.deviceId);assert.ok(c.deviceSeq>Math.max(...results.map(r=>r.deviceSeq)));
 await reopened.close();
});

test('hosted actions carry deviceId, deviceSeq and the displayed label; local demo actions carry none',async()=>{
 const store=new DurableStore('proto-'+crypto.randomUUID()),server=new Server();server.online=false;server.read=async()=>{throw Error('offline');};
 const repo=new DurableRepository('ga1',()=>scheduled(createSeed(),Date.now()),store,server);await repo.ready();await tick();
 await repo.execute(speech,'chair');await repo.execute(speech,'chair');
 const [m1,m2]=repo.getPending();
 assert.ok(m1.deviceId);assert.equal(m1.deviceId,m2.deviceId);assert.equal(m2.deviceSeq,m1.deviceSeq!+1);
 assert.equal(m1.displayedLabel,'s1','the schedule puts this committee in s1 now');
 repo.dispose();await store.close();
 const local=new DurableStore('local-'+crypto.randomUUID());const demo=new DurableRepository('ga1',createSeed,local);await demo.ready();await tick();
 await demo.execute(speech,'chair');
 assert.equal((await local.read('ga1'))!.pending.length,0,'the demo applies directly');
 await local.close();
});

test('the displayed label: unknown without a schedule, "no session" outside every window, the session inside one',()=>{
 const data=createSeed(),now=Date.now();
 const committeeId=data.sessions.find(s=>s.id==='s1')!.committeeId;
 assert.equal(displayedLabel(data,committeeId,new Date(now).toISOString()),undefined,'no schedule held: report nothing');
 assert.equal(displayedLabel(scheduled(data,now),committeeId,new Date(now).toISOString()),'s1');
 assert.equal(displayedLabel(scheduled(data,now),committeeId,new Date(now+5*3600000).toISOString()),null,'after close: an explicit "no session"');
 assert.equal(displayedLabel(scheduled(data,now),null,new Date(now).toISOString()),undefined);
 assert.equal(committeeOfCommand(data,{type:'participation',sessionId:'s1'} as {type:string}),committeeId);
 assert.equal(committeeOfCommand(data,{type:'vetoRules',committeeId:'x'} as {type:string}),'x');
 assert.equal(committeeOfCommand(data,{type:'import'}),null);
});

test('the clock is reported before the first send, at most once a minute, and a failure never stops the outbox',async()=>{
 const store=new DurableStore('clock-'+crypto.randomUUID()),server=new Server();
 const repo=new DurableRepository('ga1',createSeed,store,server);await repo.ready();await tick();
 server.clockFails=true;
 await repo.execute(speech,'chair');await tick();await tick();
 assert.equal(server.sent.length,1,'the action was sent although the clock call failed');
 assert.equal(server.clockCalls.length,1);
 assert.equal(server.clockCalls[0],server.sent[0].deviceId,'the clock is reported for the same device id the action carries');
 await repo.execute(speech,'chair');await tick();await tick();
 assert.equal(server.sent.length,2);assert.equal(server.clockCalls.length,1,'not again within a minute');
 repo.dispose();await store.close();
});

test('the hosted transport sends the protocol block with the command and never modifies the saved one',async()=>{
 const calls:{fn:string;args:Record<string,unknown>}[]=[];
 const client={rpc:async(fn:string,args:Record<string,unknown>)=>{calls.push({fn,args});return {error:null,data:null,status:200};},auth:{getSession:async()=>({data:{session:null}})}} as unknown as SupabaseClient;
 const transport=new SupabaseTransport(client,'conf-1','user-1');
 const saved:Mutation={id:crypto.randomUUID(),createdAt:new Date().toISOString(),actorId:'user-1',role:'chair',command:speech,expected:null,state:'pending',deviceId:'dev-1',deviceSeq:9,displayedLabel:null};
 await transport.send(saved);
 const sent=calls[0].args.command as Record<string,unknown>;
 assert.deepEqual(sent._device,{deviceId:'dev-1',deviceSeq:9,displayedLabel:null},'an explicit "no session" is sent as null');
 assert.equal((saved.command as Record<string,unknown>)._device,undefined,'the saved command is untouched');
 await transport.send(saved);
 assert.deepEqual(calls[1].args.command,calls[0].args.command,'a retry sends identical JSON');
 const legacy:Mutation={...saved,id:crypto.randomUUID(),deviceId:undefined,deviceSeq:undefined,displayedLabel:undefined};
 await transport.send(legacy);
 assert.equal((calls[2].args.command as Record<string,unknown>)._device,undefined,'an action saved by an older build is sent as before');
 const omitted:Mutation={...saved,id:crypto.randomUUID(),displayedLabel:undefined};
 await transport.send(omitted);
 assert.deepEqual((calls[3].args.command as {_device:Record<string,unknown>})._device,{deviceId:'dev-1',deviceSeq:9},'unknown displayed label is omitted, not null');
 await transport.syncClock('dev-1');
 assert.equal(calls[4].fn,'record_device_clock');assert.equal(calls[4].args.device,'dev-1');
 assert.ok(Number.isFinite(Date.parse(calls[4].args.device_time as string)));
});
