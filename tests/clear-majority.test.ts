import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {applyCommand,observedContextProblem,observedDeclaration,observedMajorityProblem,votingOutcome} from '../lib/commands';
import type {Command} from '../lib/commands';
import type {ConferenceData,Role} from '../lib/domain';
import {ConferenceProvider} from '../lib/context';
import {repository} from '../lib/repository';
import {grantAccess} from '../lib/access';
import {createSeed} from '../lib/seed';
import {freshDatabase} from './helpers/database';

// Renders a real route (same harness as debate-console-ui.test.ts).
async function render(t:test.TestContext,data:ConferenceData,route:string,role:Role='chair'){
 const require=createRequire(import.meta.url),cssLoader=require.extensions['.css'];
 require.extensions['.css']=module=>{module.exports={};};
 const {default:Page}=await import('../app/[[...route]]/page');
 if(cssLoader)require.extensions['.css']=cssLoader;else delete require.extensions['.css'];
 t.mock.method(React,'useSyncExternalStore',((_s:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 t.mock.method(React,'useEffect',()=>{});
 t.mock.method(repository,'getSnapshot',()=>data);
 t.mock.method(repository,'getAccess',()=>grantAccess([{role,committee_id:role==='chair'?'ga1':null,expires_at:new Date(Date.now()+3600000).toISOString()}],'staff-device'));
 const router={bfcacheId:'test',back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){}};
 const page=await Page({params:Promise.resolve({route:route.split('/')})});
 return renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(PathnameContext.Provider,{value:`/${route}`},createElement(ConferenceProvider,null,page))));
}
const text=(html:string)=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/\s+/g,' ');

// Clear majority For / Against (20261021110000_clear_majority): a declared, observed result with no invented ballots.
const meta=()=>({id:crypto.randomUUID(),createdAt:'2026-11-05T10:00:00.000Z',actorId:'chair-1'});
const inDebate=(committee='ga1')=>{const d=createSeed();const r=d.documents.find(x=>x.committeeId===committee)!;r.status='In Debate';d.votes=d.votes.filter(v=>v.resolutionId!==r.id);return {d,r};};
// An observed close names the ballot session the Chair confirmed: the resolution's own unless given (null omits it).
const close=(d:ConferenceData,id:string,outcome:'Passed'|'Failed'|'Withdrawn'|undefined,method?:string,sessionId:string|null|undefined=d.documents.find(x=>x.id===id)?.sessionId)=>
 applyCommand(d,{type:'document',id,status:'Closed',outcome,method,...(method&&sessionId!==null?{sessionId}:{})} as Command,'chair',meta());

test('client: clear majority is available only where an observation can establish the result',()=>{
 let {d,r}=inDebate();
 assert.equal(observedMajorityProblem(d,r.id),null,'normal simple-majority vote');
 r.voteType='procedural';assert.equal(observedMajorityProblem(d,r.id),null,'procedural votes too (owner, 20 October)');
 r.voteType='substantive';r.voteMode='divide';assert.match(observedMajorityProblem(d,r.id)!,/Divide the House/);
 r.voteMode='normal';d.committees.find(c=>c.id==='ga1')!.votingRule='two_thirds';assert.match(observedMajorityProblem(d,r.id)!,/two-thirds/);
 d.committees.find(c=>c.id==='ga1')!.votingRule=undefined;d.conference.votingRule='two_thirds';assert.match(observedMajorityProblem(d,r.id)!,/two-thirds/,'conference rule applies');
 ({d,r}=inDebate('sc'));
 d.committees.find(c=>c.id==='sc')!.vetoEnabled=true;
 assert.match(observedMajorityProblem(d,r.id)!,/veto/,'a veto-enabled substantive vote needs counted ballots');
 r.voteType='procedural';assert.equal(observedMajorityProblem(d,r.id),null,'no veto applies to a procedural vote');
});

test('client: an observed close records the declared result only; earlier ballots are kept, not counted',()=>{
 const {d,r}=inDebate();
 // One ballot recorded before the Chair switched to a declared majority.
 const voter=d.attendance.find(a=>a.sessionId===r.sessionId&&a.status==='Present')!;
 d.votes.push({id:'v-early',delegateId:voter.delegateId,sessionId:r.sessionId!,resolutionId:r.id,choice:'Against',createdAt:'2026-11-05'});
 assert.throws(()=>close(d,r.id,'Passed'),/every eligible ballot/,'the counted path still needs every ballot');
 assert.throws(()=>close(d,r.id,undefined,'observed'),/Choose an outcome|Passed or Failed/);
 assert.throws(()=>close(d,r.id,'Passed','guess'),/Unknown voting method/);
 const after=close(d,r.id,'Passed','observed');
 const closed=after.documents.find(x=>x.id===r.id)!;
 assert.deepEqual([closed.status,closed.outcome,closed.outcomeMethod,closed.declaredBy,closed.declaredAt,closed.vetoedBy],['Closed','Passed','observed','chair-1','2026-11-05T10:00:00.000Z',[]]);
 assert.deepEqual(after.votes.filter(v=>v.resolutionId===r.id).map(v=>[v.id,v.choice]),[['v-early','Against']],'no ballots invented or removed');
 assert.equal(votingOutcome(after,r.id),'Failed','the counted arithmetic is untouched, which is why the stored outcome is authoritative');
 // Clear majority Against closes as Failed; Withdrawn ignores the method.
 const against=close(inDebate().d,r.id,'Failed','observed').documents.find(x=>x.id===r.id)!;
 assert.deepEqual([against.outcome,against.outcomeMethod],['Failed','observed']);
 const withdrawn=close(inDebate().d,r.id,'Withdrawn','observed').documents.find(x=>x.id===r.id)!;
 assert.deepEqual([withdrawn.outcome,withdrawn.outcomeMethod],['Withdrawn',undefined]);
 assert.throws(()=>applyCommand(after,{type:'document',id:r.id,status:'Closed',outcome:'Failed',method:'observed'},'chair',meta()),/./,'Closed is final');
});

test('client: an observed close keeps a nonzero eligible attendance and the ballot session; ballots stay optional',()=>{
 // Reproduced before the fix: with no attendance, or everyone Absent, an observed Passed was accepted.
 let {d,r}=inDebate();
 d.attendance=d.attendance.filter(a=>a.sessionId!==r.sessionId);
 assert.match(observedContextProblem(d,r.id,r.sessionId)!,/No delegation is present/);
 assert.throws(()=>close(d,r.id,'Passed','observed'),/No delegation is present/,'no attendance');
 ({d,r}=inDebate());
 for(const a of d.attendance)if(a.sessionId===r.sessionId)a.status='Absent';
 assert.throws(()=>close(d,r.id,'Failed','observed'),/No delegation is present/,'everyone Absent');
 d.attendance.find(a=>a.sessionId===r.sessionId)!.status='Present';
 assert.equal(close(d,r.id,'Passed','observed').documents.find(x=>x.id===r.id)!.outcomeMethod,'observed','one delegation present, no ballots: allowed');
 // The session the Chair confirmed must still be the resolution's ballot session.
 ({d,r}=inDebate());
 d.sessions.push({...d.sessions.find(s=>s.id===r.sessionId)!,id:'s-other',name:'Session 3'});
 assert.equal(observedContextProblem(d,r.id,r.sessionId),null);
 assert.match(observedContextProblem(d,r.id,'s-other')!,/different session/,'the console moved to another session');
 assert.throws(()=>close(d,r.id,'Passed','observed','s-other'),/different session/);
 assert.throws(()=>close(d,r.id,'Passed','observed',null),/different session/,'no confirmed session');
 assert.throws(()=>close(d,r.id,'Passed','observed','missing'),/valid session/,'unknown session');
});

test('history: an observed result names the declaring Chair and time; earlier ballots are kept, not counted',()=>{
 const {d,r}=inDebate();
 assert.equal(observedDeclaration(d,r.id),null,'an open vote has no declaration');
 const voter=d.attendance.find(a=>a.sessionId===r.sessionId&&a.status==='Present')!;
 d.votes.push({id:'v-early',delegateId:voter.delegateId,sessionId:r.sessionId!,resolutionId:r.id,choice:'For',createdAt:'2026-11-05'});
 const named=applyCommand(d,{type:'document',id:r.id,status:'Closed',outcome:'Failed',method:'observed',sessionId:r.sessionId!},'chair',{...meta(),actorId:'chair-demo'});
 assert.deepEqual(observedDeclaration(named,r.id),{by:'Alex Morgan',at:'2026-11-05T10:00:00.000Z',keptBallots:1});
 assert.deepEqual(observedDeclaration(close(d,r.id,'Failed','observed'),r.id),{by:'the committee Chair',at:'2026-11-05T10:00:00.000Z',keptBallots:1},'an unresolved Chair is not invented');
 const counted=inDebate();
 for(const a of counted.d.attendance.filter(a=>a.sessionId===counted.r.sessionId&&a.status!=='Absent'))counted.d.votes.push({id:`v-${a.delegateId}`,delegateId:a.delegateId,sessionId:counted.r.sessionId!,resolutionId:counted.r.id,choice:'For',createdAt:'2026-11-05'});
 assert.equal(observedDeclaration(close(counted.d,counted.r.id,'Passed'),counted.r.id),null,'a counted result is not a declaration');
});

test('Voting console: Clear majority keeps the counted close’s session safeguard and attendance floor',async t=>{
 const live=(d:ConferenceData,session='s1')=>{d.committees.find(c=>c.id==='ga1')!.currentSessionId=session;return d;};
 const ok=await render(t,live(createSeed()),'chair/voting');
 assert.match(ok,/<button>Clear majority For<\/button><button>Clear majority Against<\/button>/,'enabled on the ballot session');
 assert.match(text(ok),/Obvious result\?/);
 // The committee moved to another session: both Clear majority actions are disabled, like Close voting.
 const moved=createSeed();moved.sessions.push({...moved.sessions.find(s=>s.id==='s1')!,id:'s-next',name:'Session 3 · Voting'});
 const raw=await render(t,live(moved,'s-next'),'chair/voting');
 assert.match(raw,/<button disabled="">Clear majority For<\/button><button disabled="">Clear majority Against<\/button>/);
 assert.match(text(raw),/Clear majority unavailable: This ballot belongs to a different session/);
 assert.match(text(raw),/ballot belongs to Session 2 · General debate\. Select that session/,'names the ballot session');
 assert.doesNotMatch(raw,/Confirm clear majority/);
 // Nobody present in the ballot session.
 const absent=live(createSeed());for(const a of absent.attendance)if(a.sessionId==='s1')a.status='Absent';
 const none=await render(t,absent,'chair/voting');
 assert.match(none,/<button disabled="">Clear majority For<\/button>/);
 assert.match(text(none),/No delegation is present in this ballot’s session/);
});

test('History: Documents and the Executive overview name the declaring Chair and time',async t=>{
 const {d,r}=inDebate();d.committees.find(c=>c.id==='ga1')!.currentSessionId='s1';
 const voter=d.attendance.find(a=>a.sessionId===r.sessionId&&a.status==='Present')!;
 d.votes.push({id:'v-early',delegateId:voter.delegateId,sessionId:r.sessionId!,resolutionId:r.id,choice:'Against',createdAt:'2026-11-05'});
 const closed=applyCommand(d,{type:'document',id:r.id,status:'Closed',outcome:'Passed',method:'observed',sessionId:r.sessionId!},'chair',{...meta(),actorId:'chair-demo'});
 const docs=text(await render(t,closed,'chair/documents'));
 assert.match(docs,/Clear majority declared by Alex Morgan · 5 Nov 2026, 13:00 Qatar time\. No country votes or totals recorded; 1 earlier ballot kept, not counted\./);
 const executive=text(await render(t,closed,'admin/resolution-status','admin'));
 assert.match(executive,/Clear majority declared by Alex Morgan · 5 Nov 2026, 13:00 Qatar time\. No country votes or totals recorded/);
});

test('real PostgreSQL: observed close parity, refusals, stale revisions and committee scope',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const chair='74000000-0000-4000-8000-000000000001',whoChair='74000000-0000-4000-8000-000000000002';
 try{
  await grant(chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);
  const revision=async()=>{await asOwner();return String((await query<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution]))[0].revision);};
  const send=async(user:string,c:unknown,expected?:string)=>{const value=expected??await revision();await as(user);return db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(c),'chair',value,'2026-11-05T10:00:00Z']);};
  const reset=async(set:string)=>{await asOwner();await db.query(`update public.documents set status='In Debate',outcome=null,"outcomeMethod"='counted',"declaredBy"=null,"declaredByName"=null,"declaredAt"=null,"voteMode"='normal',"voteType"='substantive' where id=$1`,[ids.resolution]);await db.query(`update public.committees set voting_rule=null,"vetoEnabled"=false where id=$1`,[ids.ga1]);if(set)await db.query(set,[ids.resolution,ids.ga1]);};
  const observed=(outcome:string,method='observed',sessionId:string|null=ids.session)=>({type:'document',id:ids.resolution,status:'Closed',outcome,method,...(sessionId===null?{}:{sessionId})});
  const row=async()=>{await asOwner();return (await query<{status:string;outcome:string;outcomeMethod:string;declaredBy:string|null;declaredByName:string|null;declaredAt:Date|null}>('select status,outcome,"outcomeMethod","declaredBy","declaredByName","declaredAt" from public.documents where id=$1',[ids.resolution]))[0];};

  // Refusals mirror the client rule.
  for(const [label,set,pattern] of [
   ['Divide the House',`update public.documents set "voteMode"='divide' where id=$1 and $2::uuid is not null`,/Divide the House/],
   ['two-thirds',`update public.committees set voting_rule='two_thirds' where id=$2 and $1::uuid is not null`,/two-thirds/],
   ['veto-enabled substantive',`update public.committees set "vetoEnabled"=true where id=$2 and $1::uuid is not null`,/no veto was cast/],
  ] as const){
   await reset(set);
   await assert.rejects(()=>send(chair,observed('Passed')),pattern,label);
  }
  await reset('');
  await assert.rejects(()=>send(chair,observed('Passed','guess')),/Unknown voting method/);
  await assert.rejects(()=>send(chair,{type:'document',id:ids.resolution,status:'Closed',method:'observed'}),/Passed or Failed/);
  await assert.rejects(()=>send(whoChair,observed('Passed')),/no access|outside/i,'another committee cannot close it');
  await assert.rejects(()=>send(chair,observed('Passed'),'0'),/changed|another chair|stale/i,'a stale revision is a conflict');
  // The ballot/session context: the session the Chair confirmed must be the resolution's ballot session.
  await assert.rejects(()=>send(chair,observed('Passed','observed',crypto.randomUUID())),/different session/,'another session');
  await assert.rejects(()=>send(chair,observed('Passed','observed',null)),/different session/,'no confirmed session');
  await assert.rejects(()=>send(chair,observed('Passed','observed','not-a-uuid')),/different session/,'malformed session');

  // One ballot already recorded: kept, not counted, not required. The declaring Chair's staff name is recorded.
  await asOwner();
  await db.query(`update public.staff set auth_user_id=$1 where name='Alex Morgan' and conference_id=$2`,[chair,ids.conference]);
  const voter=(await query<{delegateId:string}>(`select "delegateId" from public.attendance where "sessionId"=$1 and status='Present' limit 1`,[ids.session]))[0].delegateId;
  await db.query(`update public.documents set "sessionId"=$1 where id=$2`,[ids.session,ids.resolution]);
  await db.query('delete from public.votes where "resolutionId"=$1',[ids.resolution]);
  await db.query(`insert into public.votes(conference_id,committee_id,"delegateId","sessionId","resolutionId",choice) values($1,$2,$3,$4,$5,'Against')`,[ids.conference,ids.ga1,voter,ids.session,ids.resolution]);
  await send(chair,observed('Passed'));
  const closed=await row();
  assert.deepEqual([closed.status,closed.outcome,closed.outcomeMethod,closed.declaredBy,closed.declaredByName],['Closed','Passed','observed',chair,'Alex Morgan']);
  assert.equal(closed.declaredAt?.toISOString(),'2026-11-05T10:00:00.000Z');
  assert.deepEqual((await query<{choice:string}>('select choice from public.votes where "resolutionId"=$1',[ids.resolution])).map(v=>v.choice),['Against'],'ballots untouched');
  await as(chair);
  const snap=(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const projected=snap.documents.find(r=>r.id===ids.resolution)!;
  assert.deepEqual([projected.outcomeMethod,projected.declaredByName],['observed','Alex Morgan'],'the snapshot carries the method and the declaring Chair');
  assert.deepEqual(observedDeclaration(snap,ids.resolution),{by:'Alex Morgan',at:'2026-11-05T10:00:00+00:00',keptBallots:1},'history reads the server projection');

  // Procedural vote in a veto-enabled committee: allowed. Against → Failed.
  await reset(`update public.documents set "voteType"='procedural' where id=$1 and $2::uuid is not null`);
  await asOwner();await db.query(`update public.committees set "vetoEnabled"=true where id=$1`,[ids.ga1]);
  await send(chair,observed('Failed'));
  assert.deepEqual([(await row()).outcome,(await row()).outcomeMethod],['Failed','observed']);

  // Withdrawn with the method is an ordinary withdrawal; the counted path is unchanged.
  await reset('');
  await send(chair,observed('Withdrawn'));
  assert.deepEqual([(await row()).outcome,(await row()).outcomeMethod],['Withdrawn','counted']);
  await reset('');
  await assert.rejects(()=>send(chair,{type:'document',id:ids.resolution,status:'Closed',outcome:'Passed'}),/every eligible ballot|configured voting rule/,'counted close still needs ballots');

  // Attendance floor. Reproduced before the fix: both closes were accepted with nobody present.
  await reset('');
  await asOwner();
  await db.query('delete from public.votes where "resolutionId"=$1',[ids.resolution]);
  await db.query(`update public.attendance set status='Absent' where "sessionId"=$1`,[ids.session]);
  await assert.rejects(()=>send(chair,observed('Passed')),/No delegation is present/,'everyone Absent');
  await asOwner();
  await db.query(`update public.attendance set status='Present' where "sessionId"=$1 and "delegateId"=$2`,[ids.session,voter]);
  await send(chair,observed('Failed'));
  assert.deepEqual([(await row()).outcome,(await row()).outcomeMethod],['Failed','observed'],'one delegation present, no ballots: allowed');
  await reset('');
  await asOwner();
  await db.query('delete from public.attendance where "sessionId"=$1',[ids.session]);
  await assert.rejects(()=>send(chair,observed('Passed')),/No delegation is present/,'no attendance at all');

  await asOwner();
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed' where id=$1`,[ids.resolution]),/documents_observed_declared/,'an observed outcome always names who declared it');
  // Reproduced before the fix: a NULL outcome made the CHECK unknown, which a CHECK accepts.
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed',"declaredBy"=$2,"declaredAt"=now(),outcome=null where id=$1`,[ids.resolution,chair]),/documents_observed_declared/,'observed with a NULL outcome');
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed',"declaredBy"=$2,"declaredAt"=now(),status='Closed',outcome='Withdrawn' where id=$1`,[ids.resolution,chair]),/documents_observed_declared/,'observed Withdrawn');
  await db.query(`update public.documents set "outcomeMethod"='observed',"declaredBy"=$2,"declaredAt"=now(),status='Closed',outcome='Passed' where id=$1`,[ids.resolution,chair]);
 }finally{await db.close();}
});
