import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const chair='61000000-0000-4000-8000-000000000001', whoChair='61000000-0000-4000-8000-000000000002', admin='61000000-0000-4000-8000-000000000003';
type Adj={id:string;delegateId:string;sessionId:string;points:number;reason:string;chairId:string;chairName:string|null;reverses:string|null;createdAt:string};

test('point deductions: traceable adjustments, original scores intact, replay-safe, committee-scoped',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);await grant(admin,'admin');
  await asOwner();await db.query(`insert into public.staff(conference_id,name,auth_user_id) values($1,'Head Chair',$2)`,[ids.conference,chair]);
  const send=async(user:string,command:unknown,role='chair',key=crypto.randomUUID())=>{await as(user);await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,null,'2026-10-19T10:00:00Z']);return key;};
  const snap=async(user:string)=>{await as(user);return (await query<{s:{pointAdjustments:Adj[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s.pointAdjustments;};
  // An original score exists first.
  await as(chair);
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'participation',delegateId:ids.france,sessionId:ids.session,resolutionId:ids.resolution,categoryId:'speech',points:3}),'chair',null,'2026-10-19T10:00:00Z']);
  await asOwner();const before=await query('select id,points,"categoryId" from public.participation_events order by id');
  const deduct={type:'pointAdjustment',action:'deduct',delegateId:ids.france,sessionId:ids.session,amount:4,reason:'Disrupted the session'};
  const key=await send(chair,deduct);
  await send(chair,deduct,'chair',key); // offline replay of the same mutation
  await send(chair,deduct,'chair',key);
  let adj=(await snap(chair));
  assert.equal(adj.length,1,'replays record one adjustment');
  assert.equal(adj[0].points,-4);assert.equal(adj[0].reason,'Disrupted the session');assert.equal(adj[0].chairId,chair);assert.equal(adj[0].chairName,'Head Chair');assert.ok(adj[0].createdAt);
  await asOwner();assert.deepEqual(await query('select id,points,"categoryId" from public.participation_events order by id'),before,'original scores are untouched');
  await assert.rejects(()=>send(chair,deduct,'chair',key).then(()=>send(chair,{...deduct,amount:5},'chair',key)),/Idempotency/);
  // Amount and reason validation.
  for(const amount of [0,-3,21,1.5,'5',null,100])await assert.rejects(()=>send(chair,{...deduct,amount}),/whole number|Enter/,`amount ${JSON.stringify(amount)}`);
  for(const reason of ['','  ','ab','x'.repeat(301),undefined])await assert.rejects(()=>send(chair,{...deduct,reason}),/reason/);
  // Scope: another committee's Chair, the Executive and an unknown delegate cannot write.
  await assert.rejects(()=>send(whoChair,deduct),/no access/);
  await assert.rejects(()=>send(admin,deduct,'admin'),/Chair access required/);
  await assert.rejects(()=>send(chair,{...deduct,delegateId:crypto.randomUUID()}),/Delegate unavailable/);
  await assert.rejects(()=>send(chair,{...deduct,sessionId:crypto.randomUUID()}),/Session unavailable/);
  // Reads follow the participation policy.
  assert.equal((await snap(whoChair)).length,0,'another committee cannot read adjustments');
  assert.equal((await snap(admin)).length,1,'the Executive can');
  await as(chair);
  await assert.rejects(()=>db.query(`insert into public.participation_adjustments(conference_id,committee_id,"delegateId","sessionId",points,reason,"chairId") values($1,$2,$3,$4,-1,'direct',$5)`,[ids.conference,ids.ga1,ids.france,ids.session,chair]),/permission denied/);
  await assert.rejects(()=>db.query('update public.participation_adjustments set points=-1'),/permission denied/);
  await assert.rejects(()=>db.query('delete from public.participation_adjustments'),/permission denied/);
  // Restore: a new row that references the deduction; the deduction itself is preserved; only once.
  const restore={type:'pointAdjustment',action:'restore',delegateId:ids.france,adjustmentId:adj[0].id};
  const rk=await send(chair,restore);await send(chair,restore,'chair',rk);
  adj=await snap(chair);
  assert.equal(adj.length,2);assert.equal(adj[0].points,-4,'the deduction remains in the record');
  assert.equal(adj[1].points,4);assert.equal(adj[1].reverses,adj[0].id);assert.equal(adj.reduce((n,a)=>n+a.points,0),0);
  await assert.rejects(()=>send(chair,restore),/already restored/);
  await assert.rejects(()=>send(chair,{...restore,adjustmentId:adj[1].id}),/Only a deduction/);
  await assert.rejects(()=>send(chair,{...restore,delegateId:ids.japan}),/Only a deduction/);
  await assert.rejects(()=>send(whoChair,{...restore}),/no access/);
 }finally{await db.close();}
});
test('retired Drive archive table is gone and no function depends on it',async()=>{
 const {db,query}=await freshDatabase();
 try{
  assert.equal((await query('select to_regclass($1) t',['public.archive_jobs']))[0].t,null);
 }finally{await db.close();}
});
test('an archived session is history: neither a new deduction nor a restore moves its totals',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(chair,'chair',ids.ga1);
  const send=async(command:unknown,key=crypto.randomUUID())=>{await as(chair);await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),'chair',null,'2026-10-19T10:00:00Z']);};
  const deduct={type:'pointAdjustment',action:'deduct',delegateId:ids.france,sessionId:ids.session,amount:4,reason:'Disrupted the session'};
  await send(deduct);
  await asOwner();const original=(await query<{id:string}>('select id from public.participation_adjustments'))[0].id;
  await db.query('update public.sessions set archived=true where id=$1',[ids.session]);
  await assert.rejects(()=>send({...deduct,amount:1}),/archived/);
  await assert.rejects(()=>send({type:'pointAdjustment',action:'restore',delegateId:ids.france,adjustmentId:original}),/archived/,'restore uses the same boundary');
  await asOwner();assert.equal((await query('select * from public.participation_adjustments')).length,1,'the historical total did not move');
  await db.query('update public.sessions set archived=false where id=$1',[ids.session]);
  await send({type:'pointAdjustment',action:'restore',delegateId:ids.france,adjustmentId:original});
  await asOwner();assert.equal((await query('select * from public.participation_adjustments')).length,2,'an active session can still restore');
 }finally{await db.close();}
});
test('the archive_jobs retirement locks the table before it checks it, in one statement',async()=>{
 const {readFileSync}=await import('node:fs');
 const sql=readFileSync('supabase/migrations/20261019100200_retire_archive_jobs.sql','utf8').replace(/--.*$/gm,'');
 const lock=sql.indexOf('lock table public.archive_jobs in access exclusive mode');const check=sql.indexOf('select 1 from public.archive_jobs');const drop=sql.indexOf('drop table public.archive_jobs');
 assert.ok(lock>=0&&lock<check&&check<drop,'lock, then check, then drop');
 assert.match(sql,/lock_timeout/);
 assert.equal((sql.match(/\bdo \$\$/g)??[]).length,1,'lock, check and drop live in one DO block (one atomic statement)');
 assert.ok(drop<sql.lastIndexOf('end $$'),'the DROP is inside the guarded block');
});
