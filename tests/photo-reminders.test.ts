import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {committeePhotoReminders,affectedCommittees} from '../lib/operations/photo-reminders';
import {matchSchool,parsePhotoSchedule,reviewPhotoSchedule,normalizeSchool} from '../lib/operations/photo-import';
const at=(iso:string)=>Date.parse(iso);
const meta=()=>({id:crypto.randomUUID(),createdAt:'2026-10-05T06:00:00.000Z',actorId:'x'});
// Doha College (school0): GA1 has 4 delegates (d0,d3,d6,d9), ECOSOC has 1 (d13), SC has none.
function withSlot(fields:Partial<{startsAt:string;endsAt:string|null;enabled:boolean;warnMinutes:number}>={}){
 return applyCommand(createSeed(),{type:'photoSlot',action:'create',schoolId:'school0',startsAt:'2026-10-05T10:30:00.000Z',endsAt:null,location:'Main Courtyard',note:'',...fields},'admin',meta());
}
test('only committees with delegates from the school are reminded, with the right delegates',()=>{
 const d=withSlot();const slot=d.photoSlots![0];
 const ga1=committeePhotoReminders(d,'ga1',at('2026-10-05T10:00:00Z'));
 assert.equal(ga1.length,1);assert.equal(ga1[0].delegates.length,4,'multiple delegates from the same school');
 assert.deepEqual(ga1[0].delegates.map(x=>x.country),['France','India','Kenya','Norway'],'sorted by country');
 assert.equal(committeePhotoReminders(d,'ecosoc',at('2026-10-05T10:00:00Z'))[0].delegates.length,1);
 assert.equal(committeePhotoReminders(d,'sc',at('2026-10-05T10:00:00Z')).length,0,'no delegates, no reminder');
 assert.deepEqual(affectedCommittees(d,slot).map(a=>[a.committee.code,a.delegates]),[['GA1',4],['ECOSOC',1]]);
});
test('stages derive from timestamps: upcoming, 10-minute warning, due, past; late opening still warns',()=>{
 const d=withSlot();
 const stage=(t:string)=>committeePhotoReminders(d,'ga1',at(t))[0];
 assert.equal(stage('2026-10-05T10:19:59Z').stage,'upcoming');assert.equal(stage('2026-10-05T10:19:59Z').attention,false);
 const warn=stage('2026-10-05T10:20:00Z');assert.equal(warn.stage,'warning');assert.equal(warn.minutesUntil,10);assert.ok(warn.attention);
 const late=stage('2026-10-05T10:25:30Z');assert.equal(late.stage,'warning','opened five minutes before: still warned');assert.equal(late.minutesUntil,5);
 assert.equal(stage('2026-10-05T10:30:00Z').stage,'due');
 assert.equal(stage('2026-10-05T10:44:59Z').stage,'due','default 15-minute due window');
 assert.equal(stage('2026-10-05T10:45:00Z').stage,'past');
 const withEnd=withSlot({endsAt:'2026-10-05T10:40:00.000Z',warnMinutes:5});
 assert.equal(committeePhotoReminders(withEnd,'ga1',at('2026-10-05T10:24:00Z'))[0].stage,'upcoming','configurable warning');
 assert.equal(committeePhotoReminders(withEnd,'ga1',at('2026-10-05T10:40:00Z'))[0].stage,'past','end time closes the due window');
});
test('acknowledgement silences one stage only; a reschedule makes the reminder reappear',()=>{
 let d=withSlot();const slot=d.photoSlots![0];const t=at('2026-10-05T10:22:00Z');
 assert.throws(()=>applyCommand(d,{type:'photoAck',committeeId:'ga1',slotId:slot.id,stage:'warning',revision:1},'admin'),/role boundary/);
 d=applyCommand(d,{type:'photoAck',committeeId:'ga1',slotId:slot.id,stage:'warning',revision:1},'chair',meta());
 assert.equal(committeePhotoReminders(d,'ga1',t)[0].attention,false);
 assert.equal(committeePhotoReminders(d,'ecosoc',t)[0].attention,true,'other committee unaffected');
 assert.equal(committeePhotoReminders(d,'ga1',at('2026-10-05T10:31:00Z'))[0].attention,true,'due-now still shows after the warning was acknowledged');
 d=applyCommand(d,{type:'photoSlot',action:'update',slotId:slot.id,schoolId:'school0',startsAt:'2026-10-05T10:25:00.000Z',endsAt:null,location:'Sports Hall',note:'Moved indoors'},'admin',meta());
 const moved=committeePhotoReminders(d,'ga1',t)[0];
 assert.equal(moved.slot.revision,2);assert.equal(moved.attention,true,'reschedule resets acknowledgement');assert.equal(moved.slot.location,'Sports Hall');
});
test('cancelled slots stop reminding and are announced once during their window',()=>{
 let d=withSlot();const slot=d.photoSlots![0];
 d=applyCommand(d,{type:'photoSlot',action:'update',slotId:slot.id,schoolId:'school0',startsAt:slot.startsAt,endsAt:null,location:slot.location,note:'',enabled:false},'admin',meta());
 const r=committeePhotoReminders(d,'ga1',at('2026-10-05T10:25:00Z'))[0];assert.equal(r.stage,'cancelled');assert.equal(r.attention,true);
 assert.equal(committeePhotoReminders(d,'ga1',at('2026-10-05T09:00:00Z'))[0].attention,false,'no early cancellation noise');
 d=applyCommand(d,{type:'photoAck',committeeId:'ga1',slotId:slot.id,stage:'warning',revision:2},'chair',meta());
 assert.equal(committeePhotoReminders(d,'ga1',at('2026-10-05T10:25:00Z'))[0].attention,false);
});
test('reminders survive refresh/offline: derived from the cached snapshot alone',()=>{
 const d=withSlot();const restored=JSON.parse(JSON.stringify(d));
 assert.deepEqual(committeePhotoReminders(restored,'ga1',at('2026-10-05T10:31:00Z')).map(r=>[r.stage,r.attention]),[['due',true]]);
});
test('school matching: exact after normalizing, typo suggested (never auto-picked), unknown unresolved',()=>{
 const schools=createSeed().schools;
 assert.equal(normalizeSchool('  Doha   College '),'doha college');
 const exact=matchSchool('Doha College ',schools);assert.equal(exact.kind,'exact');
 assert.equal(matchSchool('DOHA COLLEGE',schools).kind,'exact');
 const typo=matchSchool('Doha Collge',schools);assert.equal(typo.kind,'suggested');assert.equal(typo.kind==='suggested'&&typo.suggestions[0].name,'Doha College');
 assert.equal(matchSchool('Qatar Academy',schools).kind,'unresolved');
 assert.equal(matchSchool('Park House English School',schools).kind,'exact');
});
test('photo CSV preview: unresolved schools block, duplicates skipped, nothing created silently',()=>{
 const d=withSlot();
 const rows=parsePhotoSchedule(`school,date,start_time,end_time,location
Doha College ,05/10/2026,13:30,,Main Courtyard
Doha Collge,05/10/2026,14:00,14:15,Main Courtyard
Qatar Academy,06/10/2026,09:00,,Field
Park House English School,Day 2,10:00,09:00,Hall
Doha British School,Day 2,11:00,,`,d);
 const review=reviewPhotoSchedule(rows,d);
 assert.equal(review.rows[0].duplicate,true,'existing slot for the same school/time');
 assert.match(review.rows[1].errors.join(),/Confirm the school/);assert.equal(review.rows[1].schoolId,'');
 assert.match(review.rows[2].errors.join(),/School not found/);
 assert.match(review.rows[3].errors.join(),/End time is before/);
 assert.match(review.rows[4].errors.join(),/Location is missing/);
 assert.equal(review.summary.create,0);
 const confirmed=reviewPhotoSchedule(rows.map((r,i)=>i===1?{...r,schoolId:'school0'}:r),d);
 assert.equal(confirmed.summary.create,1);assert.equal(confirmed.slots[0].startsAt,'2026-10-05T11:00:00.000Z');
 const before=d.photoSlots!.length;const after=applyCommand(d,{type:'photoImport',rows:confirmed.slots},'admin',meta());
 assert.equal(after.photoSlots!.length,before+1);assert.equal(after.schools.length,d.schools.length,'no schools created');
});
