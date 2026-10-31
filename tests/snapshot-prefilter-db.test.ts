import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freshDatabase} from './helpers/database';

// 20261101090000_snapshot_committee_prefilter: conference_snapshot skips other committees' rows before the per-row RLS check.
// It must be a pure optimisation: every caller sees exactly what it saw before.
const migration='20261101090000_snapshot_committee_prefilter.sql';
const users={
 chair:'30000000-0000-4000-8000-000000000001', twoCommittees:'30000000-0000-4000-8000-000000000002', approval:'30000000-0000-4000-8000-000000000003',
 logistics:'30000000-0000-4000-8000-000000000004', admin:'30000000-0000-4000-8000-000000000005', observer:'30000000-0000-4000-8000-000000000006',
 revoked:'30000000-0000-4000-8000-000000000007', expired:'30000000-0000-4000-8000-000000000008', nobody:'30000000-0000-4000-8000-000000000009',
};

test('real PostgreSQL: the committee pre-filter leaves every caller\'s conference snapshot unchanged',async()=>{
 const {db,ids,query,as,asOwner,grant,upgrade}=await freshDatabase({upgradeAt:migration});
 try{
  await grant(users.chair,'chair',ids.ga1);
  await grant(users.twoCommittees,'chair',ids.who);await grant(users.twoCommittees,'chair',ids.sc);
  await grant(users.approval,'approval');await grant(users.logistics,'logistics');await grant(users.admin,'admin');await grant(users.observer,'observer');
  await grant(users.revoked,'chair',ids.hrc);await grant(users.expired,'chair',ids.hrc);
  await asOwner();
  await db.query(`update public.user_access set revoked_at=now() where user_id=$1`,[users.revoked]);
  await db.query(`update public.user_access set expires_at=now()-interval '1 minute' where user_id=$1`,[users.expired]);
  await db.query(`insert into auth.users values ($1) on conflict do nothing`,[users.nobody]);
  // Rows in several committees and one conference-level audit row, so the filter has something to skip.
  await db.query(`insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values($1,$2,$3,'test',$2,gen_random_uuid(),'{}'),($1,null,$3,'test',$1,gen_random_uuid(),'{}')`,[ids.conference,ids.who,users.admin]);
  const snapshot=async(user:string|null)=>{
   if(user===null)await asOwner();else await as(user);
   try{return {data:(await query<{s:unknown}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s};}
   catch(e){return {error:(e as Error).message};}
  };
  const callers=[...Object.values(users),null];
  const before:Awaited<ReturnType<typeof snapshot>>[]=[];for(const u of callers)before.push(await snapshot(u));
  // Sanity: the fixture actually distinguishes callers (a committee Chair sees less than the Executive; nobody is refused).
  const byName=(name:keyof typeof users)=>before[callers.indexOf(users[name])] as {data?:{delegates:unknown[]};error?:string};
  assert.ok(byName('chair').data!.delegates.length>0&&byName('chair').data!.delegates.length<byName('admin').data!.delegates.length);
  assert.match(byName('nobody').error??'',/Conference access has not been granted/);
  await upgrade();
  for(const [i,u] of callers.entries())assert.deepEqual(await snapshot(u),before[i],`caller ${u??'owner'} sees the same snapshot`);
 }finally{await db.close();}
});

test('real PostgreSQL: visible_committees is the caller\'s live committee grants per role list, NULL when unrestricted',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(users.chair,'chair',ids.ga1);await grant(users.twoCommittees,'chair',ids.who);await grant(users.twoCommittees,'chair',ids.sc);
  await grant(users.approval,'approval');await grant(users.revoked,'chair',ids.hrc);
  await asOwner();await db.query(`update public.user_access set revoked_at=now() where user_id=$1`,[users.revoked]);
  await db.query(`insert into auth.users values ($1) on conflict do nothing`,[users.nobody]);
  const visible=async(user:string|null,roles:string)=>{
   if(user===null)await asOwner();else await as(user);
   const [r]=await query<{v:string[]|null}>(`select private.visible_committees($1,$2::public.conference_role[]) v`,[ids.conference,roles]);
   return r.v===null?null:[...r.v].sort();
  };
  assert.deepEqual(await visible(users.chair,'{chair}'),[ids.ga1]);
  assert.deepEqual(await visible(users.twoCommittees,'{admin,chair,observer}'),[ids.who,ids.sc].sort());
  assert.equal(await visible(users.approval,'{approval}'),null,'a conference-wide grant is unrestricted');
  assert.deepEqual(await visible(users.approval,'{admin,chair,observer}'),[],'no grant with those roles: nothing is visible');
  assert.deepEqual(await visible(users.revoked,'{chair}'),[],'revoked grants do not count');
  assert.deepEqual(await visible(users.nobody,'{chair}'),[]);
  assert.equal(await visible(null,'{chair}'),null,'owner and server callers are not filtered');
 }finally{await db.close();}
});

test('each pre-filtered table covers every role its read policy admits',async()=>{
 const {db,query,asOwner}=await freshDatabase();
 try{
  await asOwner();
  const sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
  const vars=Object.fromEntries([...sql.matchAll(/(v_\w+) uuid\[\] := private\.visible_committees\(conf, array\[([^\]]+)\]/g)].map(m=>[m[1],new Set(m[2].replace(/'/g,'').split(','))]));
  const scans=[...sql.matchAll(/from public\.(\w+) \w+ where [\w.]*conference_id=conf[^(]*? and \((v_\w+) is null/g)].map(m=>({table:m[1],v:m[2]}));
  assert.equal(scans.length,17,'every committee-scoped table scan in conference_snapshot is pre-filtered');
  for(const {table,v} of scans){
   // participation_history is a security-invoker view over participation_events.
   const policyTable=table==='participation_history'?'participation_events':table;
   const quals=(await query<{q:string}>(`select qual q from pg_policies where schemaname='public' and tablename=$1 and cmd in ('SELECT','ALL')`,[policyTable])).map(r=>r.q);
   assert.ok(quals.length>0,`${policyTable} has a read policy`);
   const roles=new Set(quals.flatMap(q=>[...q.matchAll(/'(\w+)'::conference_role/g)].map(m=>m[1])));
   for(const role of roles)assert.ok(vars[v].has(role),`${table}: pre-filter ${v} must include policy role ${role}`);
  }
 }finally{await db.close();}
});
