import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {applyCommand} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {fingerprint} from '../lib/sync/repository';
import type {ConferenceData} from '../lib/domain';

test('Chair contacts: scoped public lookup, staff-only mutation, revisions and retries',async()=>{
 const {db,ids,as,asOwner,asServer,grant,query}=await freshDatabase();
 const executive='73000000-0000-4000-8000-000000000001',chair='73000000-0000-4000-8000-000000000002';
 try {
  await grant(executive,'admin');await grant(chair,'chair',ids.ga1);await asOwner();
  const [staff]=await query<{id:string}>(`select s.id from public.staff s join public.committee_staff a on a.staff_id=s.id join public.conference_staff r on r.staff_id=s.id where a.committee_id=$1 and r.role='chair' limit 1`,[ids.ga1]);
  const token='chair_contact_scope_1234567890';
  await db.query(`insert into public.submission_links(conference_id,committee_id,token,share_with) values($1,$2,$3,'wrong-mailbox@example.com')`,[ids.conference,ids.ga1,token]);
  const command={type:'staffContact' as const,id:staff.id,email:'assigned-chair@example.com'},mutation=crypto.randomUUID();
  const send=(role='admin',expected='1',id=mutation,email=command.email)=>db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify({...command,email}),role,expected,'2026-10-06T00:00:00Z']);
  await as(chair);await assert.rejects(()=>send('chair'),/no access|Administrator/);
  await as(executive);await send();await send();
  const [snapshot]=await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]);
  assert.equal(snapshot.s.staff.find(s=>s.id===staff.id)?.email,command.email);
  assert.equal(fingerprint(snapshot.s,command),'2');
  await assert.rejects(()=>send('admin','1',crypto.randomUUID()),/Another chair/);
  await assert.rejects(()=>send('admin','2',crypto.randomUUID(),'bad email'),/staff_contact_email/);
  await assert.rejects(()=>db.query('select public.submission_link_info($1)',[token]),/permission denied/);
  await asServer();
  const [info]=await query<{s:{chairs:{name:string,email:string}[],shareWith:string}}>('select public.submission_link_info($1) s',[token]);
  assert.equal(info.s.shareWith,'');assert.deepEqual(info.s.chairs.map(c=>c.email),[command.email]);
  assert.equal((await query<{s:unknown}>('select public.submission_link_info($1) s',['invalid']))[0].s,null);
  await asOwner();await db.exec('set role anon');await assert.rejects(()=>db.query('select * from public.staff'),/permission denied/);
 }finally{await db.close();}
});
test('Local contact validation and role boundaries agree with database',()=>{
 const seed=createSeed(),staff=seed.staff[0];
 assert.throws(()=>applyCommand(seed,{type:'staffContact',id:staff.id,email:'a@example.com'},'chair'),/boundary/);
 assert.throws(()=>applyCommand(seed,{type:'staffContact',id:staff.id,email:'bad'},'admin'),/valid contact/);
 const updated=applyCommand(seed,{type:'staffContact',id:staff.id,email:' a@example.com '},'admin');
 assert.equal(updated.staff[0].email,'a@example.com');assert.equal(updated.staff[0].contactRevision,2);
});
