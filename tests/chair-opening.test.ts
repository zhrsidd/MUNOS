import test from 'node:test';
import assert from 'node:assert/strict';
import {ChairOpening,mayShowChairOpening,type OpeningInput} from '../lib/chair-opening';
import {createSeed} from '../lib/seed';
const data=createSeed();
const input=():OpeningInput=>({pathname:'/chair',data:null,access:{status:'active',roles:['chair'],committeeIds:['ga1'],actorId:'actor',validUntil:Date.now()+60000},health:{mode:'supabase',state:'syncing',pending:0,conflicts:0,realtime:false,latency:null,message:'Opening',detail:''}});
function setup(){
 let now=0,id=0;const timers=new Map<number,{at:number,fn:()=>void}>();let resolve!:(c:typeof data.committees[0]|null)=>void;
 const promise=new Promise<typeof data.committees[0]|null>(r=>{resolve=r;});
 const opening=new ChairOpening(()=>promise,{now:()=>now,later:(fn,ms)=>{timers.set(++id,{at:now+ms,fn});return id as unknown as ReturnType<typeof setTimeout>;},cancel:id=>{timers.delete(id as unknown as number);}});
 const advance=(ms:number)=>{const target=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=target;};
 return {opening,advance,eligible:async(c:typeof data.committees[0]|null=data.committees[0])=>{resolve(c);await Promise.resolve();}};
}
test('fast snapshot cannot win the cache race; three seconds start after artwork paint',async()=>{
 const s=setup(),i=input();s.opening.update(i);s.opening.update({...i,data});assert.equal(s.opening.getSnapshot().phase,'checking');
 await s.eligible();s.advance(1000);assert.equal(s.opening.getSnapshot().phase,'artwork');s.opening.artworkReady();s.advance(1000);assert.equal(s.opening.getSnapshot().phase,'showing');
 s.opening.presented();s.advance(2999);assert.equal(s.opening.getSnapshot().phase,'showing');s.advance(1);assert.equal(s.opening.getSnapshot().phase,'done');
 s.opening.update({...i,data,pathname:'/chair/participation'});assert.equal(s.opening.getSnapshot().phase,'done');
});
test('slow startup waits for data; skip cannot bypass readiness',async()=>{
 const s=setup(),i=input();s.opening.update(i);await s.eligible();s.opening.artworkReady();s.opening.presented();s.opening.skip();assert.equal(s.opening.getSnapshot().phase,'showing');s.advance(5000);assert.equal(s.opening.getSnapshot().phase,'showing');s.opening.update({...i,data});assert.equal(s.opening.getSnapshot().phase,'done');
});
test('ready workspace may skip; hiding pauses the visible minimum',async()=>{
 const s=setup(),i={...input(),data};s.opening.update(i);await s.eligible();s.opening.artworkReady();s.opening.presented();s.advance(1000);s.opening.hidden();s.advance(9000);assert.equal(s.opening.getSnapshot().phase,'showing');s.opening.presented();s.advance(1999);assert.equal(s.opening.getSnapshot().phase,'showing');s.opening.skip();assert.equal(s.opening.getSnapshot().phase,'done');
});
test('disabled/uncached and failed or hanging artwork fall back without trapping startup',async()=>{
 const disabled=setup();disabled.opening.update(input());await disabled.eligible(null);assert.equal(disabled.opening.getSnapshot().phase,'done');
 const failed=setup();failed.opening.update(input());await failed.eligible();failed.opening.artworkFailed();assert.equal(failed.opening.getSnapshot().phase,'done');
 const hanging=setup();hanging.opening.update(input());hanging.advance(1500);await hanging.eligible();assert.equal(hanging.opening.getSnapshot().phase,'done');
 const image=setup();image.opening.update(input());await image.eligible();image.advance(5000);assert.equal(image.opening.getSnapshot().phase,'done');
});
test('recovery, expired/revoked access, actor change, other roles and demo always win',async()=>{
 for(const change of [{pathname:'/chair/health'},{pathname:'/admin'},{access:{...input().access,status:'noAccess' as const}},{access:{...input().access,status:'demo' as const}},{access:{...input().access,roles:['admin' as const]}},{access:{...input().access,validUntil:Date.now()-1}},{health:{...input().health,conflicts:1}},{health:{...input().health,pending:1}},{health:{...input().health,state:'error' as const}}]){
  const s=setup(),i=input();s.opening.update(i);await s.eligible();s.opening.artworkReady();s.opening.presented();assert.equal(mayShowChairOpening({...i,...change}),false);s.opening.update({...i,...change});assert.equal(s.opening.getSnapshot().phase,'done');
 }
 const s=setup();s.opening.update(input());s.opening.update({...input(),access:{...input().access,actorId:'other'}});await s.eligible();assert.equal(s.opening.getSnapshot().phase,'done');
});


test('actor and committee scope changes hide captured artwork synchronously, before effects',async()=>{
 for(const access of [{...input().access,actorId:'other'},{...input().access,committeeIds:['sc']}]){
  const s=setup();s.opening.update(input());await s.eligible();s.opening.artworkReady();
  const changed={...input(),access};assert.equal(s.opening.canPresent(changed),false);
  s.opening.update(changed);assert.equal(s.opening.getSnapshot().phase,'done');
 }
});
