import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyCommand,type Command} from '../lib/commands';
import {createSeed} from '../lib/seed';
import type {ConferenceData,Role} from '../lib/domain';
import {conferenceScoring,effectiveScoring,isConfigurableScoring,REQUIRED_SCORING,scoringProblem,scoringValues} from '../lib/scoring';
import {countryCode,countryFlag,UNKNOWN_FLAG} from '../lib/countries';
import {validateImport} from '../lib/import';
import {activeAmendment,activePoi,amendmentFloorTaken,eventAmendmentId,nextPoi,nextSpeaker} from '../lib/procedure/view';
import {committeePhotoReminders} from '../lib/operations/photo-reminders';
import {PhotoAlert} from '../components/operations/photo-reminders';

const meta=()=>({id:crypto.randomUUID(),createdAt:'2026-10-05T06:00:00.000Z',actorId:'chair-1'});
const runner=(start:ConferenceData)=>{let d=start;const run=(c:Command,role:Role='chair')=>{d=applyCommand(d,c,role,meta());return d;};return {run,get d(){return d;}};};
const blank=()=>{const d=createSeed();d.scoring=[];d.events=[];return d;};

// ---------------------------------------------------------------- 1. Scoring
test('blank conference: required procedure scoring exists with defaults and can be established',()=>{
 const t=runner(blank());
 assert.deepEqual(conferenceScoring(t.d).map(s=>[s.id,s.values]),[['speech',[1,2,3]],['poi',[1,2]],['submitter',[5]]]);
 assert.deepEqual(scoringValues(t.d,'ga1','speech'),[1,2,3],'Chairs can score before an Executive saves anything');
 for(const r of REQUIRED_SCORING.filter(r=>isConfigurableScoring(r.id)))t.run({type:'scoring',id:r.id,values:[...r.values]},'admin');
 assert.deepEqual(t.d.scoring.map(s=>[s.id,s.label,s.values]),[['speech','Speech',[1,2,3]],['poi','POI',[1,2]]]);
 assert.throws(()=>t.run({type:'scoring',id:'submitter',values:[5]},'admin'),/fixed at \+5/,'Main Submitter is locked');
 assert.throws(()=>t.run({type:'scoring',id:'made-up',values:[1]},'admin'),/Unknown scoring category/);
});
test('configured Speech values drive the Chair console and are enforced',()=>{
 const t=runner(blank());t.run({type:'scoring',id:'speech',values:[2,4,6]},'admin');
 assert.deepEqual(scoringValues(t.d,'ga1','speech'),[2,4,6]);
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'Other'});
 const s=t.d.speeches![0];
 assert.throws(()=>t.run({type:'speechScore',sessionId:'s1',speechId:s.id,points:3}),/configured speech value/);
 t.run({type:'speechScore',sessionId:'s1',speechId:s.id,points:6});
 assert.equal(t.d.events.at(-1)?.points,6);
});
test('configured POI values drive POI scoring and are enforced',()=>{
 const t=runner(blank());t.run({type:'scoring',id:'poi',values:[1,3]},'admin');
 assert.deepEqual(scoringValues(t.d,'ga1','poi'),[1,3]);
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'Other'});
 const s=t.d.speeches![0];
 t.run({type:'poiAllowance',sessionId:'s1',speechId:s.id,limit:null});
 t.run({type:'poiAdd',sessionId:'s1',speechId:s.id,delegateId:'d2'});
 const entry=t.d.poiQueue![0];t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:entry.id});
 assert.throws(()=>t.run({type:'poiScore',sessionId:'s1',speechId:s.id,entryId:entry.id,points:2}),/configured POI value/);
 t.run({type:'poiScore',sessionId:'s1',speechId:s.id,entryId:entry.id,points:3});
 assert.equal(t.d.events.at(-1)?.points,3);
});
test('a committee override replaces only its own category; other committees keep the conference default',()=>{
 const t=runner(blank());
 t.run({type:'scoring',id:'speech',values:[1,2]},'admin');
 t.run({type:'scoring',id:'speech',values:[5,10],committeeId:'ga1'},'admin');
 assert.deepEqual(scoringValues(t.d,'ga1','speech'),[5,10]);
 assert.deepEqual(scoringValues(t.d,'ecosoc','speech'),[1,2],'conference default elsewhere');
 assert.deepEqual(scoringValues(t.d,'ga1','poi'),[1,2],'other categories still inherit');
 assert.deepEqual(t.d.committees.find(c=>c.id==='ga1')!.scoringOverrides!.map(s=>s.id),['speech']);
 assert.deepEqual(effectiveScoring(t.d,'ga1').map(s=>s.id),['speech','poi','submitter']);
});
test('invalid scoring values are rejected',()=>{
 for(const [id,values] of [['speech',[]],['speech',[21]],['speech',[-1]],['speech',[1.5]],['speech',[Number.NaN]],['poi',[1,1]],['speech',[0,1,2,3,4,5,6,7,8,9,10]],['submitter',[3,5]],['submitter',[5]],['submitter',[7]]] as [string,number[]][]){
  assert.ok(scoringProblem(id,values),`${id} ${values}`);
  assert.throws(()=>applyCommand(blank(),{type:'scoring',id,values},'admin'));
 }
 assert.equal(scoringProblem('speech',[0,2,4]),null);
});
test('Main Submitter credit stays a fixed +5, once per resolution, and cannot be configured or overridden',()=>{
 const t=runner(blank());
 assert.throws(()=>t.run({type:'scoring',id:'submitter',values:[7]},'admin'),/fixed at \+5/);
 assert.throws(()=>t.run({type:'scoring',id:'submitter',values:[7],committeeId:'ga1'},'admin'),/fixed at \+5/);
 t.d.committees.find(c=>c.id==='ga1')!.scoringOverrides=[{id:'submitter',label:'Main Submitter',values:[9]}]; // even legacy stored data cannot change it
 assert.deepEqual(scoringValues(t.d,'ga1','submitter'),[5]);
 for(let i=0;i<2;i++){
  t.run({type:'speechStart',sessionId:'s1',delegateId:'d0',resolutionId:'r1',classification:'Main Submitter'});
  const s=t.d.speeches!.at(-1)!;t.run({type:'speechScore',sessionId:'s1',speechId:s.id,points:2});t.run({type:'speechFinish',sessionId:'s1',speechId:s.id});
 }
 const credits=t.d.events.filter(e=>e.categoryId==='submitter'&&e.resolutionId==='r1');
 assert.equal(credits.length,1);assert.equal(credits[0].points,5);assert.equal(credits[0].delegateId,'d0');
 assert.throws(()=>t.run({type:'participation',delegateId:'d0',categoryId:'submitter',points:5,sessionId:'s1',resolutionId:'r1'}),/only be recorded once/);
});

// ---------------------------------------------------------------- 2. Country flags
test('country text derives its flag, including MUN aliases; unknown labels fall back to the globe',()=>{
 const cases:[string,string][]=[['United States','US'],['USA','US'],['U.S.A.','US'],['United Kingdom','GB'],['UK','GB'],['South Korea','KR'],['Republic of Korea','KR'],['North Korea','KP'],['DPRK','KP'],['Russia','RU'],['Russian Federation','RU'],['Türkiye','TR'],['Turkey','TR'],['Côte d’Ivoire','CI'],["Cote d'Ivoire",'CI'],['Ivory Coast','CI'],['Czechia','CZ'],['Czech Republic','CZ'],['Palestine','PS'],['State of Palestine','PS'],['Vatican City','VA'],['Holy See','VA'],['  the netherlands ','NL'],['Saint Lucia','LC'],['St. Lucia','LC']];
 for(const [name,code] of cases)assert.equal(countryCode(name),code,name);
 assert.equal(countryFlag('France'),'🇫🇷');assert.equal(countryFlag('USA'),'🇺🇸');assert.equal(countryFlag('Holy See'),'🇻🇦');
 for(const label of ['Press Corps','Historical Crisis Cabinet','',' '])assert.equal(countryFlag(label),UNKNOWN_FLAG,label);
});
test('CSV import and delegate edit derive the flag and keep the country text as entered',()=>{
 const rows=validateImport([['Ali','Türkiye','ali@example.com'],['Bo','Press Corps','bo@example.com']],{name:0,country:1,email:2},[]);
 assert.deepEqual(rows.map(r=>[r.country,r.flag]),[['Türkiye','🇹🇷'],['Press Corps',UNKNOWN_FLAG]]);
 const t=runner(createSeed());
 t.run({type:'import',rows:rows.map(r=>({name:r.name,country:r.country,email:r.email,flag:r.flag,committeeId:'ga1',schoolId:'school0'}))},'admin');
 const ali=t.d.delegates.find(x=>x.email==='ali@example.com')!;assert.equal(ali.flag,'🇹🇷');assert.equal(ali.country,'Türkiye');
 t.run({type:'delegate',id:ali.id,name:ali.name,email:ali.email,country:'Ivory Coast',flag:countryFlag('Ivory Coast')},'admin');
 const edited=t.d.delegates.find(x=>x.id===ali.id)!;assert.equal(edited.country,'Ivory Coast');assert.equal(edited.flag,'🇨🇮');
});

// ---------------------------------------------------------------- 3. Photo alert
test('an applicable photo slot produces a GROUP PHOTO attention alert; unrelated committees get none',()=>{
 const d=applyCommand(createSeed(),{type:'photoSlot',action:'create',schoolId:'school0',startsAt:'2026-10-05T10:30:00.000Z',endsAt:null,location:'Main Courtyard',note:'',warnMinutes:10},'admin',meta());
 const warning=committeePhotoReminders(d,'ga1',Date.parse('2026-10-05T10:20:00Z')).filter(r=>r.attention);
 assert.equal(warning.length,1);assert.equal(committeePhotoReminders(d,'sc',Date.parse('2026-10-05T10:20:00Z')).filter(r=>r.attention).length,0,'SC has no school0 delegates');
 const html=renderToStaticMarkup(createElement(PhotoAlert,{reminder:warning[0],absent:new Set<string>(),open:true,onToggle(){},onAcknowledge(){}}));
 for(const text of ['GROUP PHOTO IN 10 MINUTES','Main Courtyard','France','India','Kenya','Norway','Acknowledge'])assert.ok(html.includes(text),text);
 const due=committeePhotoReminders(d,'ga1',Date.parse('2026-10-05T10:31:00Z')).filter(r=>r.attention);
 const dueHtml=renderToStaticMarkup(createElement(PhotoAlert,{reminder:due[0],absent:new Set<string>(),open:true,onToggle(){},onAcknowledge(){}}));
 for(const text of ['GROUP PHOTO NOW','Delegates sent','Main Courtyard'])assert.ok(dueHtml.includes(text),text);
 // Acknowledging the warning clears that stage only; a revised slot alerts again.
 const acked=applyCommand(d,{type:'photoAck',committeeId:'ga1',slotId:d.photoSlots![0].id,stage:'warning',revision:d.photoSlots![0].revision},'chair',meta());
 assert.equal(committeePhotoReminders(acked,'ga1',Date.parse('2026-10-05T10:20:00Z')).filter(r=>r.attention).length,0);
 assert.equal(committeePhotoReminders(acked,'ga1',Date.parse('2026-10-05T10:31:00Z')).filter(r=>r.attention).length,1,'due stage still alerts');
});

// ---------------------------------------------------------------- 4. Speaker and POI queues
test('Next speaker: only queue position 1 can be recognized; reordering changes who is next',()=>{
 const t=runner(createSeed());
 const [first,second]=t.d.queue.filter(q=>q.sessionId==='s1').sort((a,b)=>a.position-b.position);
 assert.equal(nextSpeaker(t.d,'s1')?.id,first.id);
 assert.throws(()=>t.run({type:'speechStart',sessionId:'s1',delegateId:second.delegateId,resolutionId:'r1',classification:'Other',entryId:second.id}),/Only the first speaker/);
 const order=t.d.queue.filter(q=>q.sessionId==='s1').sort((a,b)=>a.position-b.position).map(q=>q.id);
 t.run({type:'queueOrder',sessionId:'s1',lane:'open',ids:[order[1],order[0],...order.slice(2)]});
 assert.equal(nextSpeaker(t.d,'s1')?.id,second.id);
 t.run({type:'speechStart',sessionId:'s1',delegateId:second.delegateId,resolutionId:'r1',classification:'Other',entryId:second.id});
 assert.equal(t.d.speeches!.at(-1)?.delegateId,second.delegateId);
 t.run({type:'speechFinish',sessionId:'s1',speechId:t.d.speeches!.at(-1)!.id});
 assert.ok(!t.d.speeches!.some(s=>s.state!=='finished'),'finishing never starts the next speaker');
 assert.equal(nextSpeaker(t.d,'s1')?.id,first.id);
});
test('closed debate: Next speaker uses only the active For/Against phase',()=>{
 const t=runner(createSeed());t.d.queue=[];
 t.run({type:'queueAdd',sessionId:'s1',delegateId:'d1',lane:'for'});t.run({type:'queueAdd',sessionId:'s1',delegateId:'d2',lane:'against'});
 t.run({type:'debateMode',sessionId:'s1',mode:'closed',phase:'against'});
 const forEntry=t.d.queue.find(q=>q.lane==='for')!,against=t.d.queue.find(q=>q.lane==='against')!;
 assert.equal(nextSpeaker(t.d,'s1')?.id,against.id);
 assert.throws(()=>t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'For',entryId:forEntry.id}),/Only the first speaker/);
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d2',resolutionId:'r1',classification:'Against',entryId:against.id});
 assert.equal(t.d.speeches!.at(-1)?.classification,'Against');
});
test('POIs: recognize (no event) → score (exactly one event); one active POI; allowance applies',()=>{
 const t=runner(createSeed());const before=t.d.events.length;
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'Other'});
 const s=t.d.speeches!.at(-1)!;
 t.run({type:'poiAdd',sessionId:'s1',speechId:s.id,delegateId:'d2'});t.run({type:'poiAdd',sessionId:'s1',speechId:s.id,delegateId:'d3'});
 const [p1,p2]=t.d.poiQueue!;
 assert.throws(()=>t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p1.id}),/allowance/);
 t.run({type:'poiAllowance',sessionId:'s1',speechId:s.id,limit:1});
 assert.throws(()=>t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p2.id}),/Only the first POI/);
 assert.throws(()=>t.run({type:'poiScore',sessionId:'s1',speechId:s.id,entryId:p1.id,points:2}),/Recognize this POI/);
 t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p1.id});
 assert.equal(t.d.events.length,before,'recognition records no participation');
 assert.equal(activePoi(t.d,s.id)?.id,p1.id);assert.equal(nextPoi(t.d,s.id),undefined,'next POI blocked while one is active');
 assert.throws(()=>t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p2.id}),/current POI first/);
 t.run({type:'poiScore',sessionId:'s1',speechId:s.id,entryId:p1.id,points:2});
 const pois=t.d.events.filter(e=>e.speechId===s.id&&e.categoryId==='poi');
 assert.equal(pois.length,1);assert.equal(pois[0].delegateId,'d2');assert.equal(t.d.speeches!.at(-1)!.poiCount,1);
 assert.throws(()=>t.run({type:'poiScore',sessionId:'s1',speechId:s.id,entryId:p1.id,points:2}),/Recognize this POI/,'cannot score twice');
 assert.equal(nextPoi(t.d,s.id)?.id,p2.id);
 assert.throws(()=>t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p2.id}),/allowance/,'allowance of 1 is used');
 t.run({type:'poiAllowance',sessionId:'s1',speechId:s.id,limit:2});
 t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p2.id});
 t.run({type:'poiRemove',sessionId:'s1',speechId:s.id,entryId:p2.id});
 assert.equal(t.d.events.filter(e=>e.speechId===s.id&&e.categoryId==='poi').length,1,'withdrawn POI records nothing');
});

// ---------------------------------------------------------------- 5. Amendment debate
test('amendment debate: context, one active amendment, retained context on events, return to resolution debate',()=>{
 const d=createSeed();
 d.amendments=[0,1].map(i=>({id:`am${i}`,committeeId:'ga1',resolutionId:'r1',sessionId:'s1',submitterId:'d3',type:'Add' as const,clause:`Clause ${i+2}`,wording:`Adds a reporting duty ${i}`,status:'Accepted for Debate' as const,outcome:null,createdAt:'2026-10-05T06:00:00.000Z',revision:1}));
 const t=runner(d);
 assert.equal(activeAmendment(t.d,'ga1'),undefined);
 t.run({type:'amendmentStatus',id:'am0',status:'In Debate'});
 assert.equal(activeAmendment(t.d,'ga1')?.id,'am0');
 assert.equal(t.d.documents.find(r=>r.id==='r1')?.status,'In Debate','parent resolution remains In Debate');
 assert.throws(()=>t.run({type:'amendmentStatus',id:'am1',status:'In Debate'}),/current amendment debate first/);
 assert.throws(()=>t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'For',amendmentId:null}),/amendment debate changed/);
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'For',amendmentId:'am0'});
 const s=t.d.speeches!.at(-1)!;assert.equal(s.amendmentId,'am0');assert.equal(s.resolutionId,'r1');
 t.run({type:'speechScore',sessionId:'s1',speechId:s.id,points:2});
 t.run({type:'poiAllowance',sessionId:'s1',speechId:s.id,limit:1});t.run({type:'poiAdd',sessionId:'s1',speechId:s.id,delegateId:'d2'});
 const p=t.d.poiQueue![0];t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:p.id});t.run({type:'poiScore',sessionId:'s1',speechId:s.id,entryId:p.id,points:1});
 for(const e of t.d.events.filter(e=>e.speechId===s.id))assert.equal(eventAmendmentId(t.d,e),'am0',e.categoryId);
 t.run({type:'speechFinish',sessionId:'s1',speechId:s.id});
 t.run({type:'amendmentStatus',id:'am0',status:'Closed',outcome:'Passed'});
 assert.equal(activeAmendment(t.d,'ga1'),undefined,'Debate Console returns to resolution debate');
 assert.equal(t.d.documents.find(r=>r.id==='r1')?.status,'In Debate');
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d4',resolutionId:'r1',classification:'Other',amendmentId:null});
 assert.equal(t.d.speeches!.at(-1)?.amendmentId,null,'later speeches are resolution debate again');
 t.run({type:'speechFinish',sessionId:'s1',speechId:t.d.speeches!.at(-1)!.id});
 t.run({type:'amendmentStatus',id:'am1',status:'In Debate'});t.run({type:'amendmentStatus',id:'am1',status:'Closed',outcome:'Failed'});
 assert.equal(activeAmendment(t.d,'ga1'),undefined);
});

// ---------------------------------------------------------------- Review follow-up: floor and amendment procedure
const withAmendment=()=>{const d=createSeed();d.amendments=[{id:'am',committeeId:'ga1',resolutionId:'r1',sessionId:'s1',submitterId:'d3',type:'Strike' as const,clause:'Clause 1',wording:'Strike clause 1.',status:'Accepted for Debate' as const,outcome:null,createdAt:'2026-10-05T06:00:00.000Z',revision:1}];d.committees.find(c=>c.id==='ga1')!.currentSessionId='s1';return runner(d);};
test('an amendment debate cannot start while a speech (including its POI phase) holds the floor; it can after speechFinish',()=>{
 const t=withAmendment();
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'Other',amendmentId:null});
 const s=t.d.speeches!.at(-1)!;
 assert.ok(amendmentFloorTaken(t.d,t.d.amendments![0]));
 assert.throws(()=>t.run({type:'amendmentStatus',id:'am',status:'In Debate'}),/return the floor to the Chair/);
 t.run({type:'poiAllowance',sessionId:'s1',speechId:s.id,limit:2});
 assert.throws(()=>t.run({type:'amendmentStatus',id:'am',status:'In Debate'}),/return the floor to the Chair/,'POI phase still holds the floor');
 t.run({type:'speechFinish',sessionId:'s1',speechId:s.id});
 assert.equal(amendmentFloorTaken(t.d,t.d.amendments![0]),false);
 t.run({type:'amendmentStatus',id:'am',status:'In Debate'});
 assert.equal(activeAmendment(t.d,'ga1')?.id,'am');
});
for(const outcome of ['Passed','Failed','Withdrawn','Ruled Out'] as const)test(`an active amendment cannot be ${outcome} while a speech/POI holds the floor; it can once the floor returns`,()=>{
 const t=withAmendment();t.run({type:'amendmentStatus',id:'am',status:'In Debate'});
 t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'Against',amendmentId:'am'});
 const s=t.d.speeches!.at(-1)!;
 assert.throws(()=>t.run({type:'amendmentStatus',id:'am',status:'Closed',outcome}),/return the floor to the Chair/);
 t.run({type:'poiAllowance',sessionId:'s1',speechId:s.id,limit:1});t.run({type:'poiAdd',sessionId:'s1',speechId:s.id,delegateId:'d2'});
 t.run({type:'poiRecognize',sessionId:'s1',speechId:s.id,entryId:t.d.poiQueue![0].id});
 assert.throws(()=>t.run({type:'amendmentStatus',id:'am',status:'Closed',outcome}),/return the floor to the Chair/,'active POI holds the floor');
 t.run({type:'speechFinish',sessionId:'s1',speechId:s.id});
 t.run({type:'amendmentStatus',id:'am',status:'Closed',outcome});
 assert.equal(t.d.amendments![0].outcome,outcome);assert.equal(activeAmendment(t.d,'ga1'),undefined);
});
test('stale Main Submitter speechStart is rejected during amendment debate; For/Against/Other remain available',()=>{
 const t=withAmendment();t.run({type:'amendmentStatus',id:'am',status:'In Debate'});
 assert.throws(()=>t.run({type:'speechStart',sessionId:'s1',delegateId:'d0',resolutionId:'r1',classification:'Main Submitter',amendmentId:'am'}),/not amendment debate/);
 assert.throws(()=>t.run({type:'speechStart',sessionId:'s1',delegateId:'d0',resolutionId:'r1',classification:'Main Submitter'}),/not amendment debate/,'older client without amendmentId');
 for(const classification of ['For','Against','Other'] as const){
  t.run({type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification,amendmentId:'am'});
  const s=t.d.speeches!.at(-1)!;assert.equal(s.amendmentId,'am');
  assert.throws(()=>t.run({type:'speechYield',sessionId:'s1',speechId:s.id,delegateId:'d2'}),/Only a Main Submitter/,'no Co-Submitter yield');
  t.run({type:'speechFinish',sessionId:'s1',speechId:s.id});
 }
});
