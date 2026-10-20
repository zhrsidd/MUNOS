import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {operationsFingerprint} from '../lib/operations/fingerprint';
import {affectedCommittees,committeePhotoReminders,photoChairs} from '../lib/operations/photo-reminders';
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

// An acknowledgement is for one slot revision AND one Chair list (Codex review of PR #36): a changed list reminds again.
test('client: a changed Chair list reminds an acknowledged committee again; stale acknowledgements stay history and silence nothing',()=>{
 let d:ConferenceData=createSeed();
 d.schools.push({id:'school-b',name:'School B'});
 const run=(c:Command,role:'admin'|'chair'='admin')=>{d=applyCommand(d,c,role,meta());};
 const A='school0'; // GA1 and ECOSOC have delegates from it; UNHRC does not
 for(const schoolId of [A,'school-b'])run({type:'photoSlot',action:'create',schoolId,startsAt:'2026-11-05T10:05:00Z',endsAt:null,location:'Hall',note:'',warnMinutes:10});
 const slotA=d.photoSlots!.find(s=>s.schoolId===A)!,slotB=d.photoSlots!.find(s=>s.schoolId==='school-b')!;
 const reminder=(committee:string,slot:PhotoSlot)=>committeePhotoReminders(d,committee,NOW).find(r=>r.slot.id===slot.id);
 const attention=(committee:string,slot:PhotoSlot)=>reminder(committee,slot)?.attention;
 const ack=(committee:string,slot:PhotoSlot,chairs=reminder(committee,slot)!.chairsVersion)=>run({type:'photoAck',committeeId:committee,slotId:slot.id,stage:'warning',revision:slot.revision,chairs},'chair');
 const executiveSees=(committee:string,slot:PhotoSlot)=>affectedCommittees(d,slot).find(a=>a.committee.id===committee)?.warningAcknowledged;
 const alex=()=>d.staff.find(s=>s.id==='chair-demo')!;

 // GA1 acknowledges its delegates-only reminder.
 ack('ga1',slotA);
 assert.equal(attention('ga1',slotA),false);assert.equal(executiveSees('ga1',slotA),true);
 // The Executive gives GA1's Chair that school: the list changed, so GA1 is reminded again.
 run({type:'staffSchool',staffId:'chair-demo',schoolId:A});
 assert.deepEqual(reminder('ga1',slotA)!.chairs.map(c=>c.staffId),['chair-demo']);
 assert.equal(reminder('ga1',slotA)!.chairsVersion,'chair-demo');
 assert.equal(attention('ga1',slotA),true,'an earlier acknowledgement no longer silences the changed list');
 assert.equal(executiveSees('ga1',slotA),false);
 assert.equal(attention('ecosoc',slotA),true,'ECOSOC never acknowledged');
 // A stale acknowledgement of the old list (queued offline, or from a client without Chair lists) does not silence it.
 run({type:'photoAck',committeeId:'ga1',slotId:slotA.id,stage:'warning',revision:slotA.revision},'chair');
 assert.equal(attention('ga1',slotA),true);
 ack('ga1',slotA);
 assert.equal(attention('ga1',slotA),false);assert.equal(executiveSees('ga1',slotA),true);
 // ...even when it is recorded after the acknowledgement of the current list: it is kept, and asks again.
 const history=d.photoAcks!.map(a=>({...a}));
 ack('ga1',slotA,'');
 assert.deepEqual(d.photoAcks!.slice(0,history.length),history,'earlier acknowledgements are preserved');
 assert.deepEqual(d.photoAcks!.filter(a=>a.committeeId==='ga1').map(a=>a.chairs),['','chair-demo','']);
 assert.equal(attention('ga1',slotA),true,'a stale acknowledgement cannot silence the updated list');
 ack('ga1',slotA);ack('ga1',slotA);
 assert.equal(d.photoAcks!.filter(a=>a.committeeId==='ga1').length,4,'repeating the latest acknowledgement adds nothing');
 assert.equal(attention('ga1',slotA),false);

 // Affiliation change A → B: slot A's list changes back to delegates only, but GA1's last acknowledgement was for the
 // list with its Chair, so it is reminded again (the first acknowledgement is not reused). Slot B now reminds GA1.
 run({type:'staffSchool',staffId:'chair-demo',schoolId:'school-b'});
 assert.deepEqual(reminder('ga1',slotA)!.chairs,[]);
 assert.equal(attention('ga1',slotA),true);
 assert.deepEqual(reminder('ga1',slotB)!.chairs.map(c=>c.name),['Alex Morgan']);assert.equal(attention('ga1',slotB),true);
 ack('ga1',slotA);ack('ga1',slotB);
 // Clearing the school: slot B no longer concerns GA1; slot A is unchanged and stays acknowledged.
 run({type:'staffSchool',staffId:'chair-demo',schoolId:null});
 assert.equal(reminder('ga1',slotB),undefined);assert.deepEqual(affectedCommittees(d,slotB),[]);
 assert.equal(attention('ga1',slotA),false);

 // Committee and role assignments (an Executive or owner edit; derived the same way, so no command is needed).
 run({type:'staffSchool',staffId:'chair-demo',schoolId:A});ack('ga1',slotA);
 alex().committeeIds=['ga1','unhrc']; // a second committee
 assert.deepEqual(reminder('unhrc',slotA)!.chairs.map(c=>c.staffId),['chair-demo'],'a multi-committee Chair is listed in both');
 assert.equal(attention('unhrc',slotA),true);
 assert.equal(attention('ga1',slotA),false,"GA1's own list did not change");
 assert.deepEqual(affectedCommittees(d,slotA).map(a=>[a.committee.id,a.chairs]),[['ga1',1],['ecosoc',0],['unhrc',1]]);
 ack('unhrc',slotA);
 alex().committeeIds=['unhrc']; // moved off GA1
 assert.deepEqual(reminder('ga1',slotA)!.chairs,[]);assert.equal(attention('ga1',slotA),true);
 assert.equal(attention('unhrc',slotA),false);
 alex().role='approval'; // no longer a Chair
 assert.equal(reminder('unhrc',slotA),undefined,'a former Chair no longer brings UNHRC into the photo');
 assert.deepEqual(photoChairs(d),[]);
});

test('real PostgreSQL: acknowledgements are versioned by Chair list; changes remind again, stale acknowledgements are kept but silence nothing',async()=>{
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
  // A Chair device's view: the merge the repository makes, then the same derivation as the client.
  const snapshot=async(user:string,core:string)=>{await as(user);const a=(await query<{s:ConferenceData}>(`select public.${core}($1) s`,[ids.conference]))[0].s;const b=(await query<{s:ConferenceData}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s;return {...a,...b} as ConferenceData;};
  const reminder=async(user:string,committee:string,slotId:string)=>committeePhotoReminders(await snapshot(user,'conference_snapshot'),committee,AT).find(r=>r.slot.id===slotId);
  const attention=async(user:string,committee:string,slotId:string)=>(await reminder(user,committee,slotId))?.attention;
  const ack=async(user:string,committee:string,slotId:string,chairs?:string)=>{const r=(await reminder(user,committee,slotId))!;await send(user,{type:'photoAck',committeeId:committee,slotId,stage:'warning',revision:r.slot.revision,chairs:chairs??r.chairsVersion},'chair');};
  const rows=async()=>{await asOwner();return query<{id:string;committee_id:string;chairs:string}>('select id,committee_id,chairs from public.photo_acknowledgements order by created_at,id');};
  const slots:string[]=[];
  for(const schoolId of [A,B]){const id=crypto.randomUUID();await send(executive,{type:'photoSlot',action:'create',schoolId,startsAt:'2026-11-12T10:30:00Z',endsAt:null,location:'Hall',note:''},'admin',null,id);slots.push(id.slice(0,24)+'000000000001');}
  const [slotA,slotB]=slots;

  // GA1 acknowledges its delegates-only reminder; then GA1's Chair gets that school and GA1 is reminded again.
  await ack(ga1Chair,ids.ga1,slotA);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);
  await setSchool(A);
  const r=(await reminder(ga1Chair,ids.ga1,slotA))!;
  assert.deepEqual(r.chairs.map(c=>c.staffId),[ALEX]);assert.equal(r.chairsVersion,ALEX);
  assert.equal(r.attention,true,'an earlier acknowledgement no longer silences the changed list');
  // A stale acknowledgement of the old list (queued offline before the change, no Chair list) silences nothing.
  await send(ga1Chair,{type:'photoAck',committeeId:ids.ga1,slotId:slotA,stage:'warning',revision:1},'chair');
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true);
  await ack(ga1Chair,ids.ga1,slotA);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);
  const history=await rows();
  await ack(ga1Chair,ids.ga1,slotA,'');
  assert.deepEqual((await rows()).slice(0,history.length),history,'earlier acknowledgements are preserved');
  assert.deepEqual((await rows()).map(a=>a.chairs),['',ALEX,'']);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'a stale acknowledgement cannot silence the updated list');
  await ack(ga1Chair,ids.ga1,slotA);await ack(ga1Chair,ids.ga1,slotA);
  assert.equal((await rows()).length,4,'repeating the latest acknowledgement adds nothing');
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);
  await assert.rejects(()=>send(ga1Chair,{type:'photoAck',committeeId:ids.ga1,slotId:slotA,stage:'warning',revision:1,chairs:'not-a-staff-id'},'chair'),/Unknown Chair list/);
  // The Executive overview applies the same rule to the same data.
  const exec=await snapshot(executive,'executive_snapshot');
  const overview=affectedCommittees(exec,exec.photoSlots!.find(s=>s.id===slotA)!);
  assert.deepEqual(overview.map(a=>[a.committee.id,a.chairs,a.warningAcknowledged]).sort(),[[ids.ga1,1,true],[ids.who,0,false]].sort());

  // Affiliation change A → B, then clearing.
  await setSchool(B);
  assert.deepEqual((await reminder(ga1Chair,ids.ga1,slotA))!.chairs,[]);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'the first acknowledgement is not reused');
  assert.equal(await attention(ga1Chair,ids.ga1,slotB),true);
  await ack(ga1Chair,ids.ga1,slotA);await ack(ga1Chair,ids.ga1,slotB);
  await setSchool(null);
  assert.equal(await reminder(ga1Chair,ids.ga1,slotB),undefined);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false);

  // Committee and role assignments edited directly in the database: the list is derived, so these count too.
  await setSchool(A);await ack(ga1Chair,ids.ga1,slotA);
  await asOwner();await query('insert into public.committee_staff(conference_id,committee_id,staff_id) values($1,$2,$3)',[ids.conference,ids.hrc,ALEX]);
  assert.deepEqual((await reminder(hrcChair,ids.hrc,slotA))!.chairs.map(c=>c.staffId),[ALEX],'a multi-committee Chair is listed in both');
  assert.equal(await attention(hrcChair,ids.hrc,slotA),true);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),false,"GA1's own list did not change");
  await ack(hrcChair,ids.hrc,slotA);
  await asOwner();await query('delete from public.committee_staff where committee_id=$1 and staff_id=$2',[ids.ga1,ALEX]);
  assert.deepEqual((await reminder(ga1Chair,ids.ga1,slotA))!.chairs,[]);
  assert.equal(await attention(ga1Chair,ids.ga1,slotA),true,'a Chair moved off GA1 reminds GA1 again');
  assert.equal(await attention(hrcChair,ids.hrc,slotA),false);
  await asOwner();await query("update public.conference_staff set role='approval' where staff_id=$1",[ALEX]);
  assert.equal(await reminder(hrcChair,ids.hrc,slotA),undefined,'a former Chair no longer brings HRC into the photo');
  const all=await rows();
  assert.deepEqual(all.slice(0,history.length),history,'nothing was deleted or rewritten');
  assert.equal(all.length,8);
 }finally{await db.close();}
});
