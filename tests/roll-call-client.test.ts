import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableRepository,project} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import {atOrAfter,before,presenceAt,rollCallAt,withRollCallReference} from '../lib/sessions/presence';
import {felixContext} from '../lib/felix/context';
import {sessionOpportunities} from '../lib/country-search';
import type {ConferenceData,RollCall} from '../lib/domain';

// The database writes instants as "2026-10-05T10:00:00+00:00" (or in the session's own offset) and a device writes "2026-10-05T10:00:00.000Z".
// They are the same moment but different strings, so the client compares milliseconds.
const rc=(id:string,effectiveAt:string,status:'Present'|'Absent',revision=1):RollCall=>({id,revision,committeeId:'ga1',observedAt:effectiveAt,committedAt:effectiveAt,effectiveAt,timeConfidence:'trusted',
 rows:[{delegateId:'d0',status}]} as RollCall);
const withCalls=(calls:RollCall[]):ConferenceData=>({...createSeed(),rollCalls:calls});

test('presence compares instants, not strings: equal moments in different formats, and offsets',()=>{
 // Equal instants: a device time is not before a database time for the same moment.
 const d=withCalls([rc('a','2026-10-05T10:00:00.000Z','Present')]);
 assert.equal(presenceAt(d,'ga1','d0','2026-10-05T10:00:00+00:00'),'Present','as text ".000Z" sorts after "+00:00" and the roll call would be skipped');
 // 13:00+03:00 is 10:00Z: effective exactly at the action, although "13" sorts after "10".
 const offset=withCalls([rc('a','2026-10-05T13:00:00+03:00','Present')]);
 assert.equal(presenceAt(offset,'ga1','d0','2026-10-05T10:00:00.000Z'),'Present');
 assert.equal(presenceAt(offset,'ga1','d0','2026-10-05T09:59:59.999Z'),null,'a moment earlier: no roll call yet');
 // The later instant wins whatever the format: 12:30+03:00 (09:30Z) is earlier than 10:00Z although "12" sorts after "10".
 const mixed=withCalls([rc('early','2026-10-05T12:30:00+03:00','Absent'),rc('late','2026-10-05T10:00:00.000Z','Present')]);
 assert.equal(rollCallAt(mixed,'ga1')!.id,'late');
 assert.equal(presenceAt(mixed,'ga1','d0'),'Present');
 assert.equal(before('2026-10-05T12:30:00+03:00','2026-10-05T10:00:00.000Z'),true);
 assert.equal(atOrAfter('2026-10-05T10:00:00+00:00','2026-10-05T10:00:00.000Z'),true);
 assert.equal(atOrAfter('garbage','2026-10-05T10:00:00.000Z'),false,'an unreadable time never matches');
});

test('a queue action is accepted against a roll call recorded in the database format, and eligibility uses the same instants',()=>{
 const d=withCalls([rc('a','2026-10-05T10:00:00.000Z','Present')]);
 d.queue=[];
 const next=applyCommand(structuredClone(d),{type:'queueAdd',committeeId:'ga1',delegateId:'d0',lane:'open'},'chair',{id:'m1',createdAt:'2026-10-05T10:00:00+00:00'} as never);
 assert.equal(next.queue.some(q=>q.delegateId==='d0'),true);
});

test('Felix: a roll call taken in the session\'s window is not "due" because of how its time is written',()=>{
 const data=withCalls([rc('a','2026-10-05T13:00:00+03:00','Present')]);
 const now=Date.parse('2026-10-05T10:30:00Z');
 data.sessionSchedules=[{committeeId:'ga1',timeZone:'Asia/Qatar',overrides:[],versions:[{effectiveFrom:'2026-10-04T00:00:00.000Z',leadMinutes:5,graceMinutes:20,automationEnabled:true,
  sessions:[{id:'s1',start:'2026-10-05T10:00:00.000Z',end:'2026-10-05T12:00:00.000Z'}]}]}] as never;
 // 13:00+03:00 is 10:00Z: at the window start, so it counts as taken for this session.
 assert.equal(felixContext(data,'chair','ga1',now).chair!.rollCallDue,false);
 const old=withCalls([rc('a','2026-10-05T12:30:00+03:00','Present')]);old.sessionSchedules=data.sessionSchedules;
 assert.equal(felixContext(old,'chair','ga1',now).chair!.rollCallDue,true,'09:30Z is before the window began');
});

test('session counts compare instants: an event at the window start is included whichever way it is written',()=>{
 const ev=(id:string,createdAt:string)=>({id,categoryId:'speech',committeeId:'ga1',delegateId:'d0',points:1,createdAt,chairId:'c',resolutionId:null} as never);
 const counts=sessionOpportunities([ev('1','2026-10-05T13:00:00+03:00'),ev('2','2026-10-05T12:59:59+03:00')],'ga1','2026-10-05T10:00:00.000Z');
 assert.deepEqual(counts,{d0:{speeches:1,pois:0}});
});

test('presence-gated actions save the roll call they relied on; others and unchanged references are left alone',()=>{
 const d=withCalls([rc('a','2026-10-05T10:00:00.000Z','Present'),rc('a','2026-10-05T10:00:00.000Z','Absent',2)]);
 const at='2026-10-05T11:00:00.000Z';
 const queued=withRollCallReference(d,'ga1',{type:'queueAdd',committeeId:'ga1',delegateId:'d0',lane:'open'},at) as {rollCall?:{id:string;revision:number}};
 assert.deepEqual(queued.rollCall,{id:'a',revision:2},'the live revision');
 for(const type of ['speechStart','speechYield','poiAdd','queue'])
  assert.deepEqual((withRollCallReference(d,'ga1',{type,committeeId:'ga1',delegateId:'d0'},at) as {rollCall?:unknown}).rollCall,{id:'a',revision:2},type);
 for(const c of [{type:'queue',committeeId:'ga1',advance:true},{type:'participation',committeeId:'ga1'},{type:'vote',committeeId:'ga1'},{type:'debateMode',committeeId:'ga1'}])
  assert.equal('rollCall' in withRollCallReference(d,'ga1',c,at),false,c.type);
 const cited={type:'queueAdd',rollCall:{id:'x',revision:1}};
 assert.equal(withRollCallReference(d,'ga1',cited,at),cited,'an existing reference is kept');
 assert.equal('rollCall' in withRollCallReference(withCalls([]),'ga1',{type:'queueAdd'},at),false,'no live roll call: nothing to cite');
});

test('the saved action in the outbox carries the roll call, so offline work is judged against what the Chair saw',async()=>{
 const store=new DurableStore('rc-ref-'+crypto.randomUUID());
 const sent:unknown[]=[];
 const server={actorId:'t',read:async()=>{throw Error('offline');},send:async(m:unknown)=>{sent.push(m);},syncClock:async()=>{}};
 const repo=new DurableRepository('ga1',createSeed,store,server as never);await repo.ready();await new Promise(r=>setTimeout(r,15));
 const live=rollCallAt(repo.getSnapshot()!,'ga1')!;
 await repo.execute({type:'queueAdd',committeeId:'ga1',delegateId:'d3',lane:'open'},'chair');
 const [m]=repo.getPending();
 assert.deepEqual((m.command as {rollCall?:unknown}).rollCall,{id:live.id,revision:live.revision});
 repo.dispose();await store.close();
});

// ---- replay honours the saved citation (mirrors private.eligible) ----------------------------------------------------------
const trusted=(c:RollCall,t:'trusted'|'uncertain'):RollCall=>({...c,timeConfidence:t});
const queueAdd={type:'queueAdd' as const,committeeId:'ga1',delegateId:'d0',lane:'open' as const};
const queued=(d:ConferenceData,c:object)=>applyCommand(structuredClone(d),c as never,'chair',{id:'m',createdAt:'2026-10-05T10:45:00.000Z'} as never).queue.some(q=>q.delegateId==='d0');

test('a saved citation keeps a queued action valid after a later Uncertain roll call arrives; a later Trusted one supersedes it',()=>{
 const cited=trusted(rc('a','2026-10-05T10:00:00.000Z','Present'),'trusted');
 const laterUncertain=trusted(rc('b','2026-10-05T10:30:00.000Z','Absent'),'uncertain');
 const laterTrusted=trusted(rc('b','2026-10-05T10:30:00.000Z','Absent'),'trusted');
 const ref={rollCall:{id:'a',revision:1}};
 const withUncertain=withCalls([cited,laterUncertain]);withUncertain.queue=[];
 assert.throws(()=>queued(withUncertain,queueAdd),/present/i,'by time alone the later roll call (Absent) is live');
 assert.equal(queued(withUncertain,{...queueAdd,...ref}),true,'the citation is honoured, as on the server');
 const withTrusted=withCalls([cited,laterTrusted]);withTrusted.queue=[];
 assert.throws(()=>queued(withTrusted,{...queueAdd,...ref}),/present/i,'a later Trusted revision effective before the action supersedes the citation');
 const missing=withCalls([laterUncertain]);missing.queue=[];
 assert.throws(()=>queued(missing,{...queueAdd,...ref}),/present/i,'a roll call this device does not hold is refused, as on the server');
});

test('reload: a pending cited action stays projected over a base that holds a later Uncertain roll call',()=>{
 const base=withCalls([trusted(rc('a','2026-10-05T10:00:00.000Z','Present'),'trusted'),trusted(rc('b','2026-10-05T10:30:00.000Z','Absent'),'uncertain')]);base.queue=[];
 const pending=(command:object)=>({id:crypto.randomUUID(),createdAt:'2026-10-05T10:45:00.000Z',actorId:'t',role:'chair' as const,command,expected:'',state:'pending' as const});
 const cp=(m:object)=>({key:'k',base,pending:[m],savedAt:'x'} as never);
 assert.equal(project(cp(pending({...queueAdd,rollCall:{id:'a',revision:1}}))).queue.some(q=>q.delegateId==='d0'),true,'projection shows the action the server accepts');
 assert.equal(project(cp(pending(queueAdd))).queue.some(q=>q.delegateId==='d0'),false,'without a citation the later roll call decides');
});

test('POI recognition saves its citation and is accepted locally and in replay',async()=>{
 const data=createSeed();
 data.rollCalls=[trusted(rc('a','2026-10-05T10:00:00.000Z','Present'),'trusted')];
 data.rollCalls[0].rows=[{delegateId:'d1',status:'Present'},{delegateId:'d2',status:'Present'}] as never;
 data.speeches=[{id:'sp1',committeeId:'ga1',delegateId:'d1',resolutionId:'r1',amendmentId:null,classification:'Other',yieldedFrom:null,state:'pois',poiLimit:null,poiCount:0,revision:2,createdAt:'2026-10-05T10:00:00.000Z'}] as never;
 data.poiQueue=[{id:'p1',speechId:'sp1',delegateId:'d2',position:0,recognizedAt:null}] as never;
 const store=new DurableStore('poi-ref-'+crypto.randomUUID());
 const server={actorId:'t',read:async()=>{throw Error('offline');},send:async()=>{},syncClock:async()=>{}};
 const repo=new DurableRepository('ga1',()=>structuredClone(data),store,server as never);await repo.ready();await new Promise(r=>setTimeout(r,15));
 await repo.execute({type:'poiRecognize',committeeId:'ga1',speechId:'sp1',entryId:'p1'},'chair');
 const [m]=repo.getPending();
 assert.deepEqual((m.command as {rollCall?:unknown}).rollCall,{id:'a',revision:1});
 // Replay over a base that now holds a later Uncertain Absent roll call still projects the recognition.
 const later=structuredClone(data);later.rollCalls!.push(trusted({...rc('b','2026-10-05T10:30:00.000Z','Absent'),rows:[]} as RollCall,'uncertain'));
 const shown=project({key:'k',base:later,pending:[m],savedAt:'x'} as never);
 assert.ok(shown.poiQueue!.find(p=>p.id==='p1')!.recognizedAt,'recognized in the projection');
 repo.dispose();await store.close();
});
