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
import {VotingConsole} from '../components/voting-console';
import {openBallot as snapshotBallot} from '../lib/sessions/presence';
import {ConflictError,DurableRepository,type Transport} from '../lib/sync/repository';
import {DurableStore,type Checkpoint,type Mutation} from '../lib/sync/store';

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
// In debate with its ballot open: eligibility is snapshotted from the committee's roll call (docs/SESSION_MODEL.md section 6).
const inDebate=(committee='ga1')=>{const d=createSeed();const r=d.documents.find(x=>x.committeeId===committee)!;r.status='In Debate';d.votes=d.votes.filter(v=>v.resolutionId!==r.id);snapshotBallot(d,committee,r.id,'2026-11-05T09:00:00.000Z');return {d,r};};
const presentVoter=(d:ConferenceData,r:{id:string})=>d.ballots!.find(b=>b.resolutionId===r.id&&b.status==='Present')!;
// The declaration is bound to the ballot revision the Chair opened it on; by default that is the current one.
const close=(d:ConferenceData,id:string,outcome:'Passed'|'Failed'|'Withdrawn'|undefined,method?:string,ballotRevision:number|null=d.documents.find(x=>x.id===id)?.revision??0)=>
 applyCommand(d,{type:'document',id,status:'Closed',outcome,method,...(method&&ballotRevision!==null?{ballotRevision}:{})} as Command,'chair',meta());

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
 const voter=presentVoter(d,r);
 d.votes.push({id:'v-early',delegateId:voter.delegateId,committeeId:'ga1',resolutionId:r.id,choice:'Against',createdAt:'2026-11-05'});
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
 assert.throws(()=>applyCommand(after,{type:'document',id:r.id,status:'Closed',outcome:'Failed',method:'observed',ballotRevision:closed.revision??0},'chair',meta()),/./,'Closed is final');
});

test('client: an observed close needs at least one eligible delegation in the ballot snapshot; ballots stay optional',()=>{
 // Reproduced before the fix: with nobody present, an observed Passed was accepted.
 let {d,r}=inDebate();
 d.ballots=d.ballots!.filter(b=>b.resolutionId!==r.id);
 assert.match(observedContextProblem(d,r.id)!,/No delegation is present/,'the ballot is not open');
 assert.throws(()=>close(d,r.id,'Passed','observed'),/No delegation is present/);
 ({d,r}=inDebate());
 for(const b of d.ballots!)if(b.resolutionId===r.id)b.status='Absent';
 assert.throws(()=>close(d,r.id,'Failed','observed'),/No delegation is present/,'everyone Absent');
 d.ballots!.find(b=>b.resolutionId===r.id)!.status='Present';
 assert.equal(close(d,r.id,'Passed','observed').documents.find(x=>x.id===r.id)!.outcomeMethod,'observed','one delegation eligible, no ballots: allowed');
});

test('history: an observed result names the declaring Chair and time; earlier ballots are kept, not counted',()=>{
 const {d,r}=inDebate();
 assert.equal(observedDeclaration(d,r.id),null,'an open vote has no declaration');
 const voter=presentVoter(d,r);
 d.votes.push({id:'v-early',delegateId:voter.delegateId,committeeId:'ga1',resolutionId:r.id,choice:'For',createdAt:'2026-11-05'});
 const named=applyCommand(d,{type:'document',id:r.id,status:'Closed',outcome:'Failed',method:'observed',ballotRevision:r.revision??0},'chair',{...meta(),actorId:'chair-demo'});
 assert.deepEqual(observedDeclaration(named,r.id),{by:'Alex Morgan',at:'2026-11-05T10:00:00.000Z',keptBallots:1});
 assert.deepEqual(observedDeclaration(close(d,r.id,'Failed','observed'),r.id),{by:'the committee Chair',at:'2026-11-05T10:00:00.000Z',keptBallots:1},'an unresolved Chair is not invented');
 const counted=inDebate();
 for(const a of counted.d.ballots!.filter(b=>b.resolutionId===counted.r.id&&b.status!=='Absent'))counted.d.votes.push({id:`v-${a.delegateId}`,delegateId:a.delegateId,committeeId:'ga1',resolutionId:counted.r.id,choice:'For',createdAt:'2026-11-05'});
 assert.equal(observedDeclaration(close(counted.d,counted.r.id,'Passed'),counted.r.id),null,'a counted result is not a declaration');
});

test('Voting console: Clear majority needs an open ballot with at least one eligible delegation',async t=>{
 const ok=await render(t,inDebate().d,'chair/voting');
 assert.match(ok,/<button>Clear majority For<\/button><button>Clear majority Against<\/button>/,'enabled once the ballot is open');
 assert.match(text(ok),/Obvious result\?/);
 // The ballot is not open yet: both Clear majority actions are disabled, like Close voting, and the Chair is told how to open it.
 const closed=inDebate();closed.d.ballots=[];
 const raw=await render(t,closed.d,'chair/voting');
 assert.match(raw,/<button disabled="">Clear majority For<\/button><button disabled="">Clear majority Against<\/button>/);
 assert.match(text(raw),/Choose Normal vote or Divide the House to open the ballot/);
 assert.doesNotMatch(raw,/Confirm clear majority/);
 // Nobody eligible in the snapshot.
 const absent=inDebate();for(const b of absent.d.ballots!)b.status='Absent';
 const none=await render(t,absent.d,'chair/voting');
 assert.match(none,/<button disabled="">Clear majority For<\/button>/);
 assert.match(text(none),/No delegation is present in this ballot/);
});

test('History: Documents and the Executive overview name the declaring Chair and time',async t=>{
 const {d,r}=inDebate();
 const voter=presentVoter(d,r);
 d.votes.push({id:'v-early',delegateId:voter.delegateId,committeeId:'ga1',resolutionId:r.id,choice:'Against',createdAt:'2026-11-05'});
 const closed=applyCommand(d,{type:'document',id:r.id,status:'Closed',outcome:'Passed',method:'observed',ballotRevision:r.revision??0},'chair',{...meta(),actorId:'chair-demo'});
 const docs=text(await render(t,closed,'chair/documents'));
 assert.match(docs,/Clear majority declared by Alex Morgan · 5 Nov 2026, 13:00 Qatar time\. No country votes or totals recorded; 1 earlier ballot kept, not counted\./);
 const executive=text(await render(t,closed,'admin/resolution-status','admin'));
 assert.match(executive,/Clear majority declared by Alex Morgan · 5 Nov 2026, 13:00 Qatar time\. No country votes or totals recorded/);
});

// ---- The declaration is bound to the ballot it was opened on (Codex review P2) -----------------------------------
// Drives the real VotingConsole handlers (hook state persisted across renders, as staff-health.test.ts does) over a
// real DurableRepository, so the Clear majority prompt, the restart button and the Confirm button are the shipped ones.
type El=React.ReactElement<{children?:React.ReactNode;onClick?:()=>unknown;disabled?:boolean;role?:string}>;
const elements=(n:React.ReactNode):El[]=>Array.isArray(n)?n.flatMap(elements):React.isValidElement(n)?[n as El,...elements((n as El).props.children)]:[];
const labelOf=(n:React.ReactNode):string=>Array.isArray(n)?n.map(labelOf).join(''):React.isValidElement(n)?labelOf((n as El).props.children):typeof n==='string'||typeof n==='number'?String(n):'';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
// A refused save throws inside the IndexedDB transaction, which aborts it and surfaces an unrelated AbortError; the
// refusal is what these tests are about, so the checkpoint lives in memory (same read/update contract).
class MemoryStore extends DurableStore{
 private rows=new Map<string,Checkpoint>();
 async read(key:string){return this.rows.get(key);}
 async update(key:string,change:(old?:Checkpoint)=>Checkpoint){const next=change(this.rows.get(key));this.rows.set(key,next);return next;}
 async close(){}
}
type Console={view:()=>El[];button:(label:string)=>El|undefined;click:(label:string)=>Promise<unknown>;lastSave:()=>Promise<unknown>};
function consoles(t:test.TestContext){
 let active:{states:unknown[];cursor:number;ctx:unknown}|undefined;
 t.mock.method(React,'useState',((initial:unknown)=>{
  const h=active!,i=h.cursor++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;
  return[h.states[i],(next:unknown)=>{h.states[i]=typeof next==='function'?next(h.states[i]):next;}];
 }) as typeof React.useState);
 t.mock.method(React,'useContext',(()=>active!.ctx) as typeof React.useContext);
 const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true,addEventListener(){},removeEventListener(){}}});
 t.after(()=>{if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else Reflect.deleteProperty(globalThis,'window');});
 return (repo:DurableRepository):Console=>{
  const h={states:[] as unknown[],cursor:0,ctx:undefined as unknown};
  // The provider's act(): true when the save was accepted, false when it was refused.
  // Handlers such as the restart button do not await act(), so the harness waits for every save it started.
  const saves:Promise<unknown>[]=[];
  const act=(c:Command,role:Role)=>{const save=repo.execute(c,role).then(()=>true,()=>false);saves.push(save);return save;};
  const view=()=>{active=h;h.cursor=0;h.ctx={data:repo.getSnapshot()!,act};return elements(VotingConsole({committeeId:'ga1'}));};
  const button=(label:string)=>view().find(e=>e.type==='button'&&labelOf(e.props.children)===label);
  return {view,button,lastSave:()=>saves[saves.length-1],click:async label=>{const b=button(label);assert.ok(b,`no "${label}" button`);assert.equal(b.props.disabled??false,false,`"${label}" is disabled`);const result=await b.props.onClick!();await Promise.all(saves);await tick();return result;}};
 };
}
const alertText=(c:Console)=>c.view().filter(e=>e.props.role==='alert'||e.props.role==='alertdialog').map(e=>labelOf(e.props.children)).join(' | ');
const openBallot=()=>inDebate().d;
const castOne=async(repo:DurableRepository)=>{const d=repo.getSnapshot()!;const a=d.ballots!.find(b=>b.resolutionId==='r1'&&b.status==='Present')!;
 await repo.execute({type:'vote',committeeId:'ga1',resolutionId:'r1',delegateId:a.delegateId,choice:'For'},'chair');};
const resolution=(d:ConferenceData|null)=>d!.documents.find(x=>x.id==='r1')!;

test('Voting console: restarting the ballot on this Chair device withdraws an open Clear majority; a fresh declaration still works',async t=>{
 const mount=consoles(t),key='cm-local-'+crypto.randomUUID(),store=new MemoryStore(key);
 const repo=new DurableRepository(key,openBallot,store);await repo.ready();
 try{
  const chair=mount(repo);
  await castOne(repo);
  await chair.click('Clear majority For');
  assert.ok(chair.button('Confirm Passed'),'the prompt is open');
  const staleConfirm=chair.button('Confirm Passed')!;
  const openedRevision=resolution(repo.getSnapshot()).revision??0;
  // Reproduced before the fix: restarting a normal ballot in the same session left Confirm Passed usable, and Confirm
  // captured the new revision, so the old declaration closed the new ballot.
  await chair.click('Normal vote');
  assert.equal(resolution(repo.getSnapshot()).revision,openedRevision+1,'the restart bumped the ballot revision');
  assert.equal(repo.getSnapshot()!.votes.filter(v=>v.resolutionId==='r1').length,0,'the fresh ballot has no choices');
  assert.equal(chair.button('Confirm Passed'),undefined,'Confirm is withdrawn');
  assert.match(alertText(chair),/restarted or changed since Clear majority was opened\. Choose Clear majority again\. Nothing was closed/);
  // The handler the Chair saw before the restart (a click already in flight) is refused by the command layer too.
  await staleConfirm.props.onClick!();
  assert.equal(await chair.lastSave(),false,'the stale confirmation is rejected');
  const open=resolution(repo.getSnapshot());
  assert.deepEqual([open.status,open.outcome,open.outcomeMethod],['In Debate',undefined,undefined],'nothing was closed');
  // The command layer refuses it on its own, whatever the UI does.
  await assert.rejects(()=>repo.execute({type:'document',id:'r1',status:'Closed',outcome:'Passed',method:'observed',ballotRevision:openedRevision},'chair'),/restarted or changed/);
  await assert.rejects(()=>repo.execute({type:'document',id:'r1',status:'Closed',outcome:'Passed',method:'observed'},'chair'),/restarted or changed/,'no revision at all');
  // A fresh declaration after the restart works.
  await chair.click('Dismiss');
  assert.equal(alertText(chair),'');
  await chair.click('Clear majority For');
  await chair.click('Confirm Passed');
  const closed=resolution(repo.getSnapshot());
  assert.deepEqual([closed.status,closed.outcome,closed.outcomeMethod],['Closed','Passed','observed']);
 }finally{repo.dispose();await store.close();}
});

test('Voting console: a second Chair device restarting the ballot invalidates the open declaration',async t=>{
 const mount=consoles(t);
 const server={data:openBallot()};
 const sent:string[]=[];
 // Mirrors the server contract: apply_conference_mutation refuses a stale expected revision as PT409.
 const transport=(actorId:string):Transport=>({actorId,read:async()=>structuredClone(server.data),send:async(m:Mutation)=>{
  const doc=server.data.documents.find(x=>x.id==='r1')!;
  if((m.command.type==='document'||m.command.type==='voteMode')&&m.expected!==String(doc.revision??0))throw new ConflictError('PT409: Another Chair changed this item. Review before applying.');
  server.data=applyCommand(server.data,m.command,m.role,m);sent.push(`${actorId}:${m.command.type}`);
 }});
 const keyA='cm-a-'+crypto.randomUUID(),keyB='cm-b-'+crypto.randomUUID(),storeA=new MemoryStore(keyA),storeB=new MemoryStore(keyB);
 const repoA=new DurableRepository(keyA,()=>structuredClone(server.data),storeA,transport('chair-a'));
 const repoB=new DurableRepository(keyB,()=>structuredClone(server.data),storeB,transport('chair-b'));
 await repoA.ready();await repoB.ready();await tick();
 try{
  const chairA=mount(repoA),chairB=mount(repoB);
  await repoA.flush();await repoB.flush();
  await chairA.click('Clear majority Against');
  assert.ok(chairA.button('Confirm Failed'),'Chair A has the prompt open');
  const staleConfirm=chairA.button('Confirm Failed')!;
  const opened=resolution(repoA.getSnapshot()).revision??0;

  // (1) Chair B restarts the ballot and Chair A has already synced: the prompt is withdrawn, the stale click refused locally.
  await chairB.click('Divide the House');await repoB.flush();await chairB.click('Normal vote');await repoB.flush();
  assert.equal(resolution(server.data).revision,opened+2,'two restarts on the server');
  await repoA.flush();
  assert.equal(chairA.button('Confirm Failed'),undefined,'Confirm withdrawn once Chair A sees the restart');
  assert.match(alertText(chairA),/restarted or changed since Clear majority was opened/);
  await staleConfirm.props.onClick!();
  assert.equal(await chairA.lastSave(),false,'the stale confirmation is rejected');
  assert.deepEqual(repoA.getPending(),[],'the refused declaration is not queued');
  assert.equal(resolution(server.data).status,'In Debate');

  // (2) Chair A has NOT synced Chair B's restart yet: the click is accepted locally against A's older view, queued with
  // the OPENING revision as expected, and the server refuses it as a stale write; the ballot stays open.
  await chairA.click('Dismiss');
  await chairA.click('Clear majority For');
  const openedStale=resolution(repoA.getSnapshot()).revision??0;
  await chairB.click('Normal vote');await repoB.flush();
  assert.equal(resolution(server.data).revision,openedStale+1);
  assert.ok(chairA.button('Confirm Passed'),'Chair A has not seen the restart yet');
  await chairA.click('Confirm Passed');
  assert.equal(repoA.getPending()[0].expected,String(openedStale),'sent against the opening revision, not the current one');
  await repoA.flush();
  assert.equal(repoA.getPending()[0].state,'conflict','the server refused it as a stale write');
  assert.ok(!sent.includes('chair-a:document'));
  assert.deepEqual([resolution(server.data).status,resolution(server.data).outcome],['In Debate',undefined],'the new ballot was not closed');

  // (3) After recovering (dismissing the conflict and syncing), a fresh declaration on the new ballot works.
  await repoA.resolveConflict(repoA.getPending()[0].id);await repoA.flush();
  await chairA.click('Clear majority For');
  await chairA.click('Confirm Passed');await repoA.flush();
  const closed=resolution(server.data);
  assert.deepEqual([closed.status,closed.outcome,closed.outcomeMethod],['Closed','Passed','observed']);
 }finally{repoA.dispose();repoB.dispose();await storeA.close();await storeB.close();}
});

test('real PostgreSQL: observed close parity, refusals, stale revisions and committee scope',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const chair='74000000-0000-4000-8000-000000000001',whoChair='74000000-0000-4000-8000-000000000002';
 try{
  await grant(chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);
  const revision=async()=>{await asOwner();return String((await query<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution]))[0].revision);};
  // An observed close carries the ballot revision the Chair opened it on; by default the current one.
  const send=async(user:string,c:unknown,expected?:string)=>{const value=expected??await revision();const cmd=c as {method?:string;ballotRevision?:number};if(cmd.method==='observed'&&!('ballotRevision' in cmd))c={...cmd,ballotRevision:Number(value)};await as(user);return db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(c),'chair',value,'2026-11-05T10:00:00Z']);};
  const reset=async(set:string)=>{await asOwner();await db.query(`update public.documents set status='In Debate',outcome=null,"outcomeMethod"='counted',"declaredBy"=null,"declaredByName"=null,"declaredAt"=null,"voteMode"='normal',"voteType"='substantive' where id=$1`,[ids.resolution]);await db.query(`update public.committees set voting_rule=null,"vetoEnabled"=false where id=$1`,[ids.ga1]);if(set)await db.query(set,[ids.resolution,ids.ga1]);};
  const observed=(outcome:string,method='observed')=>({type:'document',id:ids.resolution,status:'Closed',outcome,method});
  // The ballot snapshot (section 6) from the seeded roll call, as voteMode would take it.
  const openBallot=async()=>{await asOwner();await db.query('select private.open_ballot($1,$2,$3)',[ids.conference,ids.ga1,ids.resolution]);};
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
  // The declaration is bound to the ballot revision it was opened on. Restarting the ballot, from this Chair device
  // or another, bumps documents.revision. Reproduced before the fix: the confirm captured the CURRENT revision, so a
  // declaration opened before a restart closed the new ballot.
  await reset('');
  const opened=Number(await revision());
  await send(chair,{type:'voteMode',committeeId:ids.ga1,resolutionId:ids.resolution,mode:'normal',voteType:'substantive'});
  assert.equal(Number(await revision()),opened+1,'a restart bumps the revision');
  await assert.rejects(()=>send(chair,observed('Passed'),String(opened)),/changed|another chair/i,'stale expected revision');
  await assert.rejects(()=>send(chair,{...observed('Passed'),ballotRevision:opened}),/restarted or changed/,'stale ballotRevision with a fresh expected revision');
  await assert.rejects(()=>send(chair,{...observed('Passed'),ballotRevision:undefined}),/restarted or changed/,'a missing ballotRevision');
  await assert.rejects(()=>send(chair,{...observed('Passed'),ballotRevision:'x1'}),/restarted or changed/,'a malformed ballotRevision');
  assert.deepEqual([(await row()).status,(await row()).outcome],['In Debate',null],'nothing was closed');
  await send(chair,observed('Passed'));
  assert.deepEqual([(await row()).status,(await row()).outcome,(await row()).outcomeMethod],['Closed','Passed','observed'],'a fresh declaration after the restart works');
  await reset('');

  // The ballot must be open with someone eligible: before any snapshot, nobody is.
  await asOwner();await db.query('delete from public.ballot_eligibility where resolution_id=$1',[ids.resolution]);
  await assert.rejects(()=>send(chair,observed('Passed')),/No delegation is present/,'the ballot is not open');
  await openBallot();

  // One ballot already recorded: kept, not counted, not required. The declaring Chair's staff name is recorded.
  await asOwner();
  await db.query(`update public.staff set auth_user_id=$1 where name='Alex Morgan' and conference_id=$2`,[chair,ids.conference]);
  const voter=(await query<{delegateId:string}>(`select delegate_id "delegateId" from public.ballot_eligibility where resolution_id=$1 and status='Present' limit 1`,[ids.resolution]))[0].delegateId;
  await db.query('delete from public.votes where "resolutionId"=$1',[ids.resolution]);
  await db.query(`insert into public.votes(conference_id,committee_id,"delegateId","sessionId","resolutionId",choice) values($1,$2,$3,null,$4,'Against')`,[ids.conference,ids.ga1,voter,ids.resolution]);
  await send(chair,observed('Passed'));
  const closed=await row();
  assert.deepEqual([closed.status,closed.outcome,closed.outcomeMethod,closed.declaredBy,closed.declaredByName],['Closed','Passed','observed',chair,'Alex Morgan']);
  assert.equal(closed.declaredAt?.toISOString(),'2026-11-05T10:00:00.000Z');
  assert.deepEqual((await query<{choice:string}>('select choice from public.votes where "resolutionId"=$1',[ids.resolution])).map(v=>v.choice),['Against'],'ballots untouched');
  await as(chair);
  const snap=(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const projected=snap.documents.find(r=>r.id===ids.resolution)!;
  assert.deepEqual([projected.outcomeMethod,projected.declaredByName],['observed','Alex Morgan'],'the snapshot carries the method and the declaring Chair');
  const declaration=observedDeclaration(snap,ids.resolution)!;
  // The server formats the instant with its own offset: compare instants, not strings (the suite runs under any TZ).
  assert.deepEqual([declaration.by,declaration.keptBallots],['Alex Morgan',1]);
  assert.equal(Date.parse(declaration.at),Date.parse('2026-11-05T10:00:00Z'),'history reads the server projection');

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

  // Eligibility floor, from the ballot snapshot. Reproduced before the fix: both closes were accepted with nobody present.
  await reset('');
  await asOwner();
  await db.query('delete from public.votes where "resolutionId"=$1',[ids.resolution]);
  await db.query(`update public.ballot_eligibility set status='Absent' where resolution_id=$1`,[ids.resolution]);
  await assert.rejects(()=>send(chair,observed('Passed')),/No delegation is present/,'everyone Absent');
  await asOwner();
  await db.query(`update public.ballot_eligibility set status='Present' where resolution_id=$1 and delegate_id=$2`,[ids.resolution,voter]);
  await send(chair,observed('Failed'));
  assert.deepEqual([(await row()).outcome,(await row()).outcomeMethod],['Failed','observed'],'one delegation eligible, no ballots: allowed');
  await reset('');
  await asOwner();
  await db.query('delete from public.ballot_eligibility where resolution_id=$1',[ids.resolution]);
  await assert.rejects(()=>send(chair,observed('Passed')),/No delegation is present/,'no ballot snapshot at all');

  await asOwner();
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed' where id=$1`,[ids.resolution]),/documents_observed_declared/,'an observed outcome always names who declared it');
  // Reproduced before the fix: a NULL outcome made the CHECK unknown, which a CHECK accepts.
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed',"declaredBy"=$2,"declaredAt"=now(),outcome=null where id=$1`,[ids.resolution,chair]),/documents_observed_declared/,'observed with a NULL outcome');
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed',"declaredBy"=$2,"declaredAt"=now(),status='Closed',outcome='Withdrawn' where id=$1`,[ids.resolution,chair]),/documents_observed_declared/,'observed Withdrawn');
  await db.query(`update public.documents set "outcomeMethod"='observed',"declaredBy"=$2,"declaredAt"=now(),status='Closed',outcome='Passed' where id=$1`,[ids.resolution,chair]);
 }finally{await db.close();}
});
