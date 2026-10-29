import test from 'node:test';
import assert from 'node:assert/strict';
import {H,M,U,chair,day,exec,iso,setupSessions,whoChair} from './helpers/session-fixture';

// Session model phase 3b (docs/SESSION_MODEL.md 4, 5, 12.5) on real PostgreSQL with every migration applied: the acceptance table,
// held actions, Executive review, and the device clock call. Holds apply only when the Executive has switched enforcement on.
type Held={id:string;state:string;reason:string;device_id:string|null;device_seq:string|null;actor_id:string;last_error:string|null;decided_by:string|null};

test('real PostgreSQL: with enforcement off (the default) nothing is held - an Uncertain record is applied and labelled, as in 3a',async()=>{
 const {db,now,send,score,eventOf,one,count}=await setupSessions();
 try{
  const key=await send(score,now-3*H);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(key)]),1);
  assert.equal((await one<{c:string}>('select time_confidence c from public.record_label where record_id=$1',[eventOf(key)])).c,'uncertain');
  assert.equal(await count('select 1 from public.held_action'),0);
 }finally{await db.close();}
});

test('real PostgreSQL: Record commands - Uncertain time is held and acknowledged; Trusted time applies, even outside a window',async()=>{
 const {db,ids,now,ops,send,score,eventOf,one,count,asOwner,as}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(100);
  // Uncertain: 3 hours behind, no verified device clock.
  const key=await send({...score,_device:{deviceId:dev,deviceSeq:5}},now-3*H);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(key)]),0,'no effect while held');
  const h=await one<Held>('select * from public.held_action where id=$1',[key]);
  assert.equal(h.state,'held');assert.equal(h.reason,'uncertain_time');assert.equal(h.device_id,dev);assert.equal(String(h.device_seq),'5');
  assert.equal(h.actor_id,chair);
  assert.equal(await count('select 1 from private.mutation_receipts where id=$1',[key]),0,'a held command has no applied receipt');
  // Received means acknowledged: the same key and payload again is a no-op; a different payload under the same key is rejected.
  await send({...score,_device:{deviceId:dev,deviceSeq:5}},now-3*H,'chair',chair,key);
  assert.equal(await count('select 1 from public.held_action'),1);
  await assert.rejects(()=>send({...score,points:2,_device:{deviceId:dev,deviceSeq:5}},now-3*H,'chair',chair,key),/Idempotency key reused/);
  // A Trusted record applies; here it is also outside every window's reach (before X), so it is labelled null and flagged.
  const out=await send(score,now);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(out)]),1);
  // Visibility: the Chair of the committee and the Executive see the held item; another committee's Chair does not.
  await as(chair);assert.equal((await db.query('select 1 from public.held_action')).rows.length,1);
  await as(whoChair);assert.equal((await db.query('select 1 from public.held_action')).rows.length,0);
  await as(exec);
  const snap=(await db.query<{s:{heldActions:{id:string;reason:string}[]}}>('select public.operations_snapshot($1) s',[ids.conference])).rows[0].s;
  assert.deepEqual(snap.heldActions.map(x=>[x.id,x.reason]),[[key,'uncertain_time']]);
  await asOwner();
 }finally{await db.close();}
});

test('real PostgreSQL: Record time exactly at the edge - a verified device clock is Trusted and applies; a skewed one is held',async()=>{
 const {db,ids,now,ops,send,score,eventOf,count,asOwner}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const good=U(101),bad=U(102);
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$4,$5,30000),($1,$3,$4,$5,600000)`,[ids.conference,good,bad,chair,day(now-3*H)]);
  const a=await send({...score,_device:{deviceId:good,deviceSeq:1}},now-3*H);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(a)]),1,'offset 30 s: Trusted, applied');
  const b=await send({...score,_device:{deviceId:bad,deviceSeq:1}},now-3*H);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(b)]),0,'offset 10 min: Uncertain, held');
  assert.equal(await count(`select 1 from public.held_action where id=$1 and reason='uncertain_time'`,[b]),1);
 }finally{await db.close();}
});

test('real PostgreSQL: Control commands - held outside a window, when stale, behind a held command from the same device, and Uncertain; applied inside a window',async()=>{
 const {db,ids,now,ops,send,one,count,debateRevision,asOwner}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const control=(phase:'for'|'against')=>({type:'debateMode',committeeId:ids.ga1,mode:'open',phase});
  const dev=U(110);
  await asOwner();
  const verified=async(d:string,t:number)=>{await asOwner();await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,0)`,[ids.conference,d,chair,day(t)]);};
  // Inside a window and fresh: applied.
  const ok=await send(control('against'),now,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal(await count(`select 1 from public.debate_states where committee_id=$1 and "sessionId" is null and phase='against'`,[ids.ga1]),1);
  assert.equal(await count('select 1 from public.held_action where id=$1',[ok]),0);

  // Outside every window (before X's switch), Trusted via a verified clock: HELD (a Record would have applied).
  const early=now-270*M;
  await verified(dev,early);
  const k1=await send({...control('for'),_device:{deviceId:dev,deviceSeq:1}},early,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[k1])).reason,'outside_window');
  assert.equal(await count(`select 1 from public.debate_states where committee_id=$1 and "sessionId" is null and phase='for'`,[ids.ga1]),0);

  // Behind: a later command from the same device and committee is held behind it, even though it is inside a window.
  await verified(dev,now);
  const k2=await send({...control('for'),_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[k2])).reason,'behind_held');
  // Another device is not blocked.
  const k3=await send({...control('for'),_device:{deviceId:U(111),deviceSeq:1}},now,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal(await count('select 1 from public.held_action where id=$1',[k3]),0);
  assert.equal(await count(`select 1 from public.debate_states where committee_id=$1 and "sessionId" is null and phase='for'`,[ids.ga1]),1);
  // A Record from the held device is NOT held behind a Control (records follow the table on their own).
  const rec=await send({type:'participation',committeeId:ids.ga1,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{deviceId:dev,deviceSeq:3}},now);
  assert.equal(await count('select 1 from public.held_action where id=$1',[rec]),0);

  // Stale: Trusted via a verified clock but received more than 5 minutes after its device time.
  const dev2=U(112);
  const late=now-20*M;
  await verified(dev2,late);
  const k4=await send({...control('against'),_device:{deviceId:dev2,deviceSeq:1}},late,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[k4])).reason,'stale');
  // Uncertain control.
  const k5=await send({...control('against'),_device:{deviceId:U(113),deviceSeq:1}},now-3*H,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[k5])).reason,'uncertain_time');
 }finally{await db.close();}
});

test('real PostgreSQL: an Executive-closed day holds everything that arrives afterwards, Record and Control alike',async()=>{
 const {db,ids,now,ops,send,score,eventOf,one,count,debateRevision}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const before=await send(score,now);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(before)]),1);
  await assert.rejects(()=>ops(exec,{type:'closeDay',reason:' '}),/reason is required/);
  await ops(exec,{type:'closeDay',reason:'Day finished'});
  await assert.rejects(()=>ops(exec,{type:'closeDay',reason:'Again'}),/already closed/);
  const rec=await send(score,now);
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[rec])).reason,'day_closed');
  const ctl=await send({type:'debateMode',committeeId:ids.ga1,mode:'open',phase:'against'},now,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[ctl])).reason,'day_closed');
 }finally{await db.close();}
});

test('real PostgreSQL: Executive approval applies the ORIGINAL command once, as its original actor, and keeps the Executive\'s own audit row',async()=>{
 const {db,ids,now,ops,send,score,eventOf,one,count}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const key=await send(score,now-3*H);
  await assert.rejects(()=>ops(chair,{type:'heldDecide',heldId:key,decision:'approve',reason:'x'},'chair'),(e:{code?:string})=>e.code==='42501','a Chair cannot decide');
  await assert.rejects(()=>ops(chair,{type:'heldDecide',heldId:key,decision:'approve',reason:'x'},'admin'),(e:{code?:string})=>e.code==='42501');
  await assert.rejects(()=>ops(exec,{type:'heldDecide',heldId:key,decision:'maybe',reason:'x'}),/approve or discard/);
  await assert.rejects(()=>ops(exec,{type:'heldDecide',heldId:key,decision:'approve',reason:''}),/reason is required/);
  await ops(exec,{type:'heldDecide',heldId:key,decision:'approve',reason:'Chair confirmed it happened'});
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(key)]),1,'applied exactly once');
  assert.equal((await one<{c:string}>('select "chairId" c from public.participation_events where id=$1',[eventOf(key)])).c,chair,'recorded as the original Chair, not the Executive');
  const h=await one<Held>('select * from public.held_action where id=$1',[key]);
  assert.equal(h.state,'applied');assert.equal(h.decided_by,exec);
  assert.equal(await count('select 1 from private.mutation_receipts where id=$1 and actor_id=$2',[key,chair]),1,'the receipt carries the original actor');
  const audit=await one<{n:number}>(`select count(*)::int n from public.audit_log where "actorId"=$1 and action like 'heldDecide%'`,[exec]);
  assert.equal(audit.n,1,"the Executive's decision is audited under the Executive");
  assert.equal(await count(`select 1 from public.audit_log where "actorId"=$1 and mutation_id=$2`,[chair,key]),1,"the applied effect is audited under the Chair");
  // The record's label records its review and keeps the original receipt time; the schedule was not in effect then, so no session.
  const label=await one<{held_action_id:string;time_confidence:string}>('select held_action_id,time_confidence from public.record_label where record_id=$1',[eventOf(key)]);
  assert.equal(label.held_action_id,key);assert.equal(label.time_confidence,'uncertain','a single approval does not claim the clock was right');
  // Replays: the original key (device retry) and a second decision both do nothing more.
  await send(score,now-3*H,'chair',chair,key);
  await assert.rejects(()=>ops(exec,{type:'heldDecide',heldId:key,decision:'approve',reason:'again'}),/already been decided/);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(key)]),1);
  void ids;
 }finally{await db.close();}
});

test('real PostgreSQL: discard retains the item and never applies it; a retry of the discarded command is acknowledged without effect',async()=>{
 const {db,now,ops,send,score,eventOf,one,count}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const key=await send(score,now-3*H);
  await ops(exec,{type:'heldDecide',heldId:key,decision:'discard',reason:'Not seen by the Chair'});
  const h=await one<Held>('select * from public.held_action where id=$1',[key]);
  assert.equal(h.state,'discarded');assert.equal(h.decided_by,exec);
  await send(score,now-3*H,'chair',chair,key);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(key)]),0);
  assert.equal(await count('select 1 from public.held_action'),1,'retained');
 }finally{await db.close();}
});

test('real PostgreSQL: approval stays held with a new reason when the revision moved on or the original actor lost access',async()=>{
 const {db,ids,now,ops,send,one,count,debateRevision,asOwner}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const control=(phase:'for'|'against')=>({type:'debateMode',committeeId:ids.ga1,mode:'open',phase});
  // Held Control, then the entity moves on (another command changes the debate state): the approval reports a revision mismatch.
  const held=await send(control('for'),now-3*H,'chair',chair,crypto.randomUUID(),await debateRevision());
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[held])).reason,'uncertain_time');
  await send(control('against'),now,'chair',chair,crypto.randomUUID(),await debateRevision());
  await ops(exec,{type:'heldDecide',heldId:held,decision:'approve',reason:'Try'});
  const h=await one<Held>('select * from public.held_action where id=$1',[held]);
  assert.equal(h.state,'held');assert.equal(h.reason,'revision_mismatch');assert.ok(h.last_error);
  assert.equal(await count(`select 1 from public.debate_states where committee_id=$1 and "sessionId" is null and phase='against'`,[ids.ga1]),1,'nothing was applied');

  // The original actor's CURRENT permissions decide: revoke the Chair and the approval reports it.
  const rec=await send({type:'participation',committeeId:ids.ga1,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null},now-3*H);
  await asOwner();
  await db.query(`update public.user_access set revoked_at=now() where user_id=$1`,[chair]);
  await ops(exec,{type:'heldDecide',heldId:rec,decision:'approve',reason:'Try'});
  const r=await one<Held>('select * from public.held_action where id=$1',[rec]);
  assert.equal(r.state,'held');assert.equal(r.reason,'actor_not_authorised');
  assert.equal(await count('select 1 from public.participation_events where id=$1',[rec.slice(0,24)+'000000000001']),0);
  // The Executive can still discard it.
  await ops(exec,{type:'heldDecide',heldId:rec,decision:'discard',reason:'Access withdrawn'});
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[rec])).state,'discarded');
 }finally{await db.close();}
});

test('real PostgreSQL: bulk approval after a confirmed clock error applies a device\'s items in order, labelled by the corrected time',async()=>{
 const {db,ids,now,ops,send,score,eventOf,one,count,session,asOwner}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(120);
  // A tablet whose clock runs 3 hours slow: its "now" reads 3 hours earlier, and it never synced, so every action is Uncertain.
  const slow=now-3*H;
  const keys=[] as string[];
  for(let i=1;i<=3;i++)keys.push(await send({...score,points:1,_device:{deviceId:dev,deviceSeq:i}},slow+i*1000));
  assert.equal(await count(`select 1 from public.held_action where device_id=$1 and reason='uncertain_time'`,[dev]),3);
  await assert.rejects(()=>ops(exec,{type:'heldBulkApprove',deviceId:dev,reason:'Clock error'}),/Confirm this device/);
  // The Executive confirms the clock is 3 hours slow (offset = device - server = -3 h); clockConfirm needs a sync row for the device.
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,$5)`,[ids.conference,dev,chair,day(now),-3*H]);
  await ops(exec,{type:'clockConfirm',deviceId:dev,offsetMs:-3*H,reason:'Tablet clock is 3 hours slow'});
  await ops(exec,{type:'heldBulkApprove',deviceId:dev,reason:'Clock error confirmed'});
  for(const k of keys)assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(k)]),1);
  assert.equal(await count(`select 1 from public.held_action where device_id=$1 and state='applied' and decided_by=$2`,[dev,exec]),3);
  // Labelled by the corrected time (now-ish => the live slot), trusted, linked to the review.
  const l=await one<{assigned_label:string|null;time_confidence:string;held_action_id:string}>('select assigned_label,time_confidence,held_action_id from public.record_label where record_id=$1',[eventOf(keys[0])]);
  assert.equal(l.time_confidence,'trusted');assert.equal(l.held_action_id,keys[0]);
  assert.equal(l.assigned_label,await session((await one<{id:string}>(`select id from public.conference_session_slots where name='Live A'`)).id));
 }finally{await db.close();}
});

test('real PostgreSQL: the device clock call records a signed offset, once a minute, for holders of a grant only',async()=>{
 const {db,ids,as,asOwner,count,one}=await setupSessions();
 try{
  const dev=U(130);
  await as(chair);
  const serverNow=Date.now();
  const r=await db.query<{v:string}>('select public.record_device_clock($1,$2,$3) v',[ids.conference,dev,iso(serverNow+90_000)]);
  const off=Number(r.rows[0].v);
  assert.ok(off>=89_000&&off<=92_000,'a device 90 s ahead reports about +90000 ms, got '+off);
  await db.query('select public.record_device_clock($1,$2,$3)',[ids.conference,dev,iso(serverNow+95_000)]);
  await asOwner();
  assert.equal(await count('select 1 from public.device_clock_sync where device_id=$1',[dev]),1,'rate limited to one row per minute');
  assert.equal((await one<{a:string}>('select actor_id a from public.device_clock_sync where device_id=$1',[dev])).a,chair);
  await as(U(998));
  await assert.rejects(()=>db.query('select public.record_device_clock($1,$2,$3)',[ids.conference,dev,iso(serverNow)]),(e:{code?:string})=>e.code==='42501','no grant, no clock');
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); set role anon;`);
  await assert.rejects(()=>db.query('select public.record_device_clock($1,$2,$3)',[ids.conference,dev,iso(serverNow)]),/permission denied/);
 }finally{await db.close();}
});

test('real PostgreSQL: a published session cannot be deleted - archive it; scores keep working',async()=>{
 const {db,ids,now,ops,send,score,eventOf,A,session,one,asOwner,count}=await setupSessions();
 try{
  const sid=await session(A);
  await asOwner();
  await assert.rejects(()=>db.query('delete from public.sessions where id=$1',[sid]),/archive it instead/);
  // Cleanup (the reviewed script) may delete whole synthetic conferences.
  await db.exec(`begin; select set_config('munos_cleanup.mode','execute',true);`);
  await db.query('delete from public.sessions where id=$1',[sid]);
  await db.exec('rollback');
  assert.equal(await count('select 1 from public.sessions where id=$1',[sid]),1);
  const key=await send(score,now);
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(key)]),1);
  void ops;void one;void ids;
 }finally{await db.close();}
});

test('real PostgreSQL: a missing or null decision is rejected and changes nothing',async()=>{
 const {db,now,ops,send,score,one,count}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const key=await send(score,now-3*H);
  const events=await count('select 1 from public.participation_events');
  for(const bad of [{},{decision:null},{decision:''},{decision:'APPROVE'}])
   await assert.rejects(()=>ops(exec,{type:'heldDecide',heldId:key,reason:'x',...bad}),/approve or discard/,JSON.stringify(bad));
  const h=await one<Held>('select * from public.held_action where id=$1',[key]);
  assert.equal(h.state,'held');assert.equal(h.decided_by,null);
  assert.equal(await count('select 1 from public.participation_events'),events,'nothing was applied');
 }finally{await db.close();}
});

test('real PostgreSQL: approval keeps Control ordering - a later Control waits for the earlier one; Records continue; a failed Control blocks the rest in bulk',async()=>{
 const {db,ids,now,ops,send,eventOf,one,count,debateRevision,asOwner}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(140);
  const control=(phase:'for'|'against')=>({type:'debateMode',committeeId:ids.ga1,mode:'open',phase});
  const slow=now-3*H;
  const rev=await debateRevision();
  const c1=await send({...control('for'),_device:{deviceId:dev,deviceSeq:1}},slow,'chair',chair,crypto.randomUUID(),rev);
  const c2=await send({...control('against'),_device:{deviceId:dev,deviceSeq:2}},slow+1000,'chair',chair,crypto.randomUUID(),rev);
  const r1=await send({type:'participation',committeeId:ids.ga1,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{deviceId:dev,deviceSeq:3}},slow+2000);
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c2])).state,'held');

  // Individually: the later Control cannot be approved while the earlier one is held; the independent Record can.
  await assert.rejects(()=>ops(exec,{type:'heldDecide',heldId:c2,decision:'approve',reason:'x'}),/earlier held action/);
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c2])).state,'held');
  await ops(exec,{type:'heldDecide',heldId:r1,decision:'approve',reason:'Record is independent'});
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(r1)]),1);
  // Discarding the earlier Control releases the later one.
  await ops(exec,{type:'heldDecide',heldId:c1,decision:'discard',reason:'Not needed'});
  await ops(exec,{type:'heldDecide',heldId:c2,decision:'approve',reason:'Now first in line'});
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c2])).state,'applied');

  // Bulk: the first Control fails its revision check, so the later Control stays held; a Record still applies.
  const dev2=U(141);
  const rev2=await debateRevision();
  const d1=await send({...control('for'),_device:{deviceId:dev2,deviceSeq:1}},slow,'chair',chair,crypto.randomUUID(),rev2);
  const d2=await send({...control('against'),_device:{deviceId:dev2,deviceSeq:2}},slow+1000,'chair',chair,crypto.randomUUID(),rev2);
  const d3=await send({type:'participation',committeeId:ids.ga1,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null,_device:{deviceId:dev2,deviceSeq:3}},slow+2000);
  await send(control('for'),now,'chair',chair,crypto.randomUUID(),await debateRevision());
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,$5)`,[ids.conference,dev2,chair,day(now),-3*H]);
  await ops(exec,{type:'clockConfirm',deviceId:dev2,offsetMs:-3*H,reason:'Slow clock'});
  await ops(exec,{type:'heldBulkApprove',deviceId:dev2,reason:'Clock error confirmed'});
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[d1])).reason,'revision_mismatch');
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[d2])).state,'held','a later Control stays behind the failed one');
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[d3])).state,'applied','an independent Record is applied');
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventOf(d3)]),1);
 }finally{await db.close();}
});

test('real PostgreSQL: bulk approval never overtakes an earlier unresolved Control, whatever it was held for, including after a failed attempt',async()=>{
 const {db,ids,now,ops,send,one,debateRevision,asOwner}=await setupSessions();
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const control=(phase:'for'|'against')=>({type:'debateMode',committeeId:ids.ga1,mode:'open',phase});
  const dev=U(150);
  const early=now-270*M;
  await asOwner();
  // The device's clock is verified for the early instant: the first Control is Trusted but outside every window.
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,0)`,[ids.conference,dev,chair,day(early)]);
  const rev=await debateRevision();
  const c1=await send({...control('for'),_device:{deviceId:dev,deviceSeq:1}},early,'chair',chair,crypto.randomUUID(),rev);
  const c2=await send({...control('against'),_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),rev);
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c1])).reason,'outside_window');
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c2])).reason,'behind_held');
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,0)`,[ids.conference,dev,chair,day(now)]);
  await ops(exec,{type:'clockConfirm',deviceId:dev,offsetMs:0,reason:'Clock fine'});
  // c1 is not a clock item, so the batch does not approve it; c2 must still wait behind it.
  await ops(exec,{type:'heldBulkApprove',deviceId:dev,reason:'Clock confirmed'});
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c1])).state,'held');
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[c2])).state,'held','behind an outside-window predecessor');

  // A predecessor left as revision_mismatch by an earlier attempt also blocks a later batch.
  const dev2=U(151);
  const slow=now-3*H;
  const rev2=await debateRevision();
  const d1=await send({...control('for'),_device:{deviceId:dev2,deviceSeq:1}},slow,'chair',chair,crypto.randomUUID(),rev2);
  await send(control('for'),now,'chair',chair,crypto.randomUUID(),await debateRevision());
  await ops(exec,{type:'heldDecide',heldId:d1,decision:'approve',reason:'Try'});
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[d1])).reason,'revision_mismatch');
  const d2=await send({...control('against'),_device:{deviceId:dev2,deviceSeq:2}},slow+1000,'chair',chair,crypto.randomUUID(),await debateRevision());
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,$5)`,[ids.conference,dev2,chair,day(now),-3*H]);
  await ops(exec,{type:'clockConfirm',deviceId:dev2,offsetMs:-3*H,reason:'Slow clock'});
  await ops(exec,{type:'heldBulkApprove',deviceId:dev2,reason:'Clock confirmed'});
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[d1])).state,'held');
  assert.equal((await one<Held>('select * from public.held_action where id=$1',[d2])).state,'held','behind a predecessor that failed earlier');
 }finally{await db.close();}
});
