import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {RepositoryController} from '../lib/repository-instance';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {createSeed} from '../lib/seed';
import type {browserClient} from '../lib/supabase/client';
import type {StaffAccess} from '../lib/access';

function mutation(state:Mutation['state']='pending'):Mutation{return {id:crypto.randomUUID(),actorId:'old-device',role:'chair',state,createdAt:new Date().toISOString(),expected:null,command:{type:'queue',sessionId:'s1',advance:true}};}
async function fixture(pending:Mutation[],status:StaffAccess['status']='active',validUntil=Date.now()+3600000){
 const store=new DurableStore('signout-'+crypto.randomUUID()),key=`supabase:${process.env.NEXT_PUBLIC_CONFERENCE_ID}:old-device`;
 const checkpoint=await store.update(key,()=>({key,base:createSeed(),pending,savedAt:new Date().toISOString()}));
 let signouts=0;
 const client=()=>({auth:{signOut:async(options:unknown)=>{assert.deepEqual(options,{scope:'local'});signouts++;return {error:null};}}}) as unknown as ReturnType<typeof browserClient>;
 const controller=new RepositoryController(store,client);
 Reflect.set(controller,'access',{status,actorId:'old-device',roles:['chair'],committeeIds:['ga1'],validUntil});
 Reflect.set(controller,'recoveryKey',key);
 return {store,key,checkpoint,controller,signouts:()=>signouts};
}

test('controller signs out a clean device without deleting its checkpoint',async()=>{
 const f=await fixture([]);
 try{await f.controller.signOut();assert.equal(f.signouts(),1);assert.equal(f.controller.getAccess().status,'signedOut');assert.deepEqual(await f.store.read(f.key),f.checkpoint);}finally{await f.store.close();}
});
for(const state of ['pending','conflict'] as const)test(`controller refuses active ${state} sign-out, including after export`,async()=>{
 const f=await fixture([mutation(state)]);
 try{
  await assert.rejects(f.controller.signOut(),/Sync or resolve/);
  const json=(await f.controller.exportRecovery())!;await f.controller.confirmRecoveryExport(json);
  await assert.rejects(f.controller.signOut(true),/Sync or resolve/);
  assert.equal(f.signouts(),0);assert.equal(f.controller.getAccess().status,'active');assert.deepEqual(await f.store.read(f.key),f.checkpoint);
 }finally{await f.store.close();}
});
for(const status of ['noAccess','unavailable','active'] as const)test(`${status==='active'?'expired':status} actor requires completed export and explicit final sign-out`,async()=>{
 const f=await fixture([mutation('conflict')],status,status==='active'?Date.now()-1:Date.now()+3600000);
 try{
  await assert.rejects(f.controller.signOut(),/Export your saved changes/);
  const json=(await f.controller.exportRecovery())!;
  assert.equal(JSON.parse(json).pending[0].id,f.checkpoint.pending[0].id);
  await assert.rejects(f.controller.signOut(true),/Export your saved changes/,'serialization alone is not a successful export');
  await f.controller.confirmRecoveryExport(json);
  await assert.rejects(f.controller.signOut(),/Confirm sign-out after recovery export/);
  await f.controller.signOut(true);assert.equal(f.signouts(),1);
  assert.deepEqual(await f.store.read(f.key),f.checkpoint,'UUIDs, conflict data and checkpoint remain after identity sign-out');
  Reflect.set(f.controller,'access',{status:'active',actorId:'new-device',roles:['chair'],committeeIds:['ga1'],validUntil:Date.now()+3600000});
  await assert.rejects(f.controller.confirmRecoveryExport(json),/identity changed/);
 }finally{await f.store.close();}
});
test('new or changed pending work invalidates recovery-export eligibility',async()=>{
 const f=await fixture([mutation()],'noAccess');
 try{
  const json=(await f.controller.exportRecovery())!;await f.controller.confirmRecoveryExport(json);
  await f.store.update(f.key,old=>({...old!,pending:[...old!.pending,mutation()]}));
  await assert.rejects(f.controller.signOut(true),/Export your saved changes/);
  await assert.rejects(f.controller.confirmRecoveryExport(json),/changed during export/);
  assert.equal(f.signouts(),0);
  const latest=(await f.controller.exportRecovery())!;await f.controller.confirmRecoveryExport(latest);
  await f.store.update(f.key,old=>({...old!,pending:old!.pending.map(m=>({...m,state:'conflict',message:'Archived session'}))}));
  await assert.rejects(f.controller.signOut(true),/Export your saved changes/);
 }finally{await f.store.close();}
});
test('sign-out waits for an already-started save and blocks new work while checking',async()=>{
 const f=await fixture([]);
 let release!:()=>void;const writing=new Promise<void>(resolve=>{release=resolve;});
 Reflect.set(f.controller,'writes',new Set([writing]));
 try{
  const signingOut=f.controller.signOut();
  await assert.rejects(f.controller.execute({type:'queue',sessionId:'s1',advance:true},'chair'),/Sign-out is being checked/);
  await f.store.update(f.key,old=>({...old!,pending:[mutation()]}));release();
  await assert.rejects(signingOut,/Sync or resolve/);assert.equal(f.signouts(),0);
 }finally{release();await f.store.close();}
});
