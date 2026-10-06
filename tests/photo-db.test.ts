import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
const executive='50000000-0000-4000-8000-000000000001', ga1Chair='50000000-0000-4000-8000-000000000002', whoChair='50000000-0000-4000-8000-000000000003';
test('photo slots: executive writes, chairs read and acknowledge only their committee, targeted notifications',async()=>{
 const {db,ids,query,as,asOwner,grant,operationsExpected}=await freshDatabase();
 try{
  await grant(executive,'admin');await grant(ga1Chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);
  await asOwner();const school=(await query<{id:string;n:number}>('select "schoolId" id,count(*)::int n from public.delegates where committee_id=$1 group by 1 order by 2 desc limit 1',[ids.ga1]))[0].id;
  const send=async(user:string,command:unknown,role='admin',id=crypto.randomUUID())=>{await as(user);return db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify(command),role,await operationsExpected(command),'2026-11-01T00:00:00Z']);};
  const slot={schoolId:school,startsAt:'2026-11-12T10:30:00Z',endsAt:null,location:'Main Courtyard',note:''};
  await assert.rejects(()=>send(ga1Chair,{type:'photoSlot',action:'create',...slot},'chair'),/Executive access/);
  const create=crypto.randomUUID();await send(executive,{type:'photoSlot',action:'create',...slot},'admin',create);
  const slotId=create.slice(0,24)+'000000000001';
  await asOwner();
  const affected=(await query<{a:string[]}>('select private.committees_for_schools(array[$1]::uuid[]) a',[school]))[0].a;
  const notified=(await query<{committee_id:string}>('select committee_id from public.operational_changes where committee_id is not null and topic=$1',['configuration'])).map(r=>r.committee_id);
  assert.ok(affected.length>=1 && affected.every(c=>notified.includes(c)),'each affected committee is notified');
  // Chairs read slots; acknowledgements are committee-scoped.
  await as(ga1Chair);
  const snap=async()=>(await query<{s:{photoSlots:{id:string;revision:number}[];photoAcks:{committeeId:string}[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s;
  assert.equal((await snap()).photoSlots[0].id,slotId);
  await assert.rejects(()=>send(ga1Chair,{type:'photoAck',committeeId:ids.who,slotId,stage:'warning',revision:1},'chair'),/no access/);
  const ack=crypto.randomUUID();await send(ga1Chair,{type:'photoAck',committeeId:ids.ga1,slotId,stage:'warning',revision:1},'chair',ack);
  await send(ga1Chair,{type:'photoAck',committeeId:ids.ga1,slotId,stage:'warning',revision:1},'chair',ack);
  await send(ga1Chair,{type:'photoAck',committeeId:ids.ga1,slotId,stage:'warning',revision:1},'chair');
  assert.equal((await snap()).photoAcks.length,1,'idempotent and de-duplicated');
  await as(whoChair);assert.equal((await snap()).photoAcks.length,0,'WHO chair cannot see GA1 acknowledgements');
  // Reschedule bumps the revision.
  await send(executive,{type:'photoSlot',action:'update',slotId,...slot,startsAt:'2026-11-12T10:20:00Z',location:'Sports Hall'});
  await as(ga1Chair);assert.equal((await snap()).photoSlots[0].revision,2);
  // Bulk import skips existing school/time and rejects unknown schools atomically.
  await assert.rejects(()=>send(executive,{type:'photoImport',rows:[{...slot,startsAt:'2026-11-13T09:00:00Z'},{...slot,schoolId:'00000000-0000-4000-8000-000000000000'}]}),/School unavailable/);
  await send(executive,{type:'photoImport',rows:[{...slot,startsAt:'2026-11-12T10:20:00Z'},{...slot,startsAt:'2026-11-13T09:00:00Z'}]});
  await asOwner();assert.equal((await query<{n:number}>('select count(*)::int n from public.photo_slots'))[0].n,2);
  await db.exec('set role anon');await assert.rejects(()=>db.query('select * from public.photo_slots'),/permission denied/);
  await asOwner();await assert.rejects(()=>db.query(`insert into public.photo_slots(conference_id,school_id,starts_at,ends_at,location) values($1,$2,'2026-11-12T10:00Z','2026-11-12T09:00Z','x')`,[ids.conference,school]),/check/);
 }finally{await db.close();}
});
