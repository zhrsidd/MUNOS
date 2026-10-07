import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Role} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {SupabaseTransport} from '../lib/supabase/repository';
import {countSnapshotRpcs,type RpcCounter} from '../scripts/rehearsal/rpc-counter';
import {report} from '../scripts/rehearsal/metrics';
import {SNAPSHOT_RPCS_PER_REFRESH} from '../scripts/rehearsal/estimate';

// The harness wraps the real transport's client exactly like this, so these counts are what a rehearsal report shows.
function device(roles:Role[],bundled=true){
 const sent:string[]=[];
 const client={async rpc(name:string){
  sent.push(name);
  if(!bundled&&name.endsWith('_state_snapshot'))return {data:null,error:{code:'PGRST202',message:'Could not find the function'}};
  if(name==='operations_snapshot')return {data:{},error:null};
  if(name.startsWith('apply_'))return {data:null,error:null};
  return {data:createSeed(),error:null};
 }} as unknown as SupabaseClient;
 const counter:RpcCounter={snapshot:0,byName:{}};
 const transport=new SupabaseTransport(countSnapshotRpcs(client,counter),'conference-test','staff-test',[],false,roles);
 const refresh=async()=>{const before=counter.snapshot;await transport.read();return counter.snapshot-before;};
 return {transport,counter,sent,refresh};
}

test('rehearsal counts one bundled snapshot RPC per logical refresh on current core',async()=>{
 for(const [roles,name] of [[['chair'],'conference_state_snapshot'],[['approval'],'conference_state_snapshot'],[['logistics'],'conference_state_snapshot'],[['admin'],'executive_state_snapshot']] as [Role[],string][]){
  const d=device(roles);
  for(let i=0;i<3;i++)assert.equal(await d.refresh(),1,`${roles}: one RPC per refresh`);
  assert.deepEqual(d.counter.byName,{[name]:3});
 }
 assert.equal(SNAPSHOT_RPCS_PER_REFRESH,1,'dry-run estimate uses the bundled count');
});

test('rehearsal counts two snapshot RPCs only when the fallback path is actually used',async()=>{
 const d=device(['chair'],false);
 assert.equal(await d.refresh(),3,'first refresh: failed bundled probe + core + operations');
 assert.equal(await d.refresh(),2,'fallback is cached: core + operations');
 assert.deepEqual(d.counter.byName,{conference_state_snapshot:1,conference_snapshot:2,operations_snapshot:2});
});

test('rehearsal counter ignores writes and leaves the RPC result untouched',async()=>{
 const d=device(['chair']);
 const before=d.counter.snapshot;
 await d.transport.send({id:crypto.randomUUID(),actorId:'staff-test',createdAt:new Date().toISOString(),role:'chair',state:'pending',expected:null,command:{type:'timer',sessionId:'s1',remaining:90,startedAt:0,duration:90}});
 assert.equal(d.counter.snapshot,before,'apply_* mutations are not snapshot reads');
 assert.ok(d.sent.some(n=>n.startsWith('apply_')));
});

test('report: snapshotRpcCalls is the measured sum, not refreshes × 2',()=>{
 const r=report([
  {action:'refresh',ms:100,outcome:'ok',rpcs:1},{action:'refresh',ms:100,outcome:'ok',rpcs:1},
  {action:'refresh',ms:100,outcome:'error',rpcs:1},{action:'refresh',ms:100,outcome:'ok',rpcs:2},
  {action:'attendance',ms:50,outcome:'ok'},
 ]);
 assert.equal(r.summary.snapshotRpcCalls,5);assert.equal(r.summary.snapshotRpcsPerRefresh,1.25);
 assert.equal(report([{action:'refresh',ms:1,outcome:'ok'},{action:'refresh',ms:1,outcome:'ok'}]).summary.snapshotRpcCalls,2,'uncounted samples default to the bundled 1');
});
