import test from 'node:test';
import assert from 'node:assert/strict';
import type {ConferenceData} from '../lib/domain';
import {freshDatabase} from './helpers/database';

const executive='72000000-0000-4000-8000-000000000001';
const chair='72000000-0000-4000-8000-000000000002';
const unassigned='72000000-0000-4000-8000-000000000003';
const otherExecutive='72000000-0000-4000-8000-000000000004';
const otherConference='72000000-0000-4000-8000-000000000005';
const denied=(error:unknown)=>{assert.equal((error as {code:string}).code,'42501');return true;};

test('Executive snapshot preserves configuration, limits audit payload and respects RLS',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(executive,'admin');await grant(chair,'chair',ids.ga1);await asOwner();
  await query('insert into auth.users(id) values($1),($2)',[unassigned,otherExecutive]);
  await query('insert into public.conferences(id,name,venue,date) values($1,$2,$3,$4)',[otherConference,'Other conference','Elsewhere','2026-11-12']);
  await query(`insert into public.user_access(conference_id,user_id,role,expires_at) values($1,$2,'admin',now()+interval '1 day')`,[otherConference,otherExecutive]);
  // Shared display timestamps deliberately cross the 50-row boundary. Internal
  // creation timestamps run in reverse so ordering by them would fail this test.
  for(let i=0;i<60;i++)await query(`insert into public.audit_log(id,conference_id,committee_id,"actorId",action,"entityId","createdAt",mutation_id,details,created_at,updated_at)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,[
   `73000000-0000-4000-8000-${String(i).padStart(12,'0')}`,ids.conference,ids.ga1,executive,`Audit ${i}`,ids.resolution,
   i<30?'2090-01-01T00:00:00Z':'2090-01-02T00:00:00Z',crypto.randomUUID(),JSON.stringify({internal:'must not appear',sequence:i}),new Date(Date.UTC(2091,0,60-i)).toISOString(),
  ]);
  const auditBefore=await query('select * from public.audit_log where conference_id=$1 order by id',[ids.conference]);
  const expectedAudit=await query(`select id,"actorId",action,"entityId","createdAt" from
   (select id,"actorId",action,"entityId","createdAt" from public.audit_log where conference_id=$1 order by "createdAt" desc,id desc limit 50) recent
   order by "createdAt",id`,[ids.conference]);
  const call=async(name:'executive_snapshot'|'conference_snapshot',conf=ids.conference)=>(await query<{s:ConferenceData}>(`select public.${name}($1) s`,[conf]))[0].s;
  await as(executive);
  const original=await call('conference_snapshot');
  const compact=await call('executive_snapshot');
  assert.deepEqual(Object.keys(compact).sort(),Object.keys(original).sort(),'same ConferenceData shape');
  for(const key of ['conference','committees','schools','staff','sessions','delegates','attendance','documents','scoring'] as const)
   assert.deepEqual(compact[key],original[key],`${key} remains complete`);
  for(const key of ['versions','events','queue','votes','criteria','awardScores','debateStates','speeches','poiQueue'] as const)
   assert.deepEqual(compact[key],[],`${key} is intentionally omitted from the light snapshot`);
  assert.deepEqual(compact.timers,{});
  assert.equal(compact.audit.length,50);
  assert.deepEqual(compact.audit.map(a=>a.id),expectedAudit.map(a=>a.id),'newest 50, stable oldest-first presentation');
  for(const [index,entry] of compact.audit.entries()){
   assert.deepEqual(Object.keys(entry).sort(),['id','actorId','action','entityId','createdAt'].sort(),'no mutation IDs, details or internal columns');
   const expected=expectedAudit[index];
   assert.equal(entry.action,expected.action);assert.equal(entry.actorId,expected.actorId);assert.equal(entry.entityId,expected.entityId);
   assert.equal(Date.parse(entry.createdAt),new Date(expected.createdAt as string).getTime());
  }
  assert.deepEqual(await call('conference_snapshot'),original,'full snapshot behavior is unchanged');
  assert.ok(original.audit.length>=60);
  await assert.rejects(()=>call('executive_snapshot',otherConference),denied);
  await as(unassigned);await assert.rejects(()=>call('executive_snapshot'),denied);
  await as(otherExecutive);await assert.rejects(()=>call('executive_snapshot'),denied);
  await as(chair);
  const chairOriginal=await call('conference_snapshot');
  assert.ok(chairOriginal.committees.length<original.committees.length,'fixture exercises committee restriction');
  {
   const chairCompact=await call('executive_snapshot');
   for(const key of ['committees','sessions','delegates','attendance','documents','staff','schools'] as const)
    assert.deepEqual(chairCompact[key],chairOriginal[key],`${key}: direct Chair RPC cannot widen RLS scope`);
   assert.deepEqual(chairCompact.audit,[],'Chair cannot access Executive audit');
  }
  await asOwner();
  assert.deepEqual(await query('select * from public.audit_log where conference_id=$1 order by id',[ids.conference]),auditBefore,'audit history is never truncated or rewritten');
  const [definition]=await query<{prosecdef:boolean;proconfig:string[];definition:string}>(`select p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='executive_snapshot'`);
  assert.equal(definition.prosecdef,false,'security invoker preserves RLS');
  assert.ok(definition.proconfig.some(s=>s.startsWith('search_path=')),'function pins its search path');
  assert.doesNotMatch(definition.definition,/public\.conference_snapshot\s*\(/i,'light snapshot must not build then discard the full snapshot');
  await db.exec('set role anon');await assert.rejects(()=>call('executive_snapshot'),denied);
 }finally{await db.close();}
});
