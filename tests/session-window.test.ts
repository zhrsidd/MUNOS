import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {computeWindows,overrideExpiry,resolveSession,validateSchedule,windowAt} from '../lib/sessions/window';
import type {ScheduleSnapshot,ScheduledSession,SessionOverride,SessionWindow} from '../lib/sessions/window';

// docs/SESSION_MODEL.md sections 3 and 10. The same vectors run against PostgreSQL in session-window-db.test.ts.
type Expect={sessionId?:string|null;flag?:string|null;source?:string;windowStart?:string;windowEnd?:string;nextSwitchAt?:string|null};
const vectors=JSON.parse(readFileSync('tests/fixtures/session-window-vectors.json','utf8')) as {
 timeZone:string;
 schedules:Record<string,{leadMinutes:number;graceMinutes:number;sessions:ScheduledSession[];dayClose?:Record<string,string>;windows:SessionWindow[]}>;
 windowCases:{name:string;schedule:string;at:string;expect:Expect}[];
 validation:{name:string;sessions:ScheduledSession[];leadMinutes:number;graceMinutes:number;errors:string[]}[];
 resolveCases:{name:string;versions:ScheduleSnapshot[];overrides:SessionOverride[];committeeId:string;at:string;dayClose?:Record<string,string>;expect:Expect}[];
 overrideExpiryCases:{name:string;versions:ScheduleSnapshot[];setAt:string;expect:string|null}[];
};
const instant=(v:string|null|undefined)=>v==null?v:new Date(v).toISOString();
const same=(actual:Record<string,unknown>,expect:Expect,label:string)=>{
 for(const [key,want] of Object.entries(expect)){
  const got=actual[key];
  const isTime=key==='windowStart'||key==='windowEnd'||key==='nextSwitchAt';
  assert.equal(isTime?instant(got as string|null):got,isTime?instant(want as string|null):want,`${label}: ${key}`);
 }
};

for(const [name,s] of Object.entries(vectors.schedules))
 test(`window rule: schedule ${name} produces exactly the documented windows`,()=>{
  const windows=computeWindows(s.sessions,{leadMinutes:s.leadMinutes,graceMinutes:s.graceMinutes,dayClose:s.dayClose,timeZone:vectors.timeZone});
  assert.deepEqual(windows.map(w=>({...w,start:instant(w.start),end:instant(w.end)})),s.windows.map(w=>({...w,start:instant(w.start),end:instant(w.end)})));
 });

test('window rule: every point-in-time vector (section 3 conformance table and boundaries)',()=>{
 for(const c of vectors.windowCases){
  const s=vectors.schedules[c.schedule];
  const windows=computeWindows(s.sessions,{leadMinutes:s.leadMinutes,graceMinutes:s.graceMinutes,dayClose:s.dayClose,timeZone:vectors.timeZone});
  const hit=windowAt(windows,c.at);
  same({sessionId:hit?.sessionId??null,flag:hit?null:'outside_schedule',windowStart:hit?.start,windowEnd:hit?.end},c.expect,c.name);
 }
});

test('window rule: input order does not matter and the input is not mutated',()=>{
 const s=vectors.schedules.sat17;
 const shuffled=[...s.sessions].reverse();
 const before=JSON.stringify(shuffled);
 const windows=computeWindows(shuffled,{leadMinutes:5,graceMinutes:20,timeZone:vectors.timeZone});
 assert.equal(JSON.stringify(shuffled),before);
 assert.deepEqual(windows.map(w=>w.sessionId),['S5','S6','S7']);
});

test('window rule: lead, grace and per-slot lead are parameters, not constants',()=>{
 const s=vectors.schedules.sat17.sessions;
 const at=(lead:number,grace:number)=>computeWindows(s,{leadMinutes:lead,graceMinutes:grace,timeZone:vectors.timeZone});
 assert.equal(instant(at(0,0)[0].start),instant('2026-10-17T08:30:00+03:00'));
 assert.equal(instant(at(0,0)[2].end),instant('2026-10-17T16:45:00+03:00'));
 assert.equal(instant(at(5,45)[2].end),instant('2026-10-17T17:30:00+03:00'));
 assert.equal(instant(at(5,600)[2].end),instant('2026-10-18T00:00:00+03:00'),'grace is capped at local midnight');
});

test('window rule: the conference time zone decides where local midnight falls',()=>{
 const late=[{id:'L',start:'2026-10-17T22:00:00Z',end:'2026-10-17T23:50:00Z'}];
 const [utc]=computeWindows(late,{leadMinutes:5,graceMinutes:60,timeZone:'UTC'});
 assert.equal(utc.end,'2026-10-18T00:00:00.000Z','UTC: capped at 00:00Z');
 const [qatar]=computeWindows(late,{leadMinutes:5,graceMinutes:60,timeZone:'Asia/Qatar'});
 assert.equal(qatar.start,'2026-10-17T21:55:00.000Z');
 assert.equal(qatar.end,'2026-10-18T00:50:00.000Z','Qatar: 03:50 local, well before its midnight, so end + grace');
});

test('publish validation rejects every case in section 3 and changes nothing',()=>{
 for(const c of vectors.validation){
  const input=JSON.stringify(c.sessions);
  assert.deepEqual(validateSchedule(c.sessions,c.leadMinutes,c.graceMinutes),c.errors,c.name);
  assert.equal(JSON.stringify(c.sessions),input,`${c.name}: input untouched`);
 }
});

test('resolve: schedule versions, overrides and automation vectors (section 3)',()=>{
 for(const c of vectors.resolveCases){
  const r=resolveSession({versions:c.versions,overrides:c.overrides,committeeId:c.committeeId,at:c.at,dayClose:c.dayClose,timeZone:vectors.timeZone});
  same(r as unknown as Record<string,unknown>,c.expect,c.name);
 }
});

test('override expiry stored at creation: next switch under the version in effect, none when automation is off',()=>{
 for(const c of vectors.overrideExpiryCases)
  assert.equal(instant(overrideExpiry(c.versions,c.setAt,undefined,vectors.timeZone)),instant(c.expect),c.name);
});

test('resolve is history-stable: a later version and a later end event never change an earlier answer',()=>{
 const base=vectors.resolveCases.find(c=>c.name.startsWith('automation off, override S5 set 12:00'))!;
 const at='2026-10-17T12:20:00+03:00';
 const before=resolveSession({versions:base.versions.slice(0,1),overrides:[{...base.overrides[0],endedAt:null}],committeeId:'ga1',at,timeZone:vectors.timeZone});
 const after=resolveSession({versions:base.versions,overrides:base.overrides,committeeId:'ga1',at,timeZone:vectors.timeZone});
 assert.equal(before.sessionId,'S5');
 assert.equal(after.sessionId,'S5');
 assert.equal(after.source,'override');
});
