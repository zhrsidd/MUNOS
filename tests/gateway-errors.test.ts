import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {SupabaseTransport} from '../lib/supabase/repository';
import {ConflictError,DurableRepository} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';
import {createSeed} from '../lib/seed';
import {classifyError,errorMessage,errorStatus,transportError} from '../lib/sync/backoff';

const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const clientFor=(fetch:typeof globalThis.fetch)=>createClient('https://gateway-test.invalid','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch}});
const failureOf=async(fetch:typeof globalThis.fetch,op:'read'|'send')=>{
 const transport=new SupabaseTransport(clientFor(fetch),'conference','chair-test');
 try{
  if(op==='read')await transport.read();
  else await transport.send({id:crypto.randomUUID(),createdAt:new Date().toISOString(),actorId:'chair-test',role:'chair',command:{type:'participation',sessionId:'s1',delegateId:'d0',resolutionId:'r1',categoryId:'speech',points:2},expected:null,state:'pending'});
 }catch(error){return error;}
 throw Error('Expected the transport to fail');
};

test('classifier reads plain {message} objects and statuses, not only Error instances',()=>{
 assert.equal(errorMessage({message:'Gateway Timeout'}),'Gateway Timeout');
 assert.equal(errorMessage('x'),'x');
 assert.equal(errorMessage({}),'');
 assert.equal(errorStatus({status:504}),504);
 assert.equal(errorStatus({status:'x'}),undefined);
 assert.equal(classifyError({message:'Gateway Timeout'}),'overload');
 assert.equal(classifyError({message:'Bad Gateway'}),'overload');
 assert.equal(classifyError({message:'Too Many Requests'}),'overload');
 assert.equal(classifyError({message:'TypeError: Failed to fetch'}),'network');
 assert.equal(classifyError({status:429,message:'x'}),'overload');
 assert.equal(classifyError({status:503}),'overload');
 assert.equal(classifyError({status:404,message:'Not Found'}),'other');
 assert.equal(classifyError({code:'57014',message:'x'}),'overload');
 assert.equal(classifyError(new Error('Something unexpected')),'other');
});

test('transportError attaches the response status without changing the error object',()=>{
 const original={message:'Gateway Timeout',details:'d',hint:'h'};
 const same=transportError(original,504);
 assert.equal(same,original,'identity is preserved');
 assert.equal(errorStatus(same),504);
 assert.deepEqual(Object.keys(original),['message','details','hint'],'the status is not enumerable');
 assert.deepEqual(JSON.parse(JSON.stringify(original)),{message:'Gateway Timeout',details:'d',hint:'h'});
 assert.equal(classifyError(same),'overload');
 const err=new Error('boom');
 assert.equal(transportError(err),err,'no status to add: returned unchanged');
 assert.equal(transportError({status:502,message:'x'},504) && errorStatus(transportError({status:502,message:'x'},504)),502,'an existing status is not overwritten');
 const wrapped=transportError('plain text',504) as Error;
 assert.ok(wrapped instanceof Error);assert.equal(errorStatus(wrapped),504);assert.equal(wrapped.message,'plain text');
 const frozen=Object.freeze({message:'Bad Gateway'});
 assert.equal(errorStatus(transportError(frozen,502)),502,'a frozen object falls back to a wrapper');
});

// 520/521/525 and a bare 500 appeared in Saturday's gateway logs; their bodies do not say "overload", so only the status identifies them.
for(const [status,text] of [[504,'Gateway Timeout'],[502,'Bad Gateway'],[429,'Too Many Requests'],[503,'Service Unavailable'],[500,'Internal Server Error'],[520,'error code: 520'],[521,'error code: 521'],[525,'error code: 525']] as const) {
 test(`adapter: non-JSON HTTP ${status} on a snapshot read and on a send is recognised as server overload`,async()=>{
  for(const op of ['read','send'] as const) {
   const error=await failureOf(async()=>new Response(text,{status}),op);
   assert.equal(errorStatus(error),status,`${op}: status preserved`);
   assert.equal(classifyError(error),'overload',`${op}: classified as overload`);
   assert.ok(!(error instanceof ConflictError),`${op}: a gateway failure is never a conflict`);
  }
 });
}

test('adapter: JSON PostgREST failures keep their code; conflicts stay conflicts; network failures stay network',async()=>{
 const timeout=await failureOf(async()=>json(500,{code:'57014',message:'canceling statement due to statement timeout',details:null,hint:null}),'read');
 assert.equal(classifyError(timeout),'overload');
 assert.equal((timeout as {code?:string}).code,'57014');
 const busy=await failureOf(async()=>json(503,{code:'PGRST002',message:'Could not query the database for the schema cache. Retrying.',details:null,hint:null}),'send');
 assert.equal(classifyError(busy),'overload');
 const conflict=await failureOf(async()=>json(409,{code:'PT409',message:'Another Chair changed this item. Review before applying.',details:null,hint:null}),'send');
 assert.ok(conflict instanceof ConflictError,'a stale-revision rejection is still a ConflictError');
 const denied=await failureOf(async()=>json(403,{code:'42501',message:'permission denied',details:null,hint:null}),'send');
 assert.ok(denied instanceof ConflictError);
 const offline=await failureOf(async()=>{throw new TypeError('Failed to fetch');},'read');
 assert.equal(classifyError(offline),'network');
});

test('end to end: during a gateway-overload wait a new action is saved locally and sends no request; recovery drains it',async()=>{
 let requests=0,healthy=false;
 const sent:string[]=[];
 const fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  requests++;
  const url=String(input);
  if(!healthy)return new Response('error code: 521',{status:521});
  if(url.includes('/rpc/apply_conference_mutation')){sent.push(String(init?.body));return new Response(null,{status:204});}
  return json(200,createSeed());
 };
 const store=new DurableStore('gateway-'+crypto.randomUUID());
 const repo=new DurableRepository('gateway-test',createSeed,store,new SupabaseTransport(clientFor(fetch as typeof globalThis.fetch),'conference','chair-test'));
 const until=async(fn:()=>boolean)=>{for(let i=0;i<2000;i++){if(fn())return;await new Promise(r=>setImmediate(r));}throw Error('Did not settle');};
 try{
  await repo.ready();
  await until(()=>!!repo.getHealth().retryAt);
  assert.equal(repo.getHealth().errorKind,'overload');
  const before=requests;
  assert.ok(Date.parse(repo.getHealth().retryAt!)>Date.now()+5000,'overload ladder starts at 8 s or more, not 2 s');
  await repo.execute({type:'participation',sessionId:'s1',delegateId:'d0',resolutionId:'r1',categoryId:'speech',points:2},'chair');
  for(let i=0;i<50;i++)await new Promise(r=>setImmediate(r));
  assert.equal(requests,before,'no request was made while the overload retry was still in the future');
  assert.equal(repo.getPending().length,1,'the action stays durably queued');
  assert.equal(repo.getHealth().state,'waiting');
  healthy=true;
  repo.retry();
  await until(()=>repo.getPending().length===0);
  assert.equal(sent.length,1,'the queued action was sent exactly once after recovery');
 }finally{repo.dispose();await store.close();}
});
