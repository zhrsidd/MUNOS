import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

// Session model phase 3a (docs/SESSION_MODEL.md 2, 4, 12.5): every Record-class row is labelled by the server, in the same
// transaction as the record, from the schedule version in effect at the action's trusted time. Labels only: nothing is held.
const U=(n:number)=>`78000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const exec=U(1),chair=U(2);
const H=3600_000,M=60_000;
const iso=(t:number)=>new Date(t).toISOString();
const day=(t:number)=>new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Qatar'});

async function setup(){
 const f=await freshDatabase();
 const {db,ids,query,as,asOwner,grant}=f;
 await grant(exec,'admin');await grant(chair,'chair',ids.ga1);
 const now=Date.now();
 const slot=async(name:string,start:number,end:number)=>{
  await as(exec);
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify({type:'sessionSlot',action:'create',name,startsAt:iso(start),endsAt:iso(end)}),'admin',null,iso(now)]);
  await asOwner();return (await query<{id:string}>('select id from public.conference_session_slots where name=$1',[name]))[0].id;};
 // Past slot X, live slot A, future slot B. The version is back-dated so the schedule was already in effect for the past action
 // (a real publish is never retroactive; this isolates the labelling).
 const X=await slot('Past X',now-4*H,now-2*H),A=await slot('Live A',now-10*M,now+3*H),B=await slot('Future B',now+4*H,now+5*H);
 const session=async(slotId:string)=>{await asOwner();return (await query<{id:string}>('select id from public.sessions where "slotId"=$1 and committee_id=$2',[slotId,ids.ga1]))[0].id;};
 await asOwner();
 await db.query(`insert into public.schedule_version(conference_id,committee_id,effective_from,changed_by,reason,automation_enabled,sessions)
  values($1,$2,$3,$4,'Fixture',true,private.ops_schedule_snapshot($1,$2,null))`,[ids.conference,ids.ga1,iso(now-12*H),exec]);
 const send=async(command:Record<string,unknown>,clientTime:number,role='chair',user=chair,key=crypto.randomUUID(),expected:string|null=null)=>{
  await as(user);
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,iso(clientTime)]);return key;};
 const labelOf=async(table:string,id:string)=>{await asOwner();return (await query<Record<string,unknown>>('select * from public.record_label where record_table=$1 and record_id=$2',[table,id]))[0];};
 const lastEvent=async()=>{await asOwner();return (await query<{id:string}>('select id from public.participation_events order by "createdAt" desc, id desc limit 1',[]))[0].id;};
 const score={type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null};
 return {...f,now,X,A,B,session,send,labelOf,lastEvent,score};
}

test('real PostgreSQL: an online score is labelled with the session its trusted device time falls in, in the same transaction',async()=>{
 const {db,ids,now,A,session,send,labelOf,query,asOwner}=await setup();
 try{
  const key=await send({...({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null})},now);
  await asOwner();
  const id=key.slice(0,24)+'000000000001';
  const row=await labelOf('participation_events',id);
  assert.ok(row,'the record has a label row');
  assert.equal(row.assigned_label,await session(A));
  assert.equal(row.time_confidence,'trusted');
  assert.equal(row.outside_schedule,false);assert.equal(row.no_session,false);assert.equal(row.label_differs,false);
  assert.equal(row.displayed_label,null);assert.equal(row.legacy,false);
  assert.equal(await (async()=>{await asOwner();return (await query<{f:string}>(`select private.final_label('participation_events',$1) f`,[id]))[0].f;})(),await session(A),'final_label falls back to the assigned label');
  // A failed command writes neither the record nor a label.
  await assert.rejects(()=>send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:99,resolutionId:null},now),/Invalid scoring value/);
  await asOwner();
  assert.equal(Number((await query<{n:number}>(`select count(*)::int n from public.record_label where record_table='participation_events'`,[]))[0].n),1);
 }finally{await db.close();}
});

test('real PostgreSQL: outside every window, and with automation off, the label is null and flagged - the nearest session is never chosen',async()=>{
 const {db,ids,now,session,send,labelOf,asOwner,A}=await setup();
 try{
  // 4.5 hours ago is before slot X's first switch (X started 4 hours ago, switch 5 minutes earlier): outside every window.
  const outside=now-270*M;
  const k1=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null},outside);
  // With no sync record for the device and 4.5 hours of lag, the time is Uncertain and the server's receipt time (inside A) labels it.
  const r1=await labelOf('participation_events',k1.slice(0,24)+'000000000001');
  assert.equal(r1.time_confidence,'uncertain');assert.equal(r1.assigned_label,await session(A),'an Uncertain clock does not pick the session: the server receipt time does');
  // Trusted but outside: the device's clock is verified for that day, so its own time is used.
  const device=U(500);
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,1500)`,[ids.conference,device,chair,day(outside)]);
  const k2=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{deviceId:device,deviceSeq:7}},outside);
  const r2=await labelOf('participation_events',k2.slice(0,24)+'000000000001');
  assert.equal(r2.time_confidence,'trusted');
  assert.equal(r2.assigned_label,null);assert.equal(r2.outside_schedule,true);assert.equal(r2.no_session,false);
  assert.equal(r2.device_id,device);assert.equal(String(r2.device_seq),'7');
 }finally{await db.close();}
});

test('real PostgreSQL: time confidence - online within the tolerance, a verified device clock for the day, an unverified or skewed one, a future-dated one',async()=>{
 const {db,ids,now,X,session,send,labelOf,asOwner}=await setup();
 try{
  const device=U(501),skewed=U(502);
  const past=now-3*H;
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$4,$5,90000),($1,$3,$4,$5,400000)`,[ids.conference,device,skewed,chair,day(past)]);
  const cmd=(d?:string)=>({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,...(d?{_device:{deviceId:d,deviceSeq:1}}:{})});
  const conf=async(c:Record<string,unknown>,t:number)=>{const k=await send(c,t);return labelOf('participation_events',k.slice(0,24)+'000000000001');};
  const good=await conf(cmd(device),past);
  assert.equal(good.time_confidence,'trusted','offset 90 s is within 2 minutes');
  assert.equal(good.assigned_label,await session(X),'labelled by the device time: the past slot');
  const slow=await conf(cmd(skewed),past);
  assert.equal(slow.time_confidence,'uncertain','offset 400 s is over 2 minutes');
  const none=await conf(cmd(),past);
  assert.equal(none.time_confidence,'uncertain','no device, not online');
  const near=await conf(cmd(),now-90_000);
  assert.equal(near.time_confidence,'trusted','received within 2 minutes of the device time');
  const ahead=await conf(cmd(device),now+10*M);
  assert.equal(ahead.time_confidence,'uncertain','a device time later than receipt by more than the tolerance');
  // The tolerance is a setting, not a constant.
  await asOwner();
  await db.query(`insert into private.conference_settings(conference_id,time_trust_minutes) values($1,10) on conflict (conference_id) do update set time_trust_minutes=10`,[ids.conference]);
  assert.equal((await conf(cmd(),now-5*M)).time_confidence,'trusted','5 minutes is within a 10-minute tolerance');
  assert.equal((await conf(cmd(skewed),past)).time_confidence,'trusted','offset 400 s is within a 10-minute tolerance');
 }finally{await db.close();}
});

test('real PostgreSQL: the device\'s displayed label is evidence only - a difference is flagged, a label from another committee is dropped',async()=>{
 const {db,ids,now,A,B,session,send,labelOf,asOwner,query}=await setup();
 try{
  const device=U(504);
  const k=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{deviceId:device,deviceSeq:2,displayedLabel:await session(B)}},now);
  const r=await labelOf('participation_events',k.slice(0,24)+'000000000001');
  assert.equal(r.assigned_label,await session(A));assert.equal(r.displayed_label,await session(B));assert.equal(r.label_differs,true,'flagged for review');
  const other=(await (async()=>{await asOwner();return query<{id:string}>('select id from public.sessions where committee_id=$1 limit 1',[ids.who]);})())[0].id;
  const k2=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{displayedLabel:other}},now);
  const r2=await labelOf('participation_events',k2.slice(0,24)+'000000000001');
  assert.equal(r2.displayed_label,null);assert.equal(r2.label_differs,false);
  // The same label is not a difference.
  const k3=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{displayedLabel:await session(A)}},now);
  assert.equal((await labelOf('participation_events',k3.slice(0,24)+'000000000001')).label_differs,false);
 }finally{await db.close();}
});

test('real PostgreSQL: corrections, point adjustments and replays are labelled once; a forged context cannot be used',async()=>{
 const {db,ids,now,A,session,send,labelOf,asOwner,query,as}=await setup();
 try{
  const k=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null},now);
  const event=k.slice(0,24)+'000000000001';
  await send({type:'event',id:event,points:2},now,'chair',chair,crypto.randomUUID(),'0');
  await asOwner();
  const corr=(await query<{id:string}>('select id from public.participation_corrections where event_id=$1',[event]))[0].id;
  assert.equal((await labelOf('participation_corrections',corr)).assigned_label,await session(A));

  // Operations path: a Chair's point deduction.
  await as(chair);
  const adj=crypto.randomUUID();
  await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,adj,JSON.stringify({type:'pointAdjustment',action:'deduct',delegateId:ids.france,sessionId:ids.session,amount:2,reason:'Disrupted the session'}),'chair',null,iso(now)]);
  assert.equal((await labelOf('participation_adjustments',adj.slice(0,24)+'000000000001')).assigned_label,await session(A));

  // A replay (same key, same payload) acknowledges without a second label or record.
  await asOwner();
  const before=Number((await query<{n:number}>('select count(*)::int n from public.record_label',[]))[0].n);
  await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null},now,'chair',chair,k);
  await asOwner();
  assert.equal(Number((await query<{n:number}>('select count(*)::int n from public.record_label',[]))[0].n),before);

  // A caller who pre-sets the context still gets the dispatcher's: the forged device id never reaches the label.
  await as(chair);
  await db.query(`select set_config('munos.mutation_ctx', $1, false)`,[JSON.stringify({conference:ids.conference,deviceId:U(999),clientTime:iso(now),receivedAt:iso(now)})]);
  const k3=crypto.randomUUID();
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,k3,JSON.stringify({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null}),'chair',null,iso(now)]);
  assert.equal((await labelOf('participation_events',k3.slice(0,24)+'000000000001')).device_id,null);
 }finally{await db.close();}
});

test('real PostgreSQL: a changed vote is re-labelled with its newest action',async()=>{
 const {db,ids,now,A,B,session,send,labelOf,asOwner,query}=await setup();
 try{
  await asOwner();
  const att=String((await query<{r:string}>('select coalesce((select revision from public.attendance where "sessionId"=$1 and "delegateId"=$2),0)::text r',[ids.session,ids.france]))[0].r);
  await send({type:'attendance',sessionId:ids.session,delegateId:ids.france,status:'Present & Voting'},now,'chair',chair,crypto.randomUUID(),att);
  const vote=async(choice:string,device:string)=>{
   await asOwner();
   const revision=String((await query<{r:string}>('select coalesce((select revision from public.votes where "sessionId"=$1 and "delegateId"=$2 and "resolutionId"=$3),0)::text r',[ids.session,ids.france,ids.resolution]))[0].r);
   return send({type:'vote',sessionId:ids.session,resolutionId:ids.resolution,delegateId:ids.france,choice,_device:{deviceId:device,deviceSeq:1,displayedLabel:await session(B)}},now,'chair',chair,crypto.randomUUID(),revision);};
  await vote('For',U(600));
  await asOwner();
  const row=(await query<{id:string}>('select id from public.votes where "delegateId"=$1 and "resolutionId"=$2',[ids.france,ids.resolution]))[0];
  const first=await labelOf('votes',row.id);
  assert.equal(first.assigned_label,await session(A));assert.equal(first.device_id,U(600));
  await vote('Against',U(601));
  const second=await labelOf('votes',row.id);
  assert.equal(second.device_id,U(601),'the label follows the newest action');
  await asOwner();
  assert.equal(Number((await query<{n:number}>(`select count(*)::int n from public.record_label where record_table='votes'`,[]))[0].n),1,'one label per vote row');
 }finally{await db.close();}
});

test('real PostgreSQL: automation off with no override, or no schedule at all, labels null and flags "no session"; an override labels with the overridden session',async()=>{
 const {db,ids,now,B,session,send,labelOf,asOwner,query}=await setup();
 try{
  await asOwner();
  // Automation switched off an hour ago.
  await db.query(`insert into public.schedule_version(conference_id,committee_id,effective_from,changed_by,reason,automation_enabled,sessions)
   values($1,$2,$3,$4,'Manual',false,private.ops_schedule_snapshot($1,$2,null))`,[ids.conference,ids.ga1,iso(now-H),exec]);
  const k=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null},now);
  const r=await labelOf('participation_events',k.slice(0,24)+'000000000001');
  assert.equal(r.assigned_label,null);assert.equal(r.no_session,true);assert.equal(r.outside_schedule,false);assert.equal(r.time_confidence,'trusted');
  // An Executive override (set an instant before the action) wins while automation is off.
  await asOwner();
  await db.query(`insert into public.session_override(id,conference_id,scope,committee_id,session_id,set_by,set_at) values($1,$2,'committee',$3,$4,$5,$6)`,
   [U(700),ids.conference,ids.ga1,await session(B),exec,iso(now-M)]);
  const k2=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null},now);
  const r2=await labelOf('participation_events',k2.slice(0,24)+'000000000001');
  assert.equal(r2.assigned_label,await session(B));assert.equal(r2.no_session,false);
  // A committee with no schedule version at all has no session either.
  await asOwner();
  const other=U(701);
  await db.query(`insert into auth.users values($1) on conflict do nothing`,[other]);
  await db.query(`insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values($1,$2,'chair',$3,now()+interval '1 day')`,[ids.conference,other,ids.who]);
  const del=(await query<{id:string}>('select id from public.delegates where committee_id=$1 limit 1',[ids.who]))[0].id;
  const sess=(await query<{id:string}>('select id from public.sessions where committee_id=$1 limit 1',[ids.who]))[0].id;
  const k3=await send({type:'participation',sessionId:sess,delegateId:del,categoryId:'speech',points:1,resolutionId:null},now,'chair',other);
  const r3=await labelOf('participation_events',k3.slice(0,24)+'000000000001');
  assert.equal(r3.assigned_label,null);assert.equal(r3.no_session,true);
 }finally{await db.close();}
});

test('real PostgreSQL: an explicitly displayed "no session" is a reported label - a mismatch with the assignment is flagged; omitted metadata is not',async()=>{
 const {db,ids,now,A,session,send,labelOf}=await setup();
 try{
  const mk=async(device?:Record<string,unknown>)=>{
   const k=await send({type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,...(device?{_device:device}:{})},now);
   return labelOf('participation_events',k.slice(0,24)+'000000000001');};
  const explicit=await mk({deviceId:U(520),deviceSeq:1,displayedLabel:null});
  assert.equal(explicit.assigned_label,await session(A));assert.equal(explicit.displayed_label,null);
  assert.equal(explicit.displayed_reported,true);assert.equal(explicit.label_differs,true,'the device said "no session" while the server assigned one');
  const omitted=await mk({deviceId:U(521),deviceSeq:1});
  assert.equal(omitted.displayed_reported,false);assert.equal(omitted.label_differs,false,'legacy metadata says nothing');
  const legacy=await mk();
  assert.equal(legacy.displayed_reported,false);assert.equal(legacy.label_differs,false);
  const same=await mk({displayedLabel:await session(A)});
  assert.equal(same.displayed_reported,true);assert.equal(same.label_differs,false);
 }finally{await db.close();}
});
