import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const executive='40000000-0000-4000-8000-000000000001', chair='40000000-0000-4000-8000-000000000002';
test('schedule import: executive-only, atomic, idempotent, skips existing sessions, notifies committees',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(executive,'admin');await grant(chair,'chair',ids.ga1);
  const send=async(user:string,command:unknown,id=crypto.randomUUID(),role='admin')=>{await as(user);return db.query('select public.apply_operations_mutation($1,$2,$3,$4,null,$5)',[ids.conference,id,JSON.stringify(command),role,'2026-11-01T00:00:00Z']);};
  const rows=[{committeeId:ids.ga1,name:'Committee Session 1',startsAt:'2026-11-12T06:45:00Z',endsAt:'2026-11-12T08:15:00Z'},{committeeId:ids.who,name:'Committee Session 1',startsAt:'2026-11-12T06:45:00Z',endsAt:null}];
  await assert.rejects(()=>send(chair,{type:'sessionImport',rows},crypto.randomUUID(),'chair'),/Executive access/);
  await assert.rejects(()=>send(executive,{type:'sessionImport',rows:[...rows,{...rows[0],startsAt:'2026-11-12T09:00:00Z',endsAt:'2026-11-12T08:00:00Z'}]}),/Session times invalid/);
  await asOwner();const before=(await query<{n:number}>('select count(*)::int n from public.sessions'))[0].n;
  const id=crypto.randomUUID();await send(executive,{type:'sessionImport',rows},id);await send(executive,{type:'sessionImport',rows},id);
  await asOwner();
  assert.equal((await query<{n:number}>('select count(*)::int n from public.sessions'))[0].n,before+2,'atomic rejection earlier, idempotent replay now');
  const created=await query<{id:string;endsAt:string|null}>('select id,"endsAt" from public.sessions where name=$1 order by id',['Committee Session 1']);
  assert.deepEqual(created.map(s=>s.id).sort(),[id.slice(0,24)+'000000000001',id.slice(0,24)+'000000000002']);
  await send(executive,{type:'sessionImport',rows});await asOwner();
  assert.equal((await query<{n:number}>('select count(*)::int n from public.sessions'))[0].n,before+2,'re-import skips existing');
  const notified=await query<{committee_id:string|null}>('select committee_id from public.operational_changes where topic=$1 order by created_at',['configuration']);
  assert.ok(notified.some(n=>n.committee_id===ids.ga1)&&notified.some(n=>n.committee_id===ids.who),'affected committees are notified');
  // The GA1 chair now sees its new session with an end time through the unchanged core snapshot.
  await as(chair);
  const snap=(await query<{s:{sessions:{name:string;endsAt:string|null}[]}}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const mine=snap.sessions.find(s=>s.name==='Committee Session 1')!;assert.ok(mine.endsAt);
  assert.equal(snap.sessions.filter(s=>s.name==='Committee Session 1').length,1,'RLS: only own committee');
  await asOwner();await assert.rejects(()=>db.query(`insert into public.sessions(conference_id,committee_id,name,"startsAt","endsAt",state) values($1,$2,'x','2026-11-12T10:00Z','2026-11-12T09:00Z','scheduled')`,[ids.conference,ids.ga1]),/sessions_ends_after_start/);
 }finally{await db.close();}
});
