import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

const executive='74000000-0000-4000-8000-000000000001';
const chair='74000000-0000-4000-8000-000000000002';
const approval='74000000-0000-4000-8000-000000000003';
const logistics='74000000-0000-4000-8000-000000000004';
const unassigned='74000000-0000-4000-8000-000000000005';
const denied=(error:unknown)=>{assert.equal((error as {code:string}).code,'42501');return true;};
type Snapshot=Record<string,unknown>;

test('bundled state snapshots compose core, operations and staff batch under each role RLS',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(executive,'admin');await grant(chair,'chair',ids.ga1);await grant(approval,'approval');await grant(logistics,'logistics');
  await asOwner();await query('insert into auth.users(id) values($1)',[unassigned]);
  const call=async(name:string)=>(await query<{s:Snapshot}>(`select public.${name}($1) s`,[ids.conference]))[0].s;
  for(const user of [executive,chair,approval,logistics]){
   await as(user);
   const operations=await call('operations_snapshot');
   assert.ok(Object.keys(operations).length>0,'fixture has operations data to merge');
   assert.deepEqual(await call('conference_state_snapshot'),{...await call('conference_snapshot'),...operations,...await call('staff_batch_snapshot')},'conference_state_snapshot = conference_snapshot || operations_snapshot');
   assert.deepEqual(await call('executive_state_snapshot'),{...await call('executive_snapshot'),...operations,...await call('staff_batch_snapshot')},'executive_state_snapshot = executive_snapshot || operations_snapshot');
  }
  await as(chair);
  const chairState=await call('conference_state_snapshot');
  await as(executive);
  assert.ok((chairState.committees as unknown[]).length<((await call('conference_state_snapshot')).committees as unknown[]).length,'Chair stays committee-scoped: SECURITY INVOKER keeps RLS');
  await as(unassigned);
  await assert.rejects(()=>call('conference_state_snapshot'),denied);await assert.rejects(()=>call('executive_state_snapshot'),denied);
  await db.exec('reset role; set role anon');
  await assert.rejects(()=>call('conference_state_snapshot'),denied);await assert.rejects(()=>call('executive_state_snapshot'),denied);
 }finally{await db.close();}
});

test('bundled state snapshots: right-hand (operations) precedence, NULL operations treated as {}, invoker + pinned search_path, pure composition',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(executive,'admin');
  const call=async(name:string)=>(await query<{s:Snapshot}>(`select public.${name}($1) s`,[ids.conference]))[0].s;
  // Throwaway database only: make operations_snapshot collide with a core key to observe precedence.
  await asOwner();
  await db.exec(`create or replace function public.operations_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('audit','from operations','photoSlots','[]'::jsonb) $$`);
  await as(executive);
  for(const [bundled,core] of [['conference_state_snapshot','conference_snapshot'],['executive_state_snapshot','executive_snapshot']]){
   const merged=await call(bundled);
   assert.equal(merged.audit,'from operations','operations keys retain their precedence');
   assert.deepEqual(merged,{...await call(core),audit:'from operations',photoSlots:[],...await call('staff_batch_snapshot')});
  }
  await asOwner();
  await db.exec(`create or replace function public.operations_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select null::jsonb $$`);
  await as(executive);
  assert.deepEqual(await call('conference_state_snapshot'),{...await call('conference_snapshot'),...await call('staff_batch_snapshot')},'NULL operations keeps the core snapshot (client used operations.data ?? {})');
  assert.deepEqual(await call('executive_state_snapshot'),{...await call('executive_snapshot'),...await call('staff_batch_snapshot')});
  await asOwner();
  const definitions=await query<{proname:string;prosecdef:boolean;provolatile:string;proconfig:string[];definition:string}>(`select p.proname,p.prosecdef,p.provolatile,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('conference_state_snapshot','executive_state_snapshot') order by p.proname`);
  assert.equal(definitions.length,2);
  for(const d of definitions){
   assert.equal(d.prosecdef,false,`${d.proname}: SECURITY INVOKER`);
   assert.equal(d.provolatile,'s',`${d.proname}: STABLE`);
   assert.ok(d.proconfig.some(s=>s==='search_path=""'||s==='search_path='),`${d.proname}: pinned empty search_path`);
   assert.match(d.definition,/public\.operations_snapshot\(conf\)/,'composes the existing operations snapshot');
   assert.match(d.definition,d.proname==='executive_state_snapshot'?/public\.executive_snapshot\(conf\)/:/public\.conference_snapshot\(conf\)/,'composes the existing core snapshot');
   assert.doesNotMatch(d.definition,/jsonb_build_object|jsonb_agg|from public\./i,'no duplicated snapshot SQL');
  }
  const grants=await query<{grantee:string}>(`select distinct grantee from information_schema.routine_privileges where routine_schema='public' and routine_name in ('conference_state_snapshot','executive_state_snapshot') and privilege_type='EXECUTE'`);
  assert.ok(grants.some(g=>g.grantee==='authenticated'),'authenticated may execute');
  assert.ok(!grants.some(g=>g.grantee==='anon'||g.grantee==='PUBLIC'),'anon/PUBLIC may not');
 }finally{await db.close();}
});
