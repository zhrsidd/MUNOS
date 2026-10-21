import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {operationsFingerprint} from '../lib/operations/fingerprint';
import {advancePhotoEpochs,affectedCommittees,committeePhotoReminders,photoChairs,photoEpoch} from '../lib/operations/photo-reminders';
import type {OperationsCommand} from '../lib/operations/commands';
import type {PhotoSlot} from '../lib/operations/types';
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


// Participant-list epochs (Codex reviews of PR #36). An acknowledgement silences a reminder only at the epoch it was
// given at, and a Chair change advances the epoch, so an acknowledgement recorded before the list last changed can never
// silence it again, even when the list returns to an earlier state.
test('client: a Chair-list change reminds an acknowledged committee again; clear/restore, A-B-A, remove/re-add and role changes cannot reuse an old acknowledgement',()=>{
 let d:ConferenceData=createSeed();
 d.schools.push({id:'school-b',name:'School B'});
 const run=(c:Command,role:'admin'|'chair'='admin')=>{d=applyCommand(d,c,role,meta());};
 const A='school0'; // GA1 and ECOSOC have delegates from it; UNHRC does not
 for(const schoolId of [A,'school-b'])run({type:'photoSlot',action:'create',schoolId,startsAt:'2026-11-05T10:05:00Z',endsAt:null,location:'Hall',note:'',warnMinutes:10});
 const slotA=d.photoSlots!.find(s=>s.schoolId===A)!,slotB=d.photoSlots!.find(s=>s.schoolId==='school-b')!;
 const reminder=(committee:string,slot:PhotoSlot)=>committeePhotoReminders(d,committee,NOW).find(r=>r.slot.id===slot.id);
 const attention=(committee:string,slot:PhotoSlot)=>reminder(committee,slot)?.attention;
 /** Acknowledge what this device shows now, or (stale) an explicit epoch and Chair list queued earlier. */
 const ack=(committee:string,slot:PhotoSlot,stale?:{epoch:number;chairs:string})=>{const r=reminder(committee,slot)!;run({type:'photoAck',committeeId:committee,slotId:slot.id,stage:'warning',revision:slot.revision,epoch:stale?stale.epoch:r.epoch,chairs:stale?stale.chairs:r.chairsVersion},'chair');};
 const executiveSees=(committee:string,slot:PhotoSlot)=>affectedCommittees(d,slot).find(a=>a.committee.id===committee)?.warningAcknowledged;
 const alex=()=>d.staff.find(s=>s.id==='chair-demo')!;
 // The demo has no command for committee or role changes. PostgreSQL triggers advance the epoch of each committee whose
 // Chair list changes; the same helper stands in for them here.
 const bump=(committees:string[])=>advancePhotoEpochs(d,committees,[alex().schoolId]);

 // GA1 acknowledges its delegates-only reminder; the Executive then gives its Chair that school.
 ack('ga1',slotA);
 assert.equal(attention('ga1',slotA),false);assert.equal(executiveSees('ga1',slotA),true);
 run({type:'staffSchool',staffId:'chair-demo',schoolId:A});
 assert.equal(reminder('ga1',slotA)!.epoch,1);assert.equal(reminder('ga1',slotA)!.chairsVersion,'chair-demo');
 assert.equal(attention('ga1',slotA),true,'the earlier acknowledgement no longer silences the changed list');
 assert.equal(executiveSees('ga1',slotA),false);
 assert.equal(photoEpoch(d,'ecosoc',A),0,'only the Chair\'s committees change');
 // A stale acknowledgement queued before the change is kept as history and silences nothing; a future epoch is refused.
 ack('ga1',slotA,{epoch:0,chairs:''});
 assert.equal(attention('ga1',slotA),true);
 assert.throws(()=>ack('ga1',slotA,{epoch:2,chairs:'chair-demo'}),/Unknown list version/);
 ack('ga1',slotA);
 assert.equal(attention('ga1',slotA),false);assert.equal(executiveSees('ga1',slotA),true);
 ack('ga1',slotA,{epoch:0,chairs:''}); // a stale acknowledgement arriving later does not undo the current one
 assert.equal(attention('ga1',slotA),false);
 const history=d.photoAcks!.map(a=>({...a}));

 // Codex: ack at L1, clear the school, restore the school -> reminded again (also while cleared).
 run({type:'staffSchool',staffId:'chair-demo',schoolId:null});
 assert.equal(attention('ga1',slotA),true,'the list changed to none');
 ack('ga1',slotA);assert.equal(attention('ga1',slotA),false);
 run({type:'staffSchool',staffId:'chair-demo',schoolId:A});
 assert.equal(reminder('ga1',slotA)!.chairsVersion,'chair-demo',"the list is back to what the first acknowledgement was for");
 assert.equal(attention('ga1',slotA),true,'restoring the school must remind again');
 assert.equal(executiveSees('ga1',slotA),false);
 ack('ga1',slotA);assert.equal(attention('ga1',slotA),false);

 // A -> B -> A: slot B then slot A.
 run({type:'staffSchool',staffId:'chair-demo',schoolId:'school-b'});
 assert.equal(attention('ga1',slotA),true,"GA1's list for A lost its Chair");
 assert.deepEqual(reminder('ga1',slotB)!.chairs.map(c=>c.name),['Alex Morgan']);assert.equal(attention('ga1',slotB),true);
 ack('ga1',slotB);ack('ga1',slotA);
 run({type:'staffSchool',staffId:'chair-demo',schoolId:A});
 assert.equal(reminder('ga1',slotB),undefined,'slot B no longer concerns GA1');
 assert.equal(attention('ga1',slotA),true,'A -> B -> A must remind again');
 ack('ga1',slotA);assert.equal(attention('ga1',slotA),false);
 run({type:'staffSchool',staffId:'chair-demo',schoolId:'school-b'});
 run({type:'staffSchool',staffId:'chair-demo',schoolId:A});
 assert.equal(attention('ga1',slotA),true,'and again');
 ack('ga1',slotA);

 // A Chair of a second committee is listed in both; each committee is reminded only for its own change.
 alex().committeeIds=['ga1','unhrc'];bump(['unhrc']);
 assert.deepEqual(reminder('unhrc',slotA)!.chairs.map(c=>c.staffId),['chair-demo']);assert.equal(attention('unhrc',slotA),true);
 assert.equal(attention('ga1',slotA),false,"GA1's own list did not change");
 assert.deepEqual(affectedCommittees(d,slotA).map(a=>[a.committee.id,a.chairs]),[['ga1',1],['ecosoc',0],['unhrc',1]]);
 ack('unhrc',slotA);assert.equal(attention('unhrc',slotA),false);
 // Removed from GA1 then re-added.
 alex().committeeIds=['unhrc'];bump(['ga1']);
 assert.deepEqual(reminder('ga1',slotA)!.chairs,[]);assert.equal(attention('ga1',slotA),true);
 ack('ga1',slotA);
 alex().committeeIds=['unhrc','ga1'];bump(['ga1']);
 assert.equal(reminder('ga1',slotA)!.chairsVersion,'chair-demo');
 assert.equal(attention('ga1',slotA),true,'removed then re-added must remind again');
 ack('ga1',slotA);assert.equal(attention('unhrc',slotA),false,"UNHRC's list did not change");
 // Role changed away from Chair and back.
 alex().role='approval';bump(['ga1','unhrc']);
 assert.equal(reminder('unhrc',slotA),undefined,'a former Chair no longer brings UNHRC into the photo');
 assert.equal(attention('ga1',slotA),true);ack('ga1',slotA);
 alex().role='chair';bump(['ga1','unhrc']);
 assert.equal(attention('ga1',slotA),true,'role changed away and back must remind again');
 assert.equal(attention('unhrc',slotA),true);

 assert.deepEqual(d.photoAcks!.slice(0,history.length),history,'earlier acknowledgements are preserved');
});

test('real PostgreSQL: triggers advance the participant-list epoch; no acknowledgement recorded before the list last changed can silence it',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const executive='74000000-0000-4000-8000-000000000001',ga1Chair='74000000-0000-4000-8000-000000000002',hrcChair='74000000-0000-4000-8000-000000000003';
 const ALEX='c63bb044-9b54-44fd-a002-7ea23e5477d5',A='ee287c3a-73ea-447c-a0c3-e26e843644c0',B='74000000-0000-4000-8000-0000000000bb';
 const AT=Date.parse('2026-11-12T10:25:00Z');
 try{
  await grant(executive,'admin');await grant(ga1Chair,'chair',ids.ga1);await grant(hrcChair,'chair',ids.hrc);
  await asOwner();await query('insert into public.schools(id,conference_id,name) values($1,$2,$3)',[B,ids.conference,'School B']);
  const send=async(user:string,command:OperationsCommand,role='admin',expected:string|null=null,id:string=crypto.randomUUID())=>{await as(user);return db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify(command),role,expected,'2026-11-01T00:00:00Z']);};
  let school:string|null=null;
  const setSchool=async(next:string|null)=>{await send(executive,{type:'staffSchool',staffId:ALEX,schoolId:next},'admin',school??'none');school=next;};
  // A device's view: the merge the repository makes, then the same derivation as the client.
  const snapshot=async(user:string,core:string)=>{await as(user);const a=(await query<{s:ConferenceData}>(`select public.${core}($1) s`,[ids.conference]))[0].s;const b=(await query<{s:ConferenceData}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s;return {...a,...b} as ConferenceData;};
  const reminder=async(user:string,committee:string,slotId:string)=>committeePhotoReminders(await snapshot(user,'conference_snapshot'),committee,AT).find(r=>r.slot.id===slotId);
  const attention=async(user:string,committee:string,slotId:string)=>(await reminder(user,committee,slotId))?.attention;
  /** Acknowledge what the device shows now, or (stale) the epoch and Chair list it queued earlier. */
  const ack=async(user:string,committee:string,slotId:string,stale?:{epoch:number;chairsVersion:string})=>{const r=stale??(await reminder(user,committee,slotId))!;await send(user,{type:'photoAck',committeeId:committee,slotId,stage:'warning',revision:1,epoch:r.epoch,chairs:r.chairsVersion},'chair');};
  const rows=async()=>{await asOwner();return query<{id:string;committee_id:string;epoch:string;chairs:string}>('select id,committee_id,epoch,chairs from public.photo_acknowledgements order by created_at,id');};
  const epoch=async(committee:string,sch:string)=>{await asOwner();return Number((await query<{e:string}>('select coalesce(max(epoch),0) e from public.photo_list_epochs where committee_id=$1 and school_id=$2',[committee,sch]))[0].e);};
  const slots:string[]=[];
  for(const schoolId of [A,B]){const id=crypto.randomUUID();await send(executive,{type:'photoSlot',action:'create',schoolId,startsAt:'2026-11-12T10:30:00Z',endsAt:null,location:'Hall',note:''},'admin',null,id);slots.push(id.slice(0,24)+'000000000001');}
  const [slotA,slotB]=slots;

  // GA1 acknowledges its delegates-only reminder; the Executive then gives its Chair that school.
  await ack(ga1Chair,ids.ga1,slotA);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);
  const queued=(await reminder(ga1Chair,ids.ga1,slotA))!; // a device that goes offline here
  assert.equal(queued.epoch,0);
  await setSchool(A);
  assert.equal(await epoch(ids.ga1,A),1);assert.equal(await epoch(ids.who,A),0,'only the Chair\'s committees change');
  const r=(await reminder(ga1Chair,ids.ga1,slotA))!;
  assert.deepEqual(r.chairs.map(c=>c.staffId),[ALEX]);assert.equal(r.epoch,1);assert.equal(r.chairsVersion,ALEX);
  assert.equal(r.attention,true,'an earlier acknowledgement no longer silences the changed list');
  // The offline device now replays its acknowledgement of epoch 0: recorded as history, it silences nothing.
  await ack(ga1Chair,ids.ga1,slotA,queued);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true);
  await assert.rejects(()=>ack(ga1Chair,ids.ga1,slotA,{epoch:5,chairsVersion:ALEX}),/Unknown list version/);
  await assert.rejects(()=>ack(ga1Chair,ids.ga1,slotA,{epoch:1,chairsVersion:'not-a-staff-id'}),/Unknown Chair list/);
  await ack(ga1Chair,ids.ga1,slotA);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);
  await ack(ga1Chair,ids.ga1,slotA,queued);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false,'a stale acknowledgement arriving later does not undo the current one');
  const exec=await snapshot(executive,'executive_snapshot');
  const overview=affectedCommittees(exec,exec.photoSlots!.find(s=>s.id===slotA)!);
  assert.deepEqual(overview.map(a=>[a.committee.id,a.chairs,a.warningAcknowledged]).sort(),[[ids.ga1,1,true],[ids.who,0,false]].sort());
  const history=await rows();

  // Codex: ack at L1, clear the school, restore the school -> reminded again.
  await setSchool(null);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'the list changed to none');
  await ack(ga1Chair,ids.ga1,slotA);assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);
  await setSchool(A);
  assert.equal((await reminder(ga1Chair,ids.ga1,slotA))!.chairsVersion,ALEX,'the list is back to what the first acknowledgement was for');
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'restoring the school must remind again');
  await ack(ga1Chair,ids.ga1,slotA);assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);

  // A -> B -> A.
  await setSchool(B);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true);
  assert.equal(await attention(ga1Chair,ids.ga1,slotB),true);
  await ack(ga1Chair,ids.ga1,slotB);await ack(ga1Chair,ids.ga1,slotA);
  await setSchool(A);
  assert.equal(await reminder(ga1Chair,ids.ga1,slotB),undefined);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'A -> B -> A must remind again');
  await ack(ga1Chair,ids.ga1,slotA);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);

  // Committee and role assignments edited directly in the database: the triggers advance the epoch.
  await asOwner();await query('insert into public.committee_staff(conference_id,committee_id,staff_id) values($1,$2,$3)',[ids.conference,ids.hrc,ALEX]);
  assert.deepEqual((await reminder(hrcChair,ids.hrc,slotA))!.chairs.map(c=>c.staffId),[ALEX],'a multi-committee Chair is listed in both');
  assert.equal(await attention(hrcChair,ids.hrc,slotA),true);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false,"GA1's own list did not change");
  await ack(hrcChair,ids.hrc,slotA);assert.equal(await attention(hrcChair,ids.hrc,slotA),false);
  await asOwner();await query('delete from public.committee_staff where committee_id=$1 and staff_id=$2',[ids.ga1,ALEX]);
  assert.deepEqual((await reminder(ga1Chair,ids.ga1,slotA))!.chairs,[]);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'a Chair moved off GA1 reminds GA1 again');
  await ack(ga1Chair,ids.ga1,slotA);
  await asOwner();await query('insert into public.committee_staff(conference_id,committee_id,staff_id) values($1,$2,$3)',[ids.conference,ids.ga1,ALEX]);
  assert.equal((await reminder(ga1Chair,ids.ga1,slotA))!.chairsVersion,ALEX);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'removed then re-added must remind again');
  await ack(ga1Chair,ids.ga1,slotA);
  assert.equal(await attention(hrcChair,ids.hrc,slotA),false,"HRC's list did not change");
  await asOwner();await query("update public.conference_staff set role='approval' where staff_id=$1",[ALEX]);
  assert.equal(await reminder(hrcChair,ids.hrc,slotA),undefined,'a former Chair no longer brings HRC into the photo');
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true);await ack(ga1Chair,ids.ga1,slotA);
  await asOwner();await query("update public.conference_staff set role='chair' where staff_id=$1",[ALEX]);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'role changed away and back must remind again');
  assert.equal(await attention(hrcChair,ids.hrc,slotA),true);
  // A no-op edit does not advance the epoch.
  const before=await epoch(ids.ga1,A);
  await asOwner();await query("update public.conference_staff set role='chair' where staff_id=$1",[ALEX]);
  await asOwner();await query('update public.staff set "schoolId"=$1 where id=$2',[A,ALEX]);
  assert.equal(await epoch(ids.ga1,A),before);

  // Chairs read epochs only for their own committees; nothing was deleted or rewritten.
  await as(hrcChair);assert.deepEqual(((await query<{s:{photoEpochs:{committeeId:string}[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s.photoEpochs).every(e=>e.committeeId===ids.hrc),true);
  await as(ga1Chair);await assert.rejects(()=>db.query('insert into public.photo_list_epochs(conference_id,committee_id,school_id,epoch) values($1,$2,$3,9)',[ids.conference,ids.ga1,B]),/permission denied/);
  const all=await rows();
  assert.deepEqual(all.slice(0,history.length),history,'earlier acknowledgements are preserved');
  assert.ok(all.length>history.length);
 }finally{await db.close();}
});
