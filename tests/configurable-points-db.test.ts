import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Command} from '../lib/commands';
import type {ConferenceData} from '../lib/domain';
import {applyCommand} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {mainSubmitterPoints,scoringValues} from '../lib/scoring';
import {speechScoreCommand,SUBMITTER_POINTS_CHANGED} from '../lib/procedure/commands';
import {ConflictError,DurableRepository,fingerprint,type Transport} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';
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
   const data=await snap(),s=data.speeches!.find(s=>s.state!=='finished')!;
   await send(speechScoreCommand(data,ids.ga1,s,2));
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

// An offline device scores a Main Submitter speech with the credit it has cached; an Executive changes the credit
// before the action reaches the server. The queued action must stay a visible conflict: never repriced, never lost.
test('real PostgreSQL: a queued Main Submitter score is refused as a retained conflict when the credit changed',async()=>{
 const {db,ids,as,asOwner,grant,query}=await freshDatabase();
 const actor='72000000-0000-4000-8000-000000000002';
 const store=new DurableStore('submitter-offline-'+crypto.randomUUID());let repo:DurableRepository|undefined;
 try{
  await grant(actor,'chair',ids.ga1);await grant(actor,'admin');
  await asOwner();await query('delete from public.scoring_definitions where conference_id=$1',[ids.conference]);await as(actor);
  const snap=async()=>(await query<{s:ConferenceData}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  const call=(id:string,c:Command,role:string,expected:string|null)=>db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify(c),role,expected,'2026-11-05T09:00:00Z']);
  const send=async(c:Command,role='chair')=>{await call(crypto.randomUUID(),c,role,fingerprint(await snap(),c));};
  const credits=async(resolutionId=ids.resolution)=>(await snap()).events.filter(e=>e.categoryId==='submitter'&&e.resolutionId===resolutionId).map(e=>e.points);
  const settle=()=>new Promise(r=>setTimeout(r,20));
  // Explicit sync attempts until the outbox reaches the expected state (an attempt already in flight is skipped).
  const syncUntil=async(done:()=>boolean)=>{for(let i=0;i<200&&!done();i++){await repo!.flush();if(!done())await settle();}assert.ok(done(),'outbox did not settle');};
  await send({type:'currentSession',committeeId:ids.ga1,sessionId:ids.session});
  // An earlier credit at the old +5, recorded before the change.
  await send({type:'participation',delegateId:JAPAN,categoryId:'submitter',points:5,sessionId:ids.session,resolutionId:GA1_02});
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
  const cached=await snap(),speech=cached.speeches!.find(s=>s.state!=='finished')!;

  // The device goes offline with that snapshot and scores the speech: it awards +5 locally and the action says so.
  let online=false;
  const transport:Transport={actorId:actor,read:async()=>{if(!online)throw Error('Offline');return snap();},send:async m=>{
   if(!online)throw Error('Offline');
   // As SupabaseTransport: stale writes (PT409) and invalid actions (22/23) are retained conflicts.
   try{await call(m.id,m.command,m.role,m.expected);}catch(e){const code=(e as {code:string}).code;if(code==='PT409'||/^(22|23)/.test(code))throw new ConflictError((e as Error).message);throw e;}
  }};
  repo=new DurableRepository('submitter-offline',()=>cached,store,transport);await repo.ready();await settle();
  const command=speechScoreCommand(repo.getSnapshot()!,ids.ga1,speech,2);
  assert.equal('submitterPoints' in command&&command.submitterPoints,5,'the action carries the credit the device awarded');
  await repo.execute(command,'chair');await settle();
  assert.deepEqual(repo.getSnapshot()!.events.filter(e=>e.categoryId==='submitter'&&e.resolutionId===ids.resolution).map(e=>e.points),[5]);
  const queued=repo.getPending()[0];

  // Meanwhile an Executive changes the Main Submitter credit to +7.
  await send({type:'scoring',id:'submitter',values:[7]},'admin');
  online=true;await syncUntil(()=>repo!.getPending()[0]?.state==='conflict');
  assert.equal(repo.getPending().length,1,'the saved action is retained');
  assert.equal(repo.getPending()[0].id,queued.id);
  assert.equal(repo.getPending()[0].state,'conflict');
  assert.equal(repo.getPending()[0].message,SUBMITTER_POINTS_CHANGED);
  assert.equal(repo.getHealth().state,'conflict');assert.equal(repo.getHealth().conflicts,1);
  assert.deepEqual(await credits(),[],'not repriced to +7');
  assert.equal((await snap()).events.filter(e=>e.speechId===speech.id).length,0,'the speech score is not recorded without its credit');
  // Replaying the original action (same id, command and fingerprint) is refused the same way and leaves no receipt.
  await assert.rejects(()=>call(queued.id,queued.command,queued.role,queued.expected),(e:unknown)=>{assert.equal((e as {code:string}).code,'PT409');assert.match((e as Error).message,/Main Submitter points changed/);return true;});
  // An action saved before the credit was configurable carries no value; it awarded +5, so it is refused too.
  await assert.rejects(()=>send({type:'speechScore',sessionId:ids.session,speechId:speech.id,points:2}),/Main Submitter points changed/);
  await asOwner();
  assert.equal((await query('select id from private.mutation_receipts where id=$1',[queued.id])).length,0);
  await as(actor);
  // Client parity: the same rule refuses the queued action against the current conference.
  const current=await snap();
  assert.throws(()=>applyCommand(current,queued.command,'chair'),{message:SUBMITTER_POINTS_CHANGED});
  assert.throws(()=>applyCommand(current,{type:'speechScore',sessionId:ids.session,speechId:speech.id,points:2},'chair'),{message:SUBMITTER_POINTS_CHANGED},'legacy action on the client');

  // Undoing the earlier +5 credit still works after the change, and keeps its points.
  const old=(await snap()).events.find(e=>e.categoryId==='submitter'&&e.resolutionId===GA1_02)!;
  await send({type:'event',id:old.id,undo:true});
  const undone=(await snap()).events.find(e=>e.id===old.id)!;
  assert.ok(undone.voidedAt);assert.equal(undone.points,5);

  // After review the Chair dismisses the conflict and scores again with the current value: +7, exactly once.
  await repo.resolveConflict(queued.id);await syncUntil(()=>mainSubmitterPoints(repo!.getSnapshot()!,ids.ga1)===7);
  assert.equal(mainSubmitterPoints(repo.getSnapshot()!,ids.ga1),7,'the device now sees the current credit');
  const retry=speechScoreCommand(repo.getSnapshot()!,ids.ga1,speech,2);
  assert.equal('submitterPoints' in retry&&retry.submitterPoints,7);
  await repo.execute(retry,'chair');await syncUntil(()=>repo!.getPending().length===0);
  assert.equal(repo.getPending().length,0);
  assert.deepEqual(await credits(),[7]);
  await send({type:'speechFinish',sessionId:ids.session,speechId:speech.id});
  // A later Main Submitter speech on the same resolution is due no credit, so a stale carried value is not consulted.
  await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:ids.resolution,classification:'Main Submitter'});
  const again=(await snap()).speeches!.find(s=>s.state!=='finished')!;
  await send({type:'speechScore',sessionId:ids.session,speechId:again.id,points:1,submitterPoints:5});
  assert.deepEqual(await credits(),[7],'still exactly once per resolution');
 }finally{repo?.dispose();await store.close();await db.close();}
});

test('client: a Main Submitter score carries its credit and is refused if the setting changed',()=>{
 const run=(d:ConferenceData,c:Command,role:'chair'|'admin'='chair')=>applyCommand(d,c,role,{id:crypto.randomUUID(),createdAt:'2026-11-05T09:00:00Z',actorId:'chair-1'});
 let d=createSeed();d.scoring=[];d.events=[];
 d=run(d,{type:'speechStart',sessionId:'s1',delegateId:'d0',resolutionId:'r1',classification:'Main Submitter'});
 const s=d.speeches!.at(-1)!;
 assert.deepEqual(speechScoreCommand(d,'ga1',s,2),{type:'speechScore',sessionId:'s1',speechId:s.id,points:2,submitterPoints:5});
 // Legacy actions (no value) awarded +5: accepted while the credit is +5.
 assert.deepEqual(run(d,{type:'speechScore',sessionId:'s1',speechId:s.id,points:2}).events.filter(e=>e.categoryId==='submitter').map(e=>e.points),[5]);
 const changed=run(d,{type:'scoring',id:'submitter',values:[7],committeeId:'ga1'},'admin');
 for(const c of [speechScoreCommand(d,'ga1',s,2),{type:'speechScore',sessionId:'s1',speechId:s.id,points:2} as Command])assert.throws(()=>run(changed,c),{message:SUBMITTER_POINTS_CHANGED});
 assert.deepEqual(run(changed,speechScoreCommand(changed,'ga1',s,2)).events.filter(e=>e.categoryId==='submitter').map(e=>e.points),[7]);
 // Other speeches carry no credit.
 const other=run(run(changed,{type:'speechFinish',sessionId:'s1',speechId:s.id}),{type:'speechStart',sessionId:'s1',delegateId:'d1',resolutionId:'r1',classification:'For'});
 assert.equal('submitterPoints' in speechScoreCommand(other,'ga1',other.speeches!.at(-1)!,2),false);
});
