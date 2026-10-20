import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_DURATION,freshTimer,parseTimer,pauseTimer,resetTimer,setTimerDuration,startTimer,timerPhase,timerRemaining,timerStorageKey,TIMER_DURATIONS} from '../lib/timer/local-timer';
import {staffRoleForPath} from '../lib/access';

const T0=1_700_000_000_000;

test('a fresh timer is ready at the default duration',()=>{
 const t=freshTimer();
 assert.deepEqual(t,{duration:DEFAULT_DURATION,remaining:DEFAULT_DURATION,startedAt:null});
 assert.equal(timerRemaining(t,T0),90);assert.equal(timerPhase(t,T0),'ready');
});

test('start counts down, pause keeps what is left, resume continues from there',()=>{
 let t=startTimer(freshTimer(),T0);
 assert.equal(timerPhase(t,T0),'running');
 assert.equal(timerRemaining(t,T0+30_000),60);
 t=pauseTimer(t,T0+30_000);
 assert.deepEqual(t,{duration:90,remaining:60,startedAt:null});
 assert.equal(timerRemaining(t,T0+999_000),60,'paused time does not run');
 t=startTimer(t,T0+100_000);
 assert.equal(timerRemaining(t,T0+110_000),50);
 assert.equal(startTimer(t,T0+105_000),t,'starting a running timer changes nothing');
 assert.equal(pauseTimer(freshTimer(),T0).startedAt,null);
});

test('expiry: never negative, reported as expired, and starting again restarts from the full duration',()=>{
 const t=startTimer(freshTimer(60),T0);
 assert.equal(timerRemaining(t,T0+60_000),0);assert.equal(timerPhase(t,T0+60_000),'expired');
 assert.equal(timerRemaining(t,T0+600_000),0);
 const paused=pauseTimer(t,T0+61_000);
 assert.equal(timerRemaining(paused,T0+62_000),0);
 const again=startTimer(paused,T0+62_000);
 assert.equal(again.remaining,60);assert.equal(timerRemaining(again,T0+62_000),60);
 assert.equal(timerRemaining(startTimer(freshTimer(),T0),T0-5_000),90,'a clock moved back never adds time');
});

test('reset (what a new speech does) returns to the full configured duration, stopped, keeping the chosen duration',()=>{
 let t=startTimer(setTimerDuration(120),T0);
 t=resetTimer(t);
 assert.deepEqual(t,{duration:120,remaining:120,startedAt:null});
});

test('durations: the options are valid; out-of-range or non-finite values are refused',()=>{
 for(const n of TIMER_DURATIONS)assert.equal(setTimerDuration(n).duration,n);
 for(const bad of [0,-1,3601,NaN,Infinity])assert.throws(()=>setTimerDuration(bad),/between 1 second and 1 hour/);
 assert.equal(setTimerDuration(45.6).duration,46);
});

test('stored state is validated: malformed or hostile values are ignored, valid ones round-trip',()=>{
 const t=startTimer(freshTimer(120),T0);
 assert.deepEqual(parseTimer(JSON.stringify(t)),t);
 assert.deepEqual(parseTimer(JSON.stringify(freshTimer())),freshTimer());
 for(const bad of [null,undefined,'','not json','null','[]','{}','{"duration":"90","remaining":90,"startedAt":null}','{"duration":0,"remaining":0,"startedAt":null}','{"duration":90,"remaining":-1,"startedAt":null}','{"duration":90,"remaining":99999,"startedAt":null}','{"duration":90,"remaining":90,"startedAt":"now"}','{"duration":90,"remaining":90,"startedAt":-5}'])assert.equal(parseTimer(bad as string|null|undefined),null,String(bad));
 assert.equal(timerStorageKey('ga1'),'conference-os:timer:ga1');
 assert.notEqual(timerStorageKey('ga1'),timerStorageKey('ga2'),'timers are per committee');
});

test('the projector page is gone: no route, no role mapping, no styles',async()=>{
 assert.equal(staffRoleForPath('/projector'),undefined);
 const page=await readFile('app/[[...route]]/page.tsx','utf8');
 assert.ok(!page.includes('projector'));
 assert.ok(!(await readFile('app/globals.css','utf8')).includes('.projector'));
 assert.ok(!(await readFile('components/workspace.tsx','utf8')).includes('projector'));
});

test('no client code path persists a timer: the Command union, role table and sync fingerprint carry no timer',async()=>{
 const commands=await readFile('lib/commands.ts','utf8');
 assert.ok(!/type:\s*"timer"/.test(commands));
 assert.ok(!/case "timer"/.test(commands));
 assert.ok(!/timer:\s*\["chair"\]/.test(commands));
 assert.ok(!/case "timer"/.test(await readFile('lib/sync/repository.ts','utf8')));
 assert.ok(!/timers\[/.test(await readFile('lib/procedure/commands.ts','utf8')),'speech transitions no longer write a stored timer');
 const ui=await readFile('components/ui.tsx','utf8');
 assert.ok(!/type:\s*"timer"/.test(ui),'the Timer component sends no command');
});
