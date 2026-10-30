import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,votingOutcome,vetoDelegates} from '../lib/commands';
import {createSeed} from '../lib/seed';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {fingerprint} from '../lib/sync/repository';
import {freshDatabase} from './helpers/database';

test('Chair procedure: independent queues, reorder, delivered events, one-hop yield; no session choice',()=>{
 let d=createSeed();const run=(c:Command)=>{d=applyCommand(d,c,'chair');};
 // Chairs no longer choose a session: the schedule labels records (docs/SESSION_MODEL.md section 8).
 assert.throws(()=>run({type:'currentSession',committeeId:'ga1',sessionId:'s1'}),/published schedule/);
 run({type:'speechStart',committeeId:'ga1',delegateId:'d0',resolutionId:'r1',classification:'Main Submitter'});
 let s=d.speeches![0];const queue=structuredClone(d.queue);const before=d.events.length;
 run({type:'poiAdd',committeeId:'ga1',speechId:s.id,delegateId:'d1'});
 assert.deepEqual(d.queue,queue);assert.equal(d.events.length,before);
 assert.throws(()=>run({type:'poiRecognize',committeeId:'ga1',speechId:s.id,entryId:d.poiQueue![0].id,points:2}),/allowance/);
 run({type:'poiAllowance',committeeId:'ga1',speechId:s.id,limit:1});
 run({type:'poiRecognize',committeeId:'ga1',speechId:s.id,entryId:d.poiQueue![0].id,points:2});
 assert.equal(d.events.at(-1)?.delegateId,'d1');assert.equal(d.events.at(-1)?.categoryId,'poi');
 run({type:'speechScore',committeeId:'ga1',speechId:s.id,points:3});
 assert.throws(()=>run({type:'speechScore',committeeId:'ga1',speechId:s.id,points:1}),/already/);
 assert.equal(d.events.filter(e=>e.categoryId==='submitter'&&e.resolutionId==='r1').length,1);
 run({type:'speechYield',committeeId:'ga1',speechId:s.id,delegateId:'d1'});
 s=d.speeches!.at(-1)!;assert.equal(s.classification,'Co-Submitter');assert.ok(s.yieldedFrom);
 assert.throws(()=>run({type:'speechYield',committeeId:'ga1',speechId:s.id,delegateId:'d2'}),/Only/);
 run({type:'speechFinish',committeeId:'ga1',speechId:s.id});assert.ok(d.speeches!.every(s=>s.state==='finished'));
 run({type:'debateMode',committeeId:'ga1',mode:'closed',phase:'against'});
 run({type:'queueAdd',committeeId:'ga1',delegateId:'d0',lane:'for'});run({type:'queueAdd',committeeId:'ga1',delegateId:'d1',lane:'for'});
 const ids=d.queue.filter(q=>q.lane==='for').map(q=>q.id).reverse();const audit=d.audit.length;
 run({type:'queueOrder',committeeId:'ga1',lane:'for',ids});assert.equal(d.audit.length,audit);
 assert.deepEqual(d.queue.filter(q=>q.lane==='for').sort((a,b)=>a.position-b.position).map(q=>q.id),ids);
});
for(const scenario of ['no veto','one veto','multiple vetoes','abstaining P5','non-P5 against','procedural','absent P5','disabled','SC configured'])test(`voting: ${scenario}`,()=>{
 const d=createSeed(),c=d.committees.find(c=>c.id==='sc')!,r=d.documents.find(r=>r.committeeId==='sc')!;r.status='In Debate';
 c.vetoEnabled=scenario!=='disabled';r.voteType=scenario==='procedural'?'procedural':'substantive';
 d.ballots=(d.ballots??[]).filter(b=>b.resolutionId!==r.id);
 d.votes=[];
 const members=d.delegates.filter(x=>x.committeeId==='sc');
 members.forEach((x,i)=>{
  const against=(['one veto','disabled','procedural','absent P5','SC configured'].includes(scenario)&&x.id==='d15')||(scenario==='multiple vetoes'&&['d15','d16'].includes(x.id))||(scenario==='non-P5 against'&&x.id==='d14');
  d.ballots!.push({resolutionId:r.id,delegateId:x.id,committeeId:'sc',status:scenario==='absent P5'&&x.id==='d15'?'Absent':'Present'});
  d.votes.push({id:`v${i}`,delegateId:x.id,committeeId:'sc',resolutionId:r.id,choice:against?'Against':scenario==='abstaining P5'&&x.id==='d15'?'Abstain':'For',createdAt:'2026-10-05'});
 });
 const expected=['one veto','multiple vetoes','SC configured'].includes(scenario);
 assert.equal(vetoDelegates(d,r.id).length,expected?scenario==='multiple vetoes'?2:1:0);
 assert.equal(votingOutcome(d,r.id),expected?'Failed':'Passed');
});
test('Divide the House refuses abstentions and award rubric commands are retired',()=>{
 let d=createSeed();d=applyCommand(d,{type:'voteMode',committeeId:'ga1',resolutionId:'r1',mode:'divide',voteType:'substantive'},'chair');
 assert.throws(()=>applyCommand(d,{type:'vote',committeeId:'ga1',resolutionId:'r1',delegateId:'d0',choice:'Abstain'},'chair'),/does not permit/);
 assert.throws(()=>applyCommand(d,{type:'criterion',id:'c1',name:'x',description:'x',max:5},'admin'),/retired/);
});
test('real PostgreSQL core procedure: authorization, revisions, ordering, POIs, yields, null-session submission and veto',async()=>{
 const {db,ids,as,asOwner,asServer,grant,query}=await freshDatabase();
 const actor='70000000-0000-4000-8000-000000000001',other='70000000-0000-4000-8000-000000000002';
 try{
 await grant(actor,'chair',ids.ga1);await grant(actor,'admin');await grant(other,'chair',ids.who);await as(actor);
 const snap=async()=>(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
 const send=async(c:Command,role='chair',expected?:string|null,id=crypto.randomUUID())=>{const data=await snap();await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify(c),role,expected===undefined?fingerprint(data,c):expected,'2026-10-06T00:00:00Z']);};
 // Retired: sessions follow the published schedule.
 await assert.rejects(()=>send({type:'currentSession',committeeId:ids.ga1,sessionId:ids.session},'chair','0'),/published schedule/);
 await as(other);await assert.rejects(()=>send({type:'queueAdd',committeeId:ids.ga1,delegateId:ids.france,lane:'open'}),/Access denied/);await as(actor);
 await send({type:'speechStart',committeeId:ids.ga1,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
 let s=(await snap()).speeches![0];const queue=(await snap()).queue;
 await send({type:'poiAdd',committeeId:ids.ga1,speechId:s.id,delegateId:ids.japan});
 assert.deepEqual((await snap()).queue,queue);
 await send({type:'poiAllowance',committeeId:ids.ga1,speechId:s.id,limit:1});
 const poi=(await snap()).poiQueue![0];const recognized:Command={type:'poiRecognize',committeeId:ids.ga1,speechId:s.id,entryId:poi.id,points:2};const key=crypto.randomUUID(),revision=fingerprint(await snap(),recognized);
 await send(recognized,'chair',revision,key);await send(recognized,'chair',revision,key);
 assert.equal((await snap()).events.filter(e=>e.speechId===s.id&&e.categoryId==='poi').length,1);
 await send({type:'speechScore',committeeId:ids.ga1,speechId:s.id,points:2});
 await assert.rejects(()=>send({type:'speechScore',committeeId:ids.ga1,speechId:s.id,points:3}),/duplicate key/);
 await send({type:'speechYield',committeeId:ids.ga1,speechId:s.id,delegateId:ids.japan});s=(await snap()).speeches!.find(s=>s.state!=='finished')!;
 await assert.rejects(()=>send({type:'speechYield',committeeId:ids.ga1,speechId:s.id,delegateId:ids.france}),/Only Main/);
 await send({type:'speechFinish',committeeId:ids.ga1,speechId:s.id});
 await send({type:'queueAdd',committeeId:ids.ga1,delegateId:ids.france,lane:'against'});await send({type:'queueAdd',committeeId:ids.ga1,delegateId:ids.japan,lane:'against'});
 const order=(await snap()).queue.filter(q=>q.lane==='against').sort((a,b)=>a.position-b.position).map(q=>q.id).reverse();await send({type:'queueOrder',committeeId:ids.ga1,lane:'against',ids:order});
 assert.deepEqual((await snap()).queue.filter(q=>q.lane==='against').sort((a,b)=>a.position-b.position).map(q=>q.id),order);
 await send({type:'voteMode',committeeId:ids.ga1,resolutionId:ids.resolution,mode:'divide',voteType:'substantive'});
 await assert.rejects(()=>send({type:'vote',committeeId:ids.ga1,resolutionId:ids.resolution,delegateId:ids.france,choice:'Abstain'}),/mode does not permit/);
 await send({type:'vetoRules',committeeId:ids.ga1,enabled:true,delegateIds:[ids.france]},'admin');
 // Every delegation eligible in the ballot's snapshot votes.
 for(const b of (await snap()).ballots!.filter(b=>b.resolutionId===ids.resolution&&b.status!=='Absent'))await send({type:'vote',committeeId:ids.ga1,resolutionId:ids.resolution,delegateId:b.delegateId,choice:b.delegateId===ids.france?'Against':'For'});
 await assert.rejects(()=>send({type:'document',id:ids.resolution,status:'Closed',outcome:'Passed'}),/configured voting rule/);
 await send({type:'document',id:ids.resolution,status:'Closed',outcome:'Failed'});
 assert.deepEqual((await snap()).documents.find(r=>r.id===ids.resolution)?.vetoedBy,[ids.france]);
 await asOwner();await query('insert into public.submission_links(conference_id,committee_id,token) values($1,$2,$3)',[ids.conference,ids.who,'nullable_session_token_12345']);
 const delegate=(await query<{id:string}>('select id from public.delegates where committee_id=$1 limit 1',[ids.who]))[0].id;
 await asServer();await query('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null)',['nullable_session_token_12345',crypto.randomUUID(),delegate,'No selected session', 'b'.repeat(30)]);
 await asOwner();assert.equal((await query('select "sessionId" from public.documents where title=$1',['No selected session']))[0].sessionId,null);
 }finally{await db.close();}
});
