import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupSessions} from './helpers/session-fixture';

// 20261031100000_attendance_to_roll_calls: saved attendance becomes one legacy committed roll call per session (docs/SESSION_MODEL.md 12.8).
// The fixture has already applied every migration, so the conversion ran over empty data; run its statements again over real rows.
const sql=readFileSync('supabase/migrations/20261031100000_attendance_to_roll_calls.sql','utf8');
const conversion=sql.slice(sql.indexOf('insert into public.roll_call '),sql.indexOf('drop table public.timers'));

test('real PostgreSQL: attendance converts to one legacy roll call per session, whole and idempotent; the timers table is gone',async()=>{
 const f=await setupSessions();const {db,ids,query,asOwner}=f;
 try{
  await asOwner();
  const delegates=(await query<{id:string}>('select id from public.delegates where committee_id=$1 order by id',[ids.ga1])).map(r=>r.id);
  assert.ok(delegates.length>=3);
  const [session]=await query<{id:string;startsAt:string}>(`select id,"startsAt" from public.sessions where committee_id=$1 order by "startsAt" limit 1`,[ids.ga1]);
  // Attendance was taken for two delegates only; the third was never marked.
  await db.query(`insert into public.attendance(conference_id,committee_id,"delegateId","sessionId",status) values($1,$2,$3,$4,'Present & Voting'),($1,$2,$5,$4,'Absent')`,[ids.conference,ids.ga1,delegates[0],session.id,delegates[1]]);
  await db.exec(conversion);
  const rolls=await query<{id:string;legacy:boolean;state:string;effective_at:string;time_confidence:string|null}>(`select id,legacy,state,effective_at,time_confidence from public.roll_call where committee_id=$1 and legacy`,[ids.ga1]);
  assert.equal(rolls.length,1,'one roll call for the one session with attendance');
  assert.equal(rolls[0].state,'committed');assert.equal(rolls[0].time_confidence,null);
  assert.equal(new Date(rolls[0].effective_at).getTime(),new Date(session.startsAt).getTime(),'effective at the session start');
  const rows=await query<{delegate_id:string;status:string}>(`select delegate_id,status from public.roll_call_row where roll_call_id=$1`,[rolls[0].id]);
  assert.equal(rows.length,delegates.length,'the roll call is whole: every delegate has a row');
  const status=Object.fromEntries(rows.map(r=>[r.delegate_id,r.status]));
  assert.equal(status[delegates[0]],'Present & Voting');assert.equal(status[delegates[1]],'Absent');assert.equal(status[delegates[2]],'Absent','never marked reads as Absent');
  await db.exec(conversion);
  assert.equal((await query(`select 1 from public.roll_call where committee_id=$1 and legacy`,[ids.ga1])).length,1,'re-running changes nothing');
  assert.equal((await query(`select 1 from public.roll_call_row where roll_call_id=$1`,[rolls[0].id])).length,delegates.length);
  assert.equal((await query(`select to_regclass('public.timers') t`))[0].t,null);
 }finally{await db.close();}
});
