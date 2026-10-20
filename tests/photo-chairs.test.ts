import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {operationsFingerprint} from '../lib/operations/fingerprint';
import {affectedCommittees,committeePhotoReminders,photoChairs} from '../lib/operations/photo-reminders';
import type {OperationsCommand} from '../lib/operations/commands';
import {freshDatabase} from './helpers/database';

// Delegates and Chairs in school group photos (20261021100000_photo_chairs).
const NOW=Date.parse('2026-11-05T10:00:00Z');
const meta=()=>({id:crypto.randomUUID(),createdAt:'2026-11-05T09:00:00.000Z',actorId:'exec-1'});

test('client: a Chair with a school is reminded with their committee; a Chair-only committee gets the slot too',()=>{
 let d:ConferenceData=createSeed();
 d.schools.push({id:'school-chairs',name:'Chair School'});
 const run=(c:Command,role:'admin'|'chair'='admin')=>{d=applyCommand(d,c,role,meta());};
 assert.throws(()=>run({type:'staffSchool',staffId:'chair-demo',schoolId:'school-chairs'},'chair'),/role boundary/);
 assert.throws(()=>run({type:'staffSchool',staffId:'approval-demo',schoolId:'school-chairs'}),/Choose a Chair/);
 assert.throws(()=>run({type:'staffSchool',staffId:'chair-demo',schoolId:'missing'}),/valid school/);
 assert.equal(operationsFingerprint(d,{type:'staffSchool',staffId:'chair-demo',schoolId:'school-chairs'}),'none');
 run({type:'staffSchool',staffId:'chair-demo',schoolId:'school-chairs'});
 assert.equal(operationsFingerprint(d,{type:'staffSchool',staffId:'chair-demo',schoolId:null}),'school-chairs');
 assert.deepEqual(photoChairs(d),[{staffId:'chair-demo',name:'Alex Morgan',committeeId:'ga1',schoolId:'school-chairs'}]);

 // A slot for a school with no GA1 delegates still reminds GA1, because its Chair belongs to that school.
 run({type:'photoSlot',action:'create',schoolId:'school-chairs',startsAt:'2026-11-05T10:05:00Z',endsAt:null,location:'Main Courtyard',note:'',warnMinutes:10});
 const [reminder,...rest]=committeePhotoReminders(d,'ga1',NOW);
 assert.equal(rest.length,0);
 assert.deepEqual(reminder.delegates,[]);
 assert.deepEqual(reminder.chairs.map(c=>c.name),['Alex Morgan']);
 assert.equal(reminder.stage,'warning');assert.ok(reminder.attention);
 assert.deepEqual(committeePhotoReminders(d,'ecosoc',NOW),[],'other committees are not reminded');

 // The Executive sees the Chair, and that no GA1 Chair is left in the room.
 let slot=d.photoSlots![0];
 assert.deepEqual(affectedCommittees(d,slot).map(a=>[a.committee.id,a.delegates,a.chairs,a.noChairLeft]),[['ga1',0,1,true]]);
 d.staff.push({id:'chair-2',name:'Bea Cole',role:'chair',committeeIds:['ga1']});
 assert.deepEqual(affectedCommittees(d,slot).map(a=>[a.committee.id,a.noChairLeft]),[['ga1',false]],'a second Chair without that school stays');

 // A Chair from a school that also has delegates is listed with them.
 const delegateSchool=d.delegates.find(x=>x.committeeId==='ga1')!.schoolId;
 run({type:'staffSchool',staffId:'chair-2',schoolId:delegateSchool});
 run({type:'photoSlot',action:'create',schoolId:delegateSchool,startsAt:'2026-11-05T10:05:00Z',endsAt:null,location:'Hall',note:'',warnMinutes:10});
 const mixed=committeePhotoReminders(d,'ga1',NOW).find(r=>r.slot.schoolId===delegateSchool)!;
 assert.ok(mixed.delegates.length>0);assert.deepEqual(mixed.chairs.map(c=>c.name),['Bea Cole']);

 // Clearing the school removes the Chair-only reminder.
 run({type:'staffSchool',staffId:'chair-demo',schoolId:null});
 assert.ok(!committeePhotoReminders(d,'ga1',NOW).some(r=>r.slot.schoolId==='school-chairs'));
 slot=d.photoSlots!.find(s=>s.schoolId==='school-chairs')!;
 assert.deepEqual(affectedCommittees(d,slot),[]);

 // A server snapshot's projection is authoritative: a Chair device never derives Chairs from staff it cannot read.
 const server={...d,photoChairs:[]};
 assert.deepEqual(photoChairs(server),[]);
 assert.deepEqual(committeePhotoReminders(server,'ga1',NOW).find(r=>r.slot.schoolId===delegateSchool)!.chairs,[]);
});

test('real PostgreSQL: Executive sets a Chair school; Chairs see only the photoChairs projection for their committees',async()=>{
 const {db,ids,query,as,asOwner,grant,operationsExpected}=await freshDatabase();
 const executive='73000000-0000-4000-8000-000000000001',ga1Chair='73000000-0000-4000-8000-000000000002',whoChair='73000000-0000-4000-8000-000000000003',approval='73000000-0000-4000-8000-000000000004';
 const ALEX='c63bb044-9b54-44fd-a002-7ea23e5477d5',SAM='8e767705-00c4-440b-a8f1-886d129df6d3',school='73000000-0000-4000-8000-0000000000aa';
 try{
  await grant(executive,'admin');await grant(ga1Chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);await grant(approval,'approval');
  await asOwner();await query('insert into public.schools(id,conference_id,name) values($1,$2,$3)',[school,ids.conference,'Chair School']);
  // staffSchool's precondition is the Chair's current school ('none' if unset); the operations-only helper cannot see staff.
  const send=async(user:string,command:OperationsCommand,role='admin',expected?:string|null)=>{const value=expected!==undefined?expected:command.type==='staffSchool'?'none':await operationsExpected(command);await as(user);return db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(command),role,value,'2026-11-01T00:00:00Z']);};
  const chairs=async(user:string)=>{await as(user);return (await query<{s:{photoChairs:unknown[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s.photoChairs;};

  await assert.rejects(()=>send(ga1Chair,{type:'staffSchool',staffId:ALEX,schoolId:school},'chair'),/Executive access/);
  await assert.rejects(()=>send(executive,{type:'staffSchool',staffId:SAM,schoolId:school}),/Choose a Chair/,'only Chairs have a photo school');
  await assert.rejects(()=>send(executive,{type:'staffSchool',staffId:ALEX,schoolId:'73000000-0000-4000-8000-0000000000bb'}),/School unavailable/);
  await assert.rejects(()=>send(executive,{type:'staffSchool',staffId:ALEX,schoolId:school},'admin','stale-value'),/changed on another device/);
  await asOwner();const before=Number((await query<{n:number}>("select count(*)::int n from public.operational_changes where committee_id=$1 and topic='configuration'",[ids.ga1]))[0].n);
  await send(executive,{type:'staffSchool',staffId:ALEX,schoolId:school});

  // Executive snapshot carries the school; the Chair's committee is told to refresh.
  await as(executive);
  const staff=(await query<{s:{staff:{id:string;schoolId:string|null}[]}}>('select public.executive_snapshot($1) s',[ids.conference]))[0].s.staff;
  assert.equal(staff.find(s=>s.id===ALEX)?.schoolId,school);
  await asOwner();
  assert.equal(Number((await query<{n:number}>("select count(*)::int n from public.operational_changes where committee_id=$1 and topic='configuration'",[ids.ga1]))[0].n),before+1);
  assert.deepEqual((await query<{a:string[]}>('select private.committees_for_schools(array[$1]::uuid[]) a',[school]))[0].a,[ids.ga1],'photo notifications reach the Chair committee');

  // Chairs read the narrow projection only for their own committees; staff stays Executive-only.
  assert.deepEqual(await chairs(ga1Chair),[{staffId:ALEX,name:'Alex Morgan',committeeId:ids.ga1,schoolId:school}]);
  assert.deepEqual(await chairs(whoChair),[]);
  assert.deepEqual(await chairs(approval),[]);
  await as(ga1Chair);assert.equal((await query('select * from public.staff')).length,0,'Chairs still cannot read staff');
  await assert.rejects(()=>query('select private.ops_staff_school($1,$2)',[ids.conference,JSON.stringify({staffId:ALEX,schoolId:null})]),/permission denied/);

  // A slot for that school notifies GA1 even though no GA1 delegate is from it.
  await send(executive,{type:'photoSlot',action:'create',schoolId:school,startsAt:'2026-11-12T10:30:00Z',endsAt:null,location:'Main Courtyard',note:''});
  // Clearing the school removes the Chair from the projection.
  await send(executive,{type:'staffSchool',staffId:ALEX,schoolId:null},'admin',school); // expected: the current school
  assert.deepEqual(await chairs(ga1Chair),[]);
  await asOwner();
  await assert.rejects(()=>query('update public.staff set "schoolId"=$1 where id=$2',['73000000-0000-4000-8000-0000000000cc',ALEX]),/foreign key/,'the school must belong to the conference');
 }finally{await db.close();}
});
