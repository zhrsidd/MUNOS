import test from 'node:test';
import assert from 'node:assert/strict';
import {ChairOpening,type OpeningInput} from '../lib/chair-opening';
import {createSeed} from '../lib/seed';
function input():OpeningInput {const data=createSeed();data.conference.features['committeeLoadingScreen:ga1']=true;return {pathname:'/chair',data,committeeId:'ga1',selectionReady:true,access:{status:'active',roles:['chair'],committeeIds:['ga1'],actorId:'actor',validUntil:Date.now()+60000},health:{mode:'supabase',state:'syncing',lastSynced:new Date().toISOString(),pending:0,conflicts:0,realtime:false,latency:null,message:'Opening',detail:''}};}
function setup(){let now=0,id=0;const timers=new Map<number,{at:number,fn:()=>void}>();const opening=new ChairOpening({now:()=>now,later:(fn,ms)=>{timers.set(++id,{at:now+ms,fn});return id as unknown as ReturnType<typeof setTimeout>;},cancel:id=>{timers.delete(id as unknown as number);}});const advance=(ms:number)=>{const target=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=target;};return {opening,advance};}
test('signed out then login waits for the confirmed snapshot and shows five visible seconds',()=>{
 const {opening:o,advance}=setup(),i=input();o.update({...i,data:null,access:{status:'signedOut',roles:[],committeeIds:[]}});assert.equal(o.getSnapshot().phase,'idle');o.update({...i,data:null,health:{...i.health,state:'error'}});advance(10000);assert.equal(o.getSnapshot().phase,'idle');o.update(i);assert.equal(o.getSnapshot().phase,'artwork');o.artworkReady();advance(2000);o.presented();advance(4999);assert.equal(o.getSnapshot().phase,'showing');advance(1);assert.equal(o.getSnapshot().phase,'done');
});
test('first-time device needs no cached setting; confirmed preferences determine multi-committee choice',()=>{
 const {opening:o}=setup(),i=input();i.access.committeeIds=['sc','ga1'];o.update({...i,selectionReady:false});assert.equal(o.getSnapshot().phase,'idle');o.update(i);assert.equal(o.getSnapshot().committee?.id,'ga1');
});
test('disabled confirmed committee uses the standard loader',()=>{const {opening:o}=setup(),i=input();i.data!.conference.features['committeeLoadingScreen:ga1']=false;o.update(i);assert.equal(o.getSnapshot().phase,'done');});
test('skip enters immediately once ready; hidden time does not count',()=>{const {opening:o,advance}=setup(),i=input();o.update(i);o.artworkReady();o.presented();advance(1000);o.hidden();advance(10000);assert.equal(o.getSnapshot().phase,'showing');o.presented();advance(3999);assert.equal(o.getSnapshot().phase,'showing');o.skip();assert.equal(o.getSnapshot().phase,'done');});
test('image error and hung image fall back safely',()=>{for(const fail of [true,false]){const {opening:o,advance}=setup();o.update(input());if(fail)o.artworkFailed();else advance(5000);assert.equal(o.getSnapshot().phase,'done');}});
test('recovery and authorization changes bypass the welcome; routing and sync do not repeat it',()=>{
 for(const change of [{pathname:'/chair/health'},{health:{...input().health,conflicts:1}},{health:{...input().health,pending:1}},{access:{...input().access,status:'noAccess' as const}},{access:{...input().access,actorId:'other'}},{access:{...input().access,committeeIds:['sc']}}]){const {opening:o}=setup(),i=input();o.update(i);o.artworkReady();assert.equal(o.canPresent({...i,...change}),false);o.update({...i,...change});assert.equal(o.getSnapshot().phase,'done');}
 const {opening:o}=setup(),i=input();o.update(i);o.artworkReady();o.skip();o.update({...i,pathname:'/chair/participation'});assert.equal(o.getSnapshot().phase,'done');
});

test('stale cached flags cannot decide the welcome before a successful read',()=>{const {opening:o}=setup(),i=input();const old=structuredClone(i);old.data!.conference.features['committeeLoadingScreen:ga1']=false;delete old.health.lastSynced;o.update(old);assert.equal(o.getSnapshot().phase,'idle');o.update(i);assert.equal(o.getSnapshot().phase,'artwork');});
test('missing multi-committee preference follows the console GA1 fallback',()=>{const {opening:o}=setup(),i=input();i.data!.committees.reverse();i.access.committeeIds=['sc','ga1'];i.committeeId='stale';o.update(i);assert.equal(o.getSnapshot().committee?.code,'GA1');});

test('a hung first read cannot indefinitely hide an otherwise usable cached workspace',()=>{const {opening:o,advance}=setup(),i=input();delete i.health.lastSynced;o.update(i);advance(4999);assert.equal(o.getSnapshot().phase,'idle');advance(1);assert.equal(o.getSnapshot().phase,'done');});

test('an explicit sign-out prepares a fresh welcome for the next login, without replaying on normal routing',()=>{const {opening:o}=setup(),i=input();o.update(i);o.artworkReady();o.skip();o.update({...i,access:{status:'signedOut',roles:[],committeeIds:[]},data:null});assert.equal(o.getSnapshot().phase,'idle');o.update(i);assert.equal(o.getSnapshot().phase,'artwork');});

test('sign-out clears an idle first-read deadline before the next login',()=>{const {opening:o,advance}=setup(),i=input();o.update({...i,health:{...i.health,lastSynced:undefined}});o.update({...i,data:null,access:{status:'signedOut',roles:[],committeeIds:[]}});advance(10000);assert.equal(o.getSnapshot().phase,'idle');o.update(i);assert.equal(o.getSnapshot().phase,'artwork');});
