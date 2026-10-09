import test from 'node:test';
import assert from 'node:assert/strict';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {fingerprint} from '../lib/sync/repository';
import {freshDatabase} from './helpers/database';

// Server parity for the usability patch, against every committed migration (real PostgreSQL via PGlite).
test('real PostgreSQL: blank-conference scoring, flags, top-of-queue, two-stage POIs and amendment context',async()=>{
 const {db,ids,as,asOwner,grant,query}=await freshDatabase();
 const actor='71000000-0000-4000-8000-000000000001';
 const brazil='490357f5-75f4-4085-a2e4-13ed2c63f34b';
 try{
  // The patch must preserve earlier in-place patches (archived-session guard from 20261007104501).
  for(const fn of ['private.apply_mutation','private.apply_procedure'])
   assert.match((await query<{d:string}>(`select pg_get_functiondef('${fn}(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure) d`))[0].d,/require_operational_session/,fn);
  await grant(actor,'chair',ids.ga1);await grant(actor,'admin');
  // A clean conference: no scoring definitions at all.
  await asOwner();await query('delete from public.scoring_definitions where conference_id=$1',[ids.conference]);await as(actor);
  const snap=async()=>(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const send=async(c:Command,role='chair',key=crypto.randomUUID(),expected?:string|null)=>{const data=await snap();await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(c),role,expected===undefined?fingerprint(data,c):expected,'2026-10-09T09:00:00Z']);};
  const events=async(speechId:string,category:string)=>(await snap()).events.filter(e=>e.speechId===speechId&&e.categoryId===category);
  const active=async()=>(await snap()).speeches!.find(s=>s.state!=='finished')!;
  await send({type:'currentSession',committeeId:ids.ga1,sessionId:ids.session});

  // 1) Scoring: built-in defaults work before setup; required categories can be established; invalid values refused.
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.japan,resolutionId:ids.resolution,classification:'Other'});
  let s=await active();
  await assert.rejects(()=>send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:4}),/configured speech value/);
  await send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:3});
  await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});
  for(const [id,values] of [['speech',[1,1]],['speech',[21]],['speech',[]],['poi',[0,1,2,3,4,5,6,7,8,9,10]]] as [string,number[]][])
   await assert.rejects(()=>send({type:'scoring',id,values},'admin'),/whole-number|only once|scoring_definitions/,`${id} ${values}`);
  for(const values of [[7],[5],[3,5]])await assert.rejects(()=>send({type:'scoring',id:'submitter',values},'admin'),/fixed at \+5/,`submitter ${values}`);
  await assert.rejects(()=>send({type:'scoring',id:'submitter',values:[7],committeeId:ids.ga1},'admin'),/fixed at \+5/,'no committee override either');
  await assert.rejects(()=>send({type:'scoring',id:'made-up',values:[1]},'admin'),/Unknown scoring category/);
  await send({type:'scoring',id:'speech',values:[2,4]},'admin');
  await send({type:'scoring',id:'speech',values:[9],committeeId:ids.ga1},'admin');
  await asOwner();
  assert.deepEqual((await query<{code:string;label:string;values:number[];committee_id:string|null}>('select code,label,values,committee_id from public.scoring_definitions where conference_id=$1 order by code,committee_id nulls first',[ids.conference])).map(r=>[r.code,r.label,r.values,r.committee_id]),
   [['speech','Speech',[2,4],null],['speech','Speech',[9],ids.ga1]]);
  await as(actor);
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
  s=await active();
  await assert.rejects(()=>send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:4}),/configured speech value/,'committee override wins');
  await send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:9});
  await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
  s=await active();await send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:9});await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});
  assert.deepEqual((await snap()).events.filter(e=>e.categoryId==='submitter'&&e.resolutionId===ids.resolution).map(e=>e.points),[5],'Main Submitter credit: fixed +5, once per resolution');

  // 2) Derived flags are stored on delegate edit and import; arbitrary text is refused.
  await send({type:'delegate',id:ids.japan,name:'Hana Tanaka',email:'delegate2@example.com',country:'Ivory Coast',flag:'🇨🇮'},'admin');
  await assert.rejects(()=>send({type:'delegate',id:ids.japan,name:'Hana Tanaka',email:'delegate2@example.com',country:'Japan',flag:'JP'},'admin'),/Invalid country flag/);
  const school=(await query<{id:string}>('select "schoolId" id from public.delegates where id=$1',[ids.france]))[0].id;
  await send({type:'import',rows:[{name:'Ali',country:'Türkiye',email:'ali@example.com',flag:'🇹🇷',committeeId:ids.ga1,schoolId:school},{name:'Bo',country:'Press Corps',email:'bo@example.com',committeeId:ids.ga1,schoolId:school}]},'admin');
  assert.deepEqual((await query<{country:string;flag:string}>("select country,flag from public.delegates where conference_id=$1 and (id=$2 or email in ('ali@example.com','bo@example.com')) order by email",[ids.conference,ids.japan])).map(r=>[r.country,r.flag]),
   [['Türkiye','🇹🇷'],['Press Corps','🌐'],['Ivory Coast','🇨🇮']]);

  // 3) Next speaker: only position 1 of the active lane.
  await send({type:'queueAdd',sessionId:ids.session,delegateId:ids.france,lane:'open'});await send({type:'queueAdd',sessionId:ids.session,delegateId:ids.japan,lane:'open'});
  const openLane=async()=>(await snap()).queue.filter(q=>q.sessionId===ids.session&&q.lane==='open').sort((a,b)=>a.position-b.position);
  let open=await openLane();assert.ok(open.length>=2);
  await assert.rejects(()=>send({type:'speechStart',sessionId:ids.session,delegateId:open[1].delegateId,resolutionId:ids.resolution,classification:'Other',entryId:open[1].id}),/Only the first speaker/);
  const second=open[1];
  await send({type:'queueOrder',sessionId:ids.session,lane:'open',ids:[open[1].id,open[0].id,...open.slice(2).map(q=>q.id)]});
  open=await openLane();assert.equal(open[0].id,second.id,'reorder changes who is next');
  await send({type:'debateMode',sessionId:ids.session,mode:'closed',phase:'against'});
  await assert.rejects(()=>send({type:'speechStart',sessionId:ids.session,delegateId:second.delegateId,resolutionId:ids.resolution,classification:'Other',entryId:open[0].id}),/Only the first speaker/,'open lane is inactive in closed debate');
  await send({type:'debateMode',sessionId:ids.session,mode:'open',phase:'against'});
  await send({type:'speechStart',sessionId:ids.session,delegateId:second.delegateId,resolutionId:ids.resolution,classification:'Other',entryId:open[0].id});
  s=await active();assert.equal(s.delegateId,second.delegateId);

  // 4) Two-stage POIs.
  await send({type:'poiAllowance',sessionId:ids.session,speechId:s.id,limit:1});
  await send({type:'poiAdd',sessionId:ids.session,speechId:s.id,delegateId:ids.france});await send({type:'poiAdd',sessionId:ids.session,speechId:s.id,delegateId:brazil});
  const [p1,p2]=(await snap()).poiQueue!.sort((a,b)=>a.position-b.position);
  await assert.rejects(()=>send({type:'poiRecognize',sessionId:ids.session,speechId:s.id,entryId:p2.id}),/Only the first POI/);
  await assert.rejects(()=>send({type:'poiScore',sessionId:ids.session,speechId:s.id,entryId:p1.id,points:2}),/Recognize this POI/);
  await send({type:'poiRecognize',sessionId:ids.session,speechId:s.id,entryId:p1.id});
  assert.equal((await events(s.id,'poi')).length,0,'recognition records no participation');
  assert.ok((await snap()).poiQueue!.find(p=>p.id===p1.id)?.recognizedAt,'active POI state is durable');
  await assert.rejects(()=>send({type:'poiRecognize',sessionId:ids.session,speechId:s.id,entryId:p2.id}),/current POI first|Only the first POI/);
  const score:Command={type:'poiScore',sessionId:ids.session,speechId:s.id,entryId:p1.id,points:2};
  const key=crypto.randomUUID(),expected=fingerprint(await snap(),score);
  await send(score,'chair',key,expected);await send(score,'chair',key,expected);
  const pois=await events(s.id,'poi');assert.equal(pois.length,1,'exactly once, also on replay');assert.equal(pois[0].delegateId,ids.france);
  await assert.rejects(()=>send(score),/Recognize this POI/,'cannot score twice');
  await assert.rejects(()=>send({type:'poiRecognize',sessionId:ids.session,speechId:s.id,entryId:p2.id}),/Set or extend POIs/,'allowance applies');
  await send({type:'poiAllowance',sessionId:ids.session,speechId:s.id,limit:2});
  // A legacy one-step action saved by an older client still records exactly once.
  await send({type:'poiRecognize',sessionId:ids.session,speechId:s.id,entryId:p2.id,points:1});
  assert.equal((await events(s.id,'poi')).length,2);
  await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});

  // 5) Amendment debate: floor must be with the Chair to start/close; context on speeches; no Main/Co-Submitter.
  await asOwner();
  const amendment='72000000-0000-4000-8000-000000000001';
  await query(`insert into public.amendments(id,conference_id,committee_id,"resolutionId","sessionId","submitterId",type,clause,wording,status) values($1,$2,$3,$4,$5,$6,'Add','Clause 3','Adds a review clause.','Accepted for Debate')`,[amendment,ids.conference,ids.ga1,ids.resolution,ids.session,brazil]);
  await as(actor);
  const amendmentExpected=async()=>String((await query<{revision:string}>('select revision from public.amendments where id=$1',[amendment]))[0].revision);
  const amend=async(status:string,outcome?:string)=>db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'amendmentStatus',id:amendment,status,...(outcome?{outcome}:{})}),'chair',await amendmentExpected(),'2026-10-09T09:00:00Z']);
  // A resolution-debate speech in its POI phase holds the floor: the amendment cannot start.
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.japan,resolutionId:ids.resolution,classification:'Other',amendmentId:null});
  s=await active();await send({type:'poiAllowance',sessionId:ids.session,speechId:s.id,limit:1});
  await assert.rejects(()=>amend('In Debate'),/return the floor to the Chair/);
  await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});
  await amend('In Debate');
  // Stale/older clients cannot start Main Submitter procedure in amendment context (with or without amendmentId).
  await assert.rejects(()=>send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter',amendmentId:amendment}),/not amendment debate/);
  await assert.rejects(()=>send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'}),/not amendment debate/);
  await assert.rejects(()=>send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'For',amendmentId:null}),/amendment debate changed/);
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'For',amendmentId:amendment});
  s=await active();assert.equal(s.amendmentId,amendment);assert.equal(s.resolutionId,ids.resolution);
  await assert.rejects(()=>send({type:'speechYield',sessionId:ids.session,speechId:s.id,delegateId:brazil}),/Only Main Submitter/);
  await send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:9});
  const event=(await snap()).events.find(e=>e.speechId===s.id)!;
  assert.equal((await snap()).speeches!.find(x=>x.id===event.speechId)?.amendmentId,amendment,'event reaches its amendment via speechId');
  // A speech/POI holds the floor: the active amendment cannot be passed, failed, withdrawn or ruled out.
  await send({type:'poiAllowance',sessionId:ids.session,speechId:s.id,limit:1});
  for(const outcome of ['Passed','Failed','Withdrawn','Ruled Out'])await assert.rejects(()=>amend('Closed',outcome),/return the floor to the Chair/,outcome);
  await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});
  await amend('Closed','Passed');
  assert.equal((await query<{status:string;outcome:string}>('select status,outcome from public.amendments where id=$1',[amendment]))[0].outcome,'Passed');
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Other',amendmentId:null});
  assert.equal((await active()).amendmentId,null,'resolution debate again');
  assert.equal((await query<{status:string}>('select status from public.documents where id=$1',[ids.resolution]))[0].status,'In Debate');
 }finally{await db.close();}
});
