import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,observedMajorityProblem,votingOutcome} from '../lib/commands';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {createSeed} from '../lib/seed';
import {freshDatabase} from './helpers/database';

// Clear majority For / Against (20261021110000_clear_majority): a declared, observed result with no invented ballots.
const meta=()=>({id:crypto.randomUUID(),createdAt:'2026-11-05T10:00:00.000Z',actorId:'chair-1'});
const inDebate=(committee='ga1')=>{const d=createSeed();const r=d.documents.find(x=>x.committeeId===committee)!;r.status='In Debate';d.votes=d.votes.filter(v=>v.resolutionId!==r.id);return {d,r};};
const close=(d:ConferenceData,id:string,outcome:'Passed'|'Failed'|'Withdrawn'|undefined,method?:string)=>applyCommand(d,{type:'document',id,status:'Closed',outcome,method} as Command,'chair',meta());

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

test('real PostgreSQL: observed close parity, refusals, stale revisions and committee scope',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const chair='74000000-0000-4000-8000-000000000001',whoChair='74000000-0000-4000-8000-000000000002';
 try{
  await grant(chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);
  const revision=async()=>{await asOwner();return String((await query<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution]))[0].revision);};
  const send=async(user:string,c:unknown,expected?:string)=>{const value=expected??await revision();await as(user);return db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(c),'chair',value,'2026-11-05T10:00:00Z']);};
  const reset=async(set:string)=>{await asOwner();await db.query(`update public.documents set status='In Debate',outcome=null,"outcomeMethod"='counted',"declaredBy"=null,"declaredAt"=null,"voteMode"='normal',"voteType"='substantive' where id=$1`,[ids.resolution]);await db.query(`update public.committees set voting_rule=null,"vetoEnabled"=false where id=$1`,[ids.ga1]);if(set)await db.query(set,[ids.resolution,ids.ga1]);};
  const observed=(outcome:string,method='observed')=>({type:'document',id:ids.resolution,status:'Closed',outcome,method});
  const row=async()=>{await asOwner();return (await query<{status:string;outcome:string;outcomeMethod:string;declaredBy:string|null;declaredAt:Date|null}>('select status,outcome,"outcomeMethod","declaredBy","declaredAt" from public.documents where id=$1',[ids.resolution]))[0];};

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

  // One ballot already recorded: kept, not counted, not required.
  await asOwner();
  const voter=(await query<{delegateId:string}>(`select "delegateId" from public.attendance where "sessionId"=$1 and status='Present' limit 1`,[ids.session]))[0].delegateId;
  await db.query(`update public.documents set "sessionId"=$1 where id=$2`,[ids.session,ids.resolution]);
  await db.query('delete from public.votes where "resolutionId"=$1',[ids.resolution]);
  await db.query(`insert into public.votes(conference_id,committee_id,"delegateId","sessionId","resolutionId",choice) values($1,$2,$3,$4,$5,'Against')`,[ids.conference,ids.ga1,voter,ids.session,ids.resolution]);
  await send(chair,observed('Passed'));
  const closed=await row();
  assert.deepEqual([closed.status,closed.outcome,closed.outcomeMethod,closed.declaredBy],['Closed','Passed','observed',chair]);
  assert.equal(closed.declaredAt?.toISOString(),'2026-11-05T10:00:00.000Z');
  assert.deepEqual((await query<{choice:string}>('select choice from public.votes where "resolutionId"=$1',[ids.resolution])).map(v=>v.choice),['Against'],'ballots untouched');
  await as(chair);
  const snap=(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  assert.equal(snap.documents.find(r=>r.id===ids.resolution)?.outcomeMethod,'observed','the snapshot carries the method');

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
  await asOwner();
  await assert.rejects(()=>db.query(`update public.documents set "outcomeMethod"='observed' where id=$1`,[ids.resolution]),/documents_observed_declared/,'an observed outcome always names who declared it');
 }finally{await db.close();}
});
