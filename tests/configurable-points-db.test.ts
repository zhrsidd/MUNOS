import test from 'node:test';
import assert from 'node:assert/strict';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {applyCommand} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {mainSubmitterPoints,scoringValues} from '../lib/scoring';
import {fingerprint} from '../lib/sync/repository';
import {freshDatabase} from './helpers/database';

// Configurable Main Submitter and Debated amendment points (20261021090000_configurable_points), server side.
const GA1_02='548c2e6f-84b8-4116-a2f1-ccfa8f1d5d27',JAPAN='7d2ff710-9274-4d96-adc8-d2b7802f2e2d';

test('real PostgreSQL: Main Submitter and Debated amendment points are configurable; credits keep their points',async()=>{
 const {db,ids,as,asOwner,grant,query}=await freshDatabase();
 const actor='72000000-0000-4000-8000-000000000001';
 try{
  await grant(actor,'chair',ids.ga1);await grant(actor,'admin');
  await asOwner();await query('delete from public.scoring_definitions where conference_id=$1',[ids.conference]);await as(actor);
  const snap=async()=>(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const send=async(c:Command,role='chair')=>{const data=await snap();await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(c),role,fingerprint(data,c),'2026-11-05T09:00:00Z']);};
  const credits=async(resolutionId:string)=>(await snap()).events.filter(e=>e.categoryId==='submitter'&&e.resolutionId===resolutionId).map(e=>e.points);
  await send({type:'currentSession',committeeId:ids.ga1,sessionId:ids.session});

  // Validation: one whole number from 1 to 20, conference-wide or as a committee override.
  for(const values of [[],[0],[21],[4,6]])await assert.rejects(()=>send({type:'scoring',id:'submitter',values},'admin'),/one whole number from 1 to 20/,`submitter ${values}`);
  await send({type:'scoring',id:'submitter',values:[7]},'admin');
  await send({type:'scoring',id:'submitter',values:[9],committeeId:ids.ga1},'admin');
  // Debated amendment can be established on a blank conference, like Speech and POI.
  await send({type:'scoring',id:'amendment',values:[2,4]},'admin');
  await asOwner();
  assert.deepEqual((await query<{code:string;label:string;values:number[];committee_id:string|null}>("select code,label,values,committee_id from public.scoring_definitions where conference_id=$1 and code in ('submitter','amendment') order by code,committee_id nulls first",[ids.conference])).map(r=>[r.code,r.label,r.values,r.committee_id]),
   [['amendment','Debated amendment',[2,4],null],['submitter','Main Submitter',[7],null],['submitter','Main Submitter',[9],ids.ga1]]);
  await as(actor);
  const data=await snap();
  assert.equal(mainSubmitterPoints(data,ids.ga1),9,'the client reads the same committee value');
  assert.deepEqual(scoringValues(data,ids.ga1,'amendment'),[2,4]);

  // The automatic credit on the Main Submitter's first scored speech uses the committee value, once.
  for(let i=0;i<2;i++){
   await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
   const s=(await snap()).speeches!.find(s=>s.state!=='finished')!;
   await send({type:'speechScore',sessionId:ids.session,speechId:s.id,points:2});
   await send({type:'speechFinish',sessionId:ids.session,speechId:s.id});
  }
  assert.deepEqual(await credits(ids.resolution),[9]);

  // A later change applies to new credits only; the stored credit keeps its points.
  await send({type:'scoring',id:'submitter',values:[6],committeeId:ids.ga1},'admin');
  assert.deepEqual(await credits(ids.resolution),[9]);
  const manual=(points:number,categoryId='submitter',resolutionId=GA1_02,delegateId=JAPAN)=>send({type:'participation',delegateId,categoryId,points,sessionId:ids.session,resolutionId});
  await assert.rejects(()=>manual(9),/Invalid scoring value/,'a manual credit uses the current value');
  await manual(6);
  await assert.rejects(()=>manual(6),/already recorded/,'still once per resolution');
  assert.deepEqual(await credits(GA1_02),[6]);

  // Debated amendment points follow the configured values; awarding stays manual.
  await assert.rejects(()=>manual(3,'amendment',ids.resolution,ids.france),/Invalid scoring value/);
  await manual(4,'amendment',ids.resolution,ids.france);
  assert.deepEqual((await snap()).events.filter(e=>e.categoryId==='amendment').map(e=>e.points),[4]);
 }finally{await db.close();}
});

test('client: Main Submitter and Debated amendment configuration mirrors the server rules',()=>{
 let d=createSeed();d.scoring=[];
 for(const values of [[],[0],[21],[4,6]])assert.throws(()=>applyCommand(d,{type:'scoring',id:'submitter',values},'admin'),/one whole number/);
 assert.throws(()=>applyCommand(d,{type:'scoring',id:'submitter',values:[7]},'chair'),/role boundary/);
 d=applyCommand(d,{type:'scoring',id:'submitter',values:[7]},'admin');
 d=applyCommand(d,{type:'scoring',id:'amendment',values:[2,4]},'admin');
 assert.deepEqual(d.scoring.map(s=>[s.id,s.label,s.values]),[['submitter','Main Submitter',[7]],['amendment','Debated amendment',[2,4]]]);
 assert.equal(mainSubmitterPoints(d,'ga1'),7);
 const blank=createSeed();blank.scoring=[];
 assert.equal(mainSubmitterPoints(blank,'ga1'),5,'default +5');
 assert.deepEqual(scoringValues(blank,'ga1','amendment'),[3],'default 3');
});
