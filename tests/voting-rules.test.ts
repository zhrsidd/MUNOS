import test from 'node:test';
import assert from 'node:assert/strict';
import {votingOutcome} from '../lib/commands';
import {createSeed} from '../lib/seed';
import type {ConferenceData} from '../lib/domain';
import {freshDatabase} from './helpers/database';

type Rule='simple_majority'|'two_thirds';
type Case={name:string;rule:Rule;for:number;against:number;abstain:number;outcome:'Passed'|'Failed'};
// Abstentions never count; a tie fails; two-thirds is inclusive (4–2 passes); a vote with no For/Against fails.
const cases:Case[]=[
 {name:'simple majority passes',rule:'simple_majority',for:3,against:2,abstain:0,outcome:'Passed'},
 {name:'simple majority tie fails',rule:'simple_majority',for:2,against:2,abstain:0,outcome:'Failed'},
 {name:'abstentions do not count towards the majority',rule:'simple_majority',for:2,against:1,abstain:5,outcome:'Passed'},
 {name:'all abstentions fail',rule:'simple_majority',for:0,against:0,abstain:3,outcome:'Failed'},
 {name:'two-thirds is inclusive',rule:'two_thirds',for:4,against:2,abstain:0,outcome:'Passed'},
 {name:'two-thirds is not met by 3–2',rule:'two_thirds',for:3,against:2,abstain:0,outcome:'Failed'},
 {name:'two-thirds ignores abstentions',rule:'two_thirds',for:2,against:1,abstain:4,outcome:'Passed'},
];
const ballots=(c:Case)=>[...Array(c.for).fill('For'),...Array(c.against).fill('Against'),...Array(c.abstain).fill('Abstain')] as ('For'|'Against'|'Abstain')[];

function clientData(c:Case,committeeRule:Rule|undefined,conferenceRule:Rule|undefined):ConferenceData{
 const d=createSeed(),r=d.documents.find(r=>r.id==='r1')!;
 d.conference.votingRule=conferenceRule;d.committees.find(x=>x.id==='ga1')!.votingRule=committeeRule;
 const members=d.delegates.filter(x=>x.committeeId==='ga1');
 d.votes=ballots(c).map((choice,i)=>({id:`v${i}`,delegateId:members[i].id,committeeId:'ga1',resolutionId:r.id,choice,createdAt:'2026-11-05'}));
 return d;
}

for(const c of cases)test(`voting rule (client): ${c.name}`,()=>{
 assert.equal(votingOutcome(clientData(c,c.rule,undefined),'r1'),c.outcome);
});

test('voting rule (client): the committee rule overrides the conference rule, which is the fallback',()=>{
 const threeTwo=cases.find(c=>c.name==='two-thirds is not met by 3–2')!;
 assert.equal(votingOutcome(clientData(threeTwo,undefined,'two_thirds'),'r1'),'Failed');
 assert.equal(votingOutcome(clientData(threeTwo,'simple_majority','two_thirds'),'r1'),'Passed');
 assert.equal(votingOutcome(clientData(threeTwo,undefined,undefined),'r1'),'Passed');
 const d=clientData(threeTwo,'simple_majority',undefined);
 d.votes.push({id:'other-session',delegateId:d.votes[0].delegateId,sessionId:'elsewhere',resolutionId:'r1',choice:'Against',createdAt:'2026-11-05'},{id:'x1',delegateId:'x',sessionId:'elsewhere',resolutionId:'r1',choice:'Against',createdAt:'2026-11-05'});
 assert.equal(votingOutcome(d,'r1'),'Passed','session-keyed ballots from before the committee rekey are history and ignored');
});

test('voting rule (PostgreSQL): closing accepts exactly the outcome the client computes',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const chair='70000000-0000-4000-8000-0000000000a1';
 try{
  await grant(chair,'chair',ids.ga1);
  const members=(await query<{id:string}>('select id from public.delegates where committee_id=$1 order by id',[ids.ga1])).map(r=>r.id);
  const close=async(outcome:string)=>{
   await asOwner();const [{revision}]=await query<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution]);
   await as(chair);
   return db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'document',id:ids.resolution,status:'Closed',outcome}),'chair',String(revision),'2026-11-05T10:00:00Z']);
  };
  const prepare=async(c:Case,committeeRule:Rule|null,conferenceRule:Rule)=>{
   await asOwner();
   await db.query('delete from public.votes where "resolutionId"=$1',[ids.resolution]);
   await db.query('delete from public.ballot_eligibility where resolution_id=$1',[ids.resolution]);
   await db.query('update public.conferences set voting_rule=$1 where id=$2',[conferenceRule,ids.conference]);
   await db.query('update public.committees set voting_rule=$1 where id=$2',[committeeRule,ids.ga1]);
   await db.query(`update public.documents set status='In Debate',outcome=null,"sessionId"=$1 where id=$2`,[ids.session,ids.resolution]);
   // The ballot's eligibility snapshot: every ballot comes from an eligible member and every eligible member votes, as closing requires.
   for(const [i,m] of members.entries())await db.query(`insert into public.ballot_eligibility(resolution_id,delegate_id,conference_id,committee_id,status) values($1,$2,$3,$4,$5)`,[ids.resolution,m,ids.conference,ids.ga1,i<ballots(c).length?'Present':'Absent']);
   for(const [i,choice] of ballots(c).entries())
    await db.query(`insert into public.votes(conference_id,committee_id,"delegateId","sessionId","resolutionId",choice) values($1,$2,$3,null,$4,$5)`,[ids.conference,ids.ga1,members[i],ids.resolution,choice]);
  };
  const check=async(label:string,c:Case,committeeRule:Rule|null,conferenceRule:Rule,expected:'Passed'|'Failed')=>{
   await prepare(c,committeeRule,conferenceRule);
   await assert.rejects(()=>close(expected==='Passed'?'Failed':'Passed'),/configured voting rule/,`${label}: the other outcome is refused`);
   await close(expected);
   await asOwner();
   assert.equal((await query<{outcome:string}>('select outcome from public.documents where id=$1',[ids.resolution]))[0].outcome,expected,label);
  };
  for(const c of cases){
   assert.equal(votingOutcome(clientData(c,c.rule,undefined),'r1'),c.outcome);
   await check(c.name,c,c.rule,'simple_majority',c.outcome);
  }
  const threeTwo=cases.find(c=>c.name==='two-thirds is not met by 3–2')!;
  await check('conference rule is the fallback',threeTwo,null,'two_thirds','Failed');
  await check('committee rule overrides the conference rule',threeTwo,'simple_majority','two_thirds','Passed');
 }finally{await db.close();}
});
