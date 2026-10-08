import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccessGatedTransport,activeStaffGrants,cachedStaffAccess,grantAccess,NO_CONFERENCE_ACCESS,staffRoleForPath,type AccessGrant} from '../lib/access';
import {DurableRepository,type Transport} from '../lib/sync/repository';
import {DurableStore,type Mutation} from '../lib/sync/store';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
const now=Date.now(),future=new Date(now+3600000).toISOString();
const chair:AccessGrant={role:'chair',committee_id:'ga1',expires_at:future};
const tick=()=>new Promise(r=>setTimeout(r,15));

test('staff access requires active scoped grants and reports precise no-access state',()=>{
 const invalid:AccessGrant[]=[{...chair,expires_at:new Date(now).toISOString()},{...chair,revoked_at:new Date(now-1).toISOString()},{...chair,committee_id:null},{...chair,expires_at:'invalid'}];
 assert.deepEqual(activeStaffGrants(invalid,now),[]);
 const denied=grantAccess(invalid,'actor','staff@example.com',now);
 assert.equal(denied.status,'noAccess');assert.equal(denied.message,NO_CONFERENCE_ACCESS);
 const allowed=grantAccess([chair,chair],'actor','staff@example.com',now);
 assert.deepEqual(allowed.roles,['chair']);assert.deepEqual(allowed.committeeIds,['ga1']);assert.equal(allowed.validUntil,Date.parse(future));
 assert.deepEqual(grantAccess([{role:'admin',committee_id:null,expires_at:future}], 'executive',undefined,now).roles,['admin']);
});
test('offline authorization is bound to identity, valid lease and known staff scopes',()=>{
 const pointer={actorId:'a',validUntil:String(now+1000),roles:'["chair"]',committeeIds:'["ga1"]'};
 assert.equal(cachedStaffAccess(pointer,'a',undefined,now)?.status,'active');
 assert.equal(cachedStaffAccess(pointer,'b',undefined,now),null);
 assert.equal(cachedStaffAccess(pointer,'a',undefined,now+1000),null);
 assert.equal(cachedStaffAccess({...pointer,roles:'["owner"]'},'a',undefined,now),null);
 assert.equal(cachedStaffAccess({...pointer,committeeIds:'[]'},'a',undefined,now),null);
 assert.equal(cachedStaffAccess({...pointer,roles:'bad json'},'a',undefined,now),null);
 assert.equal(cachedStaffAccess({...pointer,validUntil:'NaN'},'a',undefined,now),null);
 assert.equal(staffRoleForPath('/admin/staff'),'admin');assert.equal(staffRoleForPath('/logistics'),'logistics');
});
test('revocation/sign-out stops a committed-response race without losing queued intent; same identity recovers once',async()=>{
 const store=new DurableStore('access-'+crypto.randomUUID());
 let allowed=true,online=false,revokeDuringSend=true,sends=0;const receipts=new Set<string>();let data=createSeed();
 const server:Transport={actorId:'chair-account',read:async()=>{if(!online)throw Error('Offline');return data;},send:async(m:Mutation)=>{
  if(!online)throw Error('Offline');sends++;
  if(!receipts.has(m.id)){data=applyCommand(data,m.command,m.role,m);receipts.add(m.id);}
  if(revokeDuringSend){allowed=false;revokeDuringSend=false;}
 }};
 const key='supabase:conference:chair-account';
 let repo=new DurableRepository(key,createSeed,store,new AccessGatedTransport(server,()=>allowed));
 await repo.ready();await tick();const initial=data.events.length;
 await repo.execute({type:'participation',delegateId:'d0',sessionId:'s1',resolutionId:'r1',categoryId:'speech',points:2},'chair');await tick();
 const savedId=repo.getPending()[0].id;online=true;await repo.flush();
 assert.equal(receipts.size,1);assert.equal(repo.getPending().length,1);
 await repo.flush();assert.equal(sends,1,'blocked identity cannot send again');
 const recovery=JSON.parse(await repo.exportRecovery());assert.equal(recovery.pending[0].id,savedId);repo.dispose();
 allowed=true;repo=new DurableRepository(key,createSeed,store,new AccessGatedTransport(server,()=>allowed));
 await repo.ready();await tick();await repo.flush();assert.equal(repo.getPending().length,0);assert.equal(receipts.size,1);assert.equal(data.events.length,initial+1);
 repo.dispose();await store.close();
});
test('an access gate cannot send another identity’s saved mutations',async()=>{
 let sends=0;const server:Transport={actorId:'new-user',read:async()=>createSeed(),send:async()=>{sends++;}};
 const gate=new AccessGatedTransport(server,()=>true);
 await assert.rejects(gate.send({id:'uuid',actorId:'previous-user',role:'chair',createdAt:new Date().toISOString(),expected:null,state:'pending',command:{type:'queue',sessionId:'s1',advance:true}}),/another staff identity/);
 assert.equal(sends,0);
});

test('prepared legacy device reopens offline; expired lease retains exportable outbox without Auth network calls',async()=>{
 const {RepositoryController}=await import('../lib/repository-instance');
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const previousEnv={...process.env};const originalFetch=globalThis.fetch;let requests=0;
 const controllers:InstanceType<typeof RepositoryController>[]=[];
 try{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  globalThis.fetch=async(input)=>{if(String(input).includes('/auth/'))requests++;return new Response(JSON.stringify({code:'PGRST000',message:'Offline test'}),{status:400,headers:{'content-type':'application/json'}});};
  process.env.NEXT_PUBLIC_DATA_BACKEND='supabase';process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:9';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='offline-test-key';process.env.NEXT_PUBLIC_CONFERENCE_ID='offline-recovery-test';
  const actor='prepared-staff',conf=process.env.NEXT_PUBLIC_CONFERENCE_ID,key=`supabase:${conf}:${actor}`;
  const store=new DurableStore();const seed=createSeed();
  await store.update(key,()=>({key,base:seed,pending:[],savedAt:new Date().toISOString()}));
  // This is the exact PR #12 pointer format; no new per-actor lease has been prepared yet.
  await store.savePreferences(`last-authorized:${conf}`,{key,actorId:actor,roles:'["chair"]',committeeIds:'["ga1"]',validUntil:String(Date.now()+48*3600000)});
  const first=new RepositoryController();controllers.push(first);await first.retryAccess();
  assert.equal(first.getAccess().status,'active');assert.ok(first.getSnapshot());
  await first.execute({type:'participation',delegateId:'d0',sessionId:'s1',resolutionId:'r1',categoryId:'speech',points:2},'chair');
  await tick();const pending=first.getPending()[0];assert.ok(pending);Reflect.get(first,'stop').call(first);
  await store.savePreferences(`staff-authorized:${conf}:${actor}`,{validUntil:String(Date.now()-1)});
  const expired=new RepositoryController();controllers.push(expired);await expired.retryAccess();
  assert.equal(expired.getAccess().status,'unavailable');assert.equal(expired.getSnapshot(),null);
  const recovery=JSON.parse((await expired.exportRecovery())!);assert.equal(recovery.pending[0].id,pending.id);
  assert.equal(requests,0,'neither anonymous signup nor token refresh is needed to reopen/export offline');
  await store.close();
 }finally{
  for(const controller of controllers){Reflect.get(controller,'stop').call(controller);await (Reflect.get(controller,'store') as DurableStore).close();}
  globalThis.fetch=originalFetch;
  if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else Reflect.deleteProperty(globalThis,'navigator');
  for(const key of ['NEXT_PUBLIC_DATA_BACKEND','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_CONFERENCE_ID']){if(previousEnv[key]===undefined)delete process.env[key];else process.env[key]=previousEnv[key];}
 }
});
