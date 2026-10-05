import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSchedule,parseTime,parseDate,reviewSchedule,matchCommittees,parseTable} from '../lib/operations/schedule-import';
import {applyCommand} from '../lib/commands';
import {createSeed} from '../lib/seed';
const start='2026-11-12'; // Thursday
const data=()=>{const d=createSeed();d.conference.date=start;return d;};
test('times and dates in the formats organizers actually paste',()=>{
 for(const [i,o] of [['13:30','13:30'],['9:00','09:00'],['9.00','09:00'],['0900','09:00'],['9am','09:00'],['1:30 pm','13:30'],['12 pm','12:00'],['12am','00:00'],['9','null'],['25:00','null']])assert.equal(String(parseTime(i)),o,i);
 for(const [i,o] of [['2026-11-13','2026-11-13'],['13/11/2026','2026-11-13'],['13.11.26','2026-11-13'],['Day 2','2026-11-13'],['Friday','2026-11-13'],['Fri 13 Nov','2026-11-13'],['13th November 2026','2026-11-13'],['November 13, 2026','2026-11-13'],['31/02/2026','null'],['someday','null']])assert.equal(String(parseDate(i,start)),o,i);
 assert.equal(parseDate('11/13/2026',start,'MDY'),'2026-11-13');
 assert.deepEqual(parseTable('a\tb, c\td'),[['a','b, c','d']],'spreadsheet paste keeps commas inside cells');
 assert.deepEqual(parseTable('a;b;"c;d"'),[['a','b','c;d']]);
});
test('valid CSV: carries dates forward, splits ranges, excludes lunch/ceremonies by default, applies committees',()=>{
 const text=`Date,Session,Start,End,Committees
Day 1,Opening Ceremony,08:30,09:30,All
,Committee Session 1,09:45,11:15,All
,Lunch,12:00 - 13:00,,
,"Committee Session 2",13:00,14:30,"GA1, SC"
13/11/2026,Committee Session 3,9:00am,10:30am,ECOSOC`;
 const rows=parseSchedule(text,start);
 assert.equal(rows.length,5);
 assert.deepEqual(rows.map(r=>[r.date,r.start,r.end,r.include]),[['2026-11-12','08:30','09:30',false],['2026-11-12','09:45','11:15',true],['2026-11-12','12:00','13:00',false],['2026-11-12','13:00','14:30',true],['2026-11-13','09:00','10:30',true]]);
 const d=data();const review=reviewSchedule(rows,d,[]);
 assert.equal(review.summary.create,d.committees.length+2+1);
 assert.equal(review.sessions.find(s=>s.name==='Committee Session 1')!.startsAt,'2026-11-12T06:45:00.000Z','Asia/Qatar conversion');
 assert.equal(review.summary.skipped,2);
});
test('unknown committees, malformed rows and duplicates are flagged, never silently created',()=>{
 const d=data();
 const existing=d.sessions.find(s=>s.committeeId==='ga1')!;
 const text=`Day,Session,Time,Committee
Thursday,Session A,09:00-10:00,GA1
Thursday,Session A,09:00-10:00,GA1
Thursday,Session B,10:00-09:00,GA1
Thursday,Session C,later,GA1
Thursday,Session D,11:00,Narnia Council
Someday,Session E,11:00,GA1`;
 const review=reviewSchedule(parseSchedule(text,start),d,[]);
 const [a,b,c,dd,e,f]=review.rows;
 assert.equal(a.creates,1);assert.equal(b.creates,0);assert.deepEqual(b.duplicateCommitteeIds,['ga1'],'duplicate inside the import');
 assert.match(c.errors.join(),/End time is before/);assert.match(dd.errors.join(),/Start time not understood/);
 assert.match(e.errors.join(),/Unknown committee: Narnia Council/);assert.match(f.errors.join(),/Date not understood/);
 assert.equal(review.summary.create,1);
 // A session already in the database for that committee and start is a duplicate.
 const again=reviewSchedule(parseSchedule(`Date,Session,Start,Committees\n${existing.startsAt.slice(0,10)},Anything,${new Date(existing.startsAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Qatar',hour:'2-digit',minute:'2-digit'})},GA1`,start),d,[]);
 assert.deepEqual(again.rows[0].duplicateCommitteeIds,['ga1']);assert.equal(again.summary.create,0);
});
test('rows without a committee use the selected default; explicit selection of a ceremony imports it',()=>{
 const d=data();const rows=parseSchedule('Date,Session,Start\nDay 1,Opening Ceremony,08:30\nDay 1,Session 1,10:00',start);
 assert.equal(reviewSchedule(rows,d,[]).rows[1].errors[0],'Choose at least one committee');
 const review=reviewSchedule(rows.map(r=>({...r,include:true})),d,['ga1','sc']);
 assert.equal(review.summary.create,4);
 assert.deepEqual(matchCommittees('ga1 & Security Council',d).ids,['ga1','sc']);
 assert.equal(matchCommittees('all committees',d).ids.length,d.committees.length);
});
test('import command creates sessions locally with database-matching ids and skips existing starts',()=>{
 let d=data();const id=crypto.randomUUID();
 const rows=[{committeeId:'ga1',name:'Session 1',startsAt:'2026-11-12T06:45:00.000Z',endsAt:'2026-11-12T08:15:00.000Z'},{committeeId:'sc',name:'Session 1',startsAt:'2026-11-12T06:45:00.000Z',endsAt:null}];
 d=applyCommand(d,{type:'sessionImport',rows},'admin',{id,createdAt:'2026-11-01T00:00:00Z'});
 const created=d.sessions.filter(s=>s.name==='Session 1');
 assert.deepEqual(created.map(s=>s.id),[id.slice(0,24)+'000000000001',id.slice(0,24)+'000000000002']);
 assert.equal(created[0].endsAt,'2026-11-12T08:15:00.000Z');
 const before=d.sessions.length;d=applyCommand(d,{type:'sessionImport',rows},'admin',{id:crypto.randomUUID(),createdAt:'2026-11-01T00:00:00Z'});
 assert.equal(d.sessions.length,before,'re-import is a no-op');
 assert.throws(()=>applyCommand(d,{type:'sessionImport',rows},'chair'),/role boundary/);
});
