import test from 'node:test';
import assert from 'node:assert/strict';
import {H,M,U,chair,day,exec,iso,setupSessions} from './helpers/session-fixture';

// Live state keyed by committee, roll calls, historical eligibility and ballot snapshots (docs/SESSION_MODEL.md sections 6 and 8) on real
// PostgreSQL with every migration applied. Chairs never name a session: commands name their committee.
async function fixture(){
 const f=await setupSessions();
 const {ids,query,asOwner}=f;
 await asOwner();
 const delegates=(await query<{id:string}>('select id from public.delegates where committee_id=$1 order by id',[f.ids.ga1])).map(r=>r.id);
 const c={committeeId:ids.ga1};
 const roll=(rows:Record<string,string>,o:{id?:string;revision?:number;copiedFrom?:string;observed?:number;committed?:number;device?:string;seq?:number}={})=>({
  type:'rollCallCommit',...c,rollCallId:o.id??crypto.randomUUID(),revision:o.revision??1,...(o.copiedFrom?{copiedFrom:o.copiedFrom}:{}),
  observedAt:iso(o.observed??(o.committed??f.now-M)-1000),committedAt:iso(o.committed??f.now-M),
  rows:delegates.map(d=>({delegateId:d,status:rows[d]??'Absent'})),...(o.device?{_device:{deviceId:o.device,deviceSeq:o.seq??1}}:{})});
 const verify=async(device:string,t:number)=>{await asOwner();await f.db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,$4,0)`,[ids.conference,device,chair,day(t)]);};
 const queue=async()=>{await asOwner();return (await query<{d:string;s:string|null}>(`select "delegateId" d,"sessionId" s from public.speaker_queue where committee_id=$1 and "sessionId" is null and state='active' order by position`,[ids.ga1]));};
 return {...f,delegates,c,roll,verify,queue};
}
const present=(...ds:string[])=>Object.fromEntries(ds.map(d=>[d,'Present & Voting']));

test('real PostgreSQL: a Chair works without choosing a session - committee-keyed queue and debate state, the old commands refused',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,c,roll,queue,one,debateRevision}=f;
 try{
  // A roll call marking everyone absent: nobody may join the queue.
  await send(roll({},{committed:now-90_000}),now);
  await assert.rejects(()=>send({type:'queueAdd',...c,delegateId:delegates[0],lane:'open'},now),/must be present/);
  await send(roll(present(delegates[0],delegates[1])),now);
  await send({type:'queueAdd',...c,delegateId:delegates[0],lane:'open'},now);
  await send({type:'queueAdd',...c,delegateId:delegates[1],lane:'open'},now);
  const q=await queue();
  assert.deepEqual(q.map(r=>r.d),[delegates[0],delegates[1]]);
  assert.ok(q.every(r=>r.s===null),'new live rows carry no session');
  await send({type:'debateMode',...c,mode:'closed',phase:'for'},now,'chair',chair,crypto.randomUUID(),await debateRevision());
  const ds=await one<{mode:string;s:string|null}>(`select mode,"sessionId" s from public.debate_states where committee_id=$1 and "sessionId" is null`,[ids.ga1]);
  assert.equal(ds.mode,'closed');assert.equal(ds.s,null);
  // An older saved command naming a session is accepted; the session only identifies the committee.
  await send({type:'queueRemove',sessionId:ids.session,entryId:(await one<{id:string}>(`select id from public.speaker_queue where "delegateId"=$1 and "sessionId" is null and state='active'`,[delegates[1]])).id},now);
  assert.equal((await queue()).length,1);
  // Retired: choosing a session, saving attendance, saving a timer.
  await assert.rejects(()=>send({type:'currentSession',committeeId:ids.ga1,sessionId:ids.session},now,'chair',chair,crypto.randomUUID(),'0'),(e:{code?:string;message?:string})=>e.code==='22023');
  await assert.rejects(()=>send({type:'attendance',sessionId:ids.session,delegateId:delegates[0],status:'Present'},now),/roll calls/);
  await assert.rejects(()=>send({type:'timer',sessionId:ids.session,duration:60,remaining:60,startedAt:null},now),/no longer saved/);
  void exec;void H;void M;void U;void iso;
 }finally{await db.close();}
});

test('real PostgreSQL: roll calls - committed whole, corrected by revision, copied, validated; only the live one changes the floor',async()=>{
 const f=await fixture();const {db,now,send,delegates,c,roll,queue,one,count}=f;
 try{
  const first=crypto.randomUUID();
  await send(roll(present(delegates[0],delegates[1]),{id:first}),now);
  await send({type:'queueAdd',...c,delegateId:delegates[1],lane:'open'},now);
  assert.equal(await count('select 1 from public.roll_call_row where roll_call_id=$1',[first]),delegates.length,'the full row set');
  await assert.rejects(()=>send(roll({},{id:first,committed:now}),now),/already committed/);
  await assert.rejects(()=>send(roll({},{id:crypto.randomUUID(),revision:2,committed:now}),now),/previous revision/);
  await assert.rejects(()=>send({...roll({}),rows:[{delegateId:delegates[0],status:'Here'}]},now),/delegate of this committee and a status/);
  await assert.rejects(()=>send({...roll({}),rows:[{delegateId:delegates[0],status:'Present'},{delegateId:delegates[0],status:'Absent'}]},now),/appears once/);
  await assert.rejects(()=>send(roll({},{copiedFrom:crypto.randomUUID()}),now),/Copied roll call unavailable/);
  // A delayed OLDER roll call (effective 30 min ago, where delegate 1 is absent) is stored but does not change the floor.
  const dev=U(200);await f.verify(dev,now-30*M);
  await send(roll(present(delegates[0]),{committed:now-30*M,device:dev}),now-30*M);
  assert.deepEqual((await queue()).map(r=>r.d),[delegates[1]],'not live: delegate 1 stays queued');
  // A correction of the live roll call (revision 2, later) marks delegate 1 absent: it leaves the queue.
  await send(roll(present(delegates[0]),{id:first,revision:2,copiedFrom:first,committed:now-30_000}),now);
  assert.deepEqual((await queue()).map(r=>r.d),[],'the live correction removed the absent delegate');
  const live=await one<{id:string;revision:number}>(`select id,revision from public.roll_call where committee_id=$1 and state='committed' order by effective_at desc,id desc,revision desc limit 1`,[f.ids.ga1]);
  assert.equal(live.id,first);assert.equal(Number(live.revision),2);
 }finally{await db.close();}
});

test('real PostgreSQL: historical eligibility - the 11:55 / 12:30 / 12:40 example, an offline roll call arriving with its action, a cited roll call',async()=>{
 const f=await fixture();const {db,now,send,delegates,c,roll,queue}=f;
 try{
  const dev=U(201);
  const t0=now-45*M;await f.verify(dev,t0);await f.verify(dev,now);
  // Present at "11:55" (t0), absent at "12:30" (t0+35); an action recorded at "11:58" (t0+3) arrives last ("12:40").
  await send(roll(present(delegates[0]),{committed:t0,device:dev,seq:1}),t0);
  await send(roll({},{committed:t0+35*M,device:dev,seq:2}),t0+35*M);
  await send({type:'queueAdd',...c,delegateId:delegates[0],lane:'open',_device:{deviceId:dev,deviceSeq:3}},t0+3*M);
  assert.deepEqual((await queue()).map(r=>r.d),[delegates[0]],'validated against the roll call effective at 11:58, and applied');
  // Without a verified clock the action's time is its receipt: the live roll call (absent) decides.
  await assert.rejects(()=>send({type:'queueAdd',...c,delegateId:delegates[0],lane:'for'},t0+3*M),/must be present/);
  // An offline roll call and the action relying on it arrive together: the roll call's effective time, not its server commit time, decides.
  const dev2=U(202);const t1=now-25*M;await f.verify(dev2,t1);
  const rc=crypto.randomUUID();
  await send(roll(present(delegates[1]),{id:rc,committed:t1,device:dev2,seq:1}),t1);
  await send({type:'queueAdd',...c,delegateId:delegates[1],lane:'open',_device:{deviceId:dev2,deviceSeq:2},rollCall:{id:rc,revision:1}},t1+M);
  assert.ok((await queue()).some(r=>r.d===delegates[1]));
  // A cited roll call that does not permit the delegate is refused.
  await assert.rejects(()=>send({type:'queueAdd',...c,delegateId:delegates[2],lane:'open',_device:{deviceId:dev2,deviceSeq:3},rollCall:{id:rc,revision:1}},t1+2*M),/must be present/);
 }finally{await db.close();}
});

test('real PostgreSQL: a ballot snapshots eligibility when it opens - the abstention rule is unchanged and later roll calls do not move it',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,c,roll,one,count,asOwner}=f;
 try{
  const [pv,p,absent]=delegates;
  await send(roll({[pv]:'Present & Voting',[p]:'Present'}),now);
  await asOwner();
  const docRev=async()=>String((await one<{r:string}>('select revision::text r from public.documents where id=$1',[ids.resolution])).r);
  const vote=async(d:string,choice:string)=>{
   const r=String((await one<{r:string}>(`select coalesce((select revision from public.votes where "resolutionId"=$1 and "delegateId"=$2 and "sessionId" is null),0)::text r`,[ids.resolution,d])).r);
   return send({type:'vote',...c,resolutionId:ids.resolution,delegateId:d,choice},now,'chair',chair,crypto.randomUUID(),r);};
  await assert.rejects(()=>vote(pv,'For'),/Open the ballot/,'no ballot yet');
  await send({type:'voteMode',...c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural'},now,'chair',chair,crypto.randomUUID(),await docRev());
  assert.equal(await count('select 1 from public.ballot_eligibility where resolution_id=$1',[ids.resolution]),delegates.length);
  await assert.rejects(()=>vote(pv,'Abstain'),/does not permit/,'Present & Voting cannot abstain');
  await vote(p,'Abstain');
  await assert.rejects(()=>vote(absent,'For'),/does not permit/,'Absent cannot vote');
  // A later roll call marks pv absent and the absent delegate present: the open ballot keeps its snapshot.
  await send(roll({[absent]:'Present & Voting'}),now+1000);
  await vote(pv,'For');
  await assert.rejects(()=>vote(absent,'Against'),/does not permit/);
  const v=await one<{s:string|null}>(`select "sessionId" s from public.votes where "resolutionId"=$1 and "delegateId"=$2`,[ids.resolution,pv]);
  assert.equal(v.s,null,'votes are keyed by resolution and delegate');
  // The counted close uses the snapshot: 2 eligible, 2 ballots.
  await send({type:'document',id:ids.resolution,status:'Closed',outcome:'Passed'},now,'chair',chair,crypto.randomUUID(),await docRev());
  assert.equal((await one<{s:string;o:string}>('select status s,outcome o from public.documents where id=$1',[ids.resolution])).s,'Closed');
  // A ballot after the result: refused with enforcement off; held for review with it on.
  await assert.rejects(()=>vote(p,'For'),/active debate/);
  await f.ops(exec,{type:'holdSettings',enforce:true});
  const late=await vote(p,'For');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[late])).reason,'ballot_closed');
 }finally{await db.close();}
});

test('real PostgreSQL: a roll call taken in the break is labelled with the previous session; a future-dated one is held with enforcement on',async()=>{
 const f=await fixture();const {db,now,send,roll,one,session,X,A,count,ops}=f;
 try{
  // Slot X ended 2 h ago and A starts in the past 10 min, so the break between them belongs to X (the previous session holds).
  const dev=U(203);const breakTime=now-90*M;await f.verify(dev,breakTime);
  const id=crypto.randomUUID();
  await send(roll({},{id,committed:breakTime,device:dev}),breakTime);
  const l=await one<{a:string|null}>(`select assigned_label a from public.record_label where record_table='roll_call' and record_id=$1`,[id]);
  assert.equal(l.a,await session(X),'the break belongs to the previous session');
  assert.notEqual(l.a,await session(A));
  // Enforcement off: a future-dated roll call is accepted with the server receipt as its effective time.
  const fut=crypto.randomUUID();
  await send(roll({},{id:fut,committed:now+30*M}),now+30*M);
  const r=await one<{e:string;c:string}>('select effective_at e,time_confidence c from public.roll_call where id=$1',[fut]);
  assert.equal(r.c,'uncertain');assert.ok(Date.parse(r.e)<=Date.now()+1000,'never effective in the future');
  // Enforcement on: held.
  await ops(exec,{type:'holdSettings',enforce:true});
  const stored=await count('select 1 from public.roll_call');
  const held=await send(roll({},{committed:now+30*M}),now+30*M);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[held])).reason,'uncertain_time');
  assert.equal(await count('select 1 from public.roll_call'),stored,'the held roll call is not stored');
 }finally{await db.close();}
});

test('real PostgreSQL: resolutions and amendments no longer need a session pointer',async()=>{
 const f=await fixture();const {db,ids,now,send,one,asOwner,query}=f;
 try{
  const key=await send({type:'newDocument',committeeId:ids.ga1,title:'Committee-level resolution',submitterId:ids.france},now);
  const doc=await one<{s:string|null}>('select "sessionId" s from public.documents where id=$1',[key.slice(0,24)+'000000000001']);
  assert.equal(doc.s,null);
  // A delegate amendment to the resolution in debate, through the public link, without a current-session pointer.
  await asOwner();
  await db.query(`update public.committees set "currentSessionId"=null where id=$1`,[ids.ga1]);
  const link=(await query<{token:string}>(`select token from public.amendment_links where committee_id=$1 and revoked_at is null limit 1`,[ids.ga1]))[0];
  if(link){
   await db.exec(`reset role; set role service_role;`);
   const r=(await db.query<{r:{status:string}}>(`select public.submit_amendment($1,$2,$3,$4,'Add','1','New clause') r`,[link.token,crypto.randomUUID(),ids.france,ids.resolution])).rows[0].r;
   assert.equal(r.status,'created');
  }
 }finally{await db.close();}
});

test('real PostgreSQL: a roll call is admitted, labelled and made effective by its own commit time, not the action that carries it',async()=>{
 const f=await fixture();const {db,now,send,delegates,roll,one,count,session,A,ops}=f;
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const stored=()=>count('select 1 from public.roll_call where created_by is not null and id<>$1',['da2fcd3a-3f33-41c3-a06d-82bd22b6bc3e']);
  const before=await stored();
  // The carrying action is on time, but the roll call claims a commit time 30 minutes ahead: held, never live.
  const future=crypto.randomUUID();
  const heldId=await send(roll(present(delegates[0]),{id:future,committed:now+30*M,observed:now+30*M-1000}),now);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[heldId])).reason,'uncertain_time');
  assert.equal(await stored(),before,'the future-dated roll call is not stored while it is held');
  // The carrying action's own clock is 3 hours stale, but the roll call's commit time is trusted and inside A's window: applied and labelled A.
  const fresh=crypto.randomUUID();
  await send(roll(present(delegates[0]),{id:fresh,committed:now-60_000}),now-3*H);
  assert.equal(await stored(),before+1,'admitted on the roll call\'s own time');
  const e=await one<{e:string}>('select effective_at e from public.roll_call where id=$1',[fresh]);
  assert.ok(Math.abs(new Date(e.e).getTime()-(now-60_000))<=1,'effective at its commit time');
  const l=await one<{a:string|null}>(`select assigned_label a from public.record_label where record_table='roll_call' and record_id=$1`,[fresh]);
  assert.equal(l.a,await session(A),'labelled by the session holding its effective time');
 }finally{await db.close();}
});

test('real PostgreSQL: a Control that cites a held roll call is held with it and approved after it, never a permanent conflict',async()=>{
 const f=await fixture();const {db,now,send,delegates,roll,queue,one,count,ops,verify}=f;
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const queuedBefore=(await queue()).map(r=>r.d);const who=delegates.find(d=>!queuedBefore.includes(d))!;
  const dev=U(210);const early=now-270*M;
  await verify(dev,early);await verify(dev,now);
  // Offline before the first window opens: the roll call is held as outside the schedule...
  const rcId=crypto.randomUUID();
  const rollKey=await send(roll(present(who),{id:rcId,committed:early,device:dev,seq:1}),early);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[rollKey])).reason,'outside_window');
  // ...then, after the window opens, the Chair queues a delegate relying on it. It must be held too (not refused for citing an unapplied roll call).
  const queueKey=await send({type:'queueAdd',...f.c,delegateId:who,lane:'open',rollCall:{id:rcId,revision:1},_device:{deviceId:dev,deviceSeq:2}},now);
  assert.equal((await one<{reason:string;state:string}>('select reason,state from public.held_action where id=$1',[queueKey])).reason,'behind_held');
  assert.deepEqual((await queue()).map(r=>r.d),queuedBefore,'nothing applied yet');
  // The Executive cannot approve the dependent action first...
  const decide=(id:string,decision='approve')=>ops(exec,{type:'heldDecide',heldId:id,decision,reason:'Reviewed'});
  await assert.rejects(()=>decide(queueKey),/Decide the earlier held action/);
  // ...but approving the roll call first lets the dependent action follow.
  await decide(rollKey);
  assert.equal(await count(`select 1 from public.roll_call where id=$1 and state='committed'`,[rcId]),1);
  await decide(queueKey);
  // The approved roll call is now the live one (only this delegate present), so the others left the queue and the dependent action applied.
  assert.deepEqual((await queue()).map(r=>r.d),[who]);
 }finally{await db.close();}
});

test('real PostgreSQL: a vote waits for its held ballot restart, and a roll call revision or copy waits for the held roll call it builds on',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,one,count,ops,verify,asOwner}=f;
 try{
  const [pv]=delegates;
  await send(roll(present(pv)),now);
  const docRev=async()=>String((await one<{r:string}>('select revision::text r from public.documents where id=$1',[ids.resolution])).r);
  const voteRev=async()=>{return String((await one<{r:string}>(`select coalesce((select revision from public.votes where "resolutionId"=$1 and "delegateId"=$2 and "sessionId" is null),0)::text r`,[ids.resolution,pv])).r);};
  await send({type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural'},now,'chair',chair,crypto.randomUUID(),await docRev());
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(220);await verify(dev,now-10*M);await verify(dev,now);
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  // Restart the ballot offline; it reaches the server after the staleness limit, so it is held. The vote after it must be held too.
  const restart=await send({type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural',_device:{deviceId:dev,deviceSeq:1}},now-10*M,'chair',chair,crypto.randomUUID(),await docRev());
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[restart])).reason,'stale');
  const voteKey=await send({type:'vote',...f.c,resolutionId:ids.resolution,delegateId:pv,choice:'For',_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),await voteRev());
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[voteKey])).reason,'behind_held');
  assert.equal(await count(`select 1 from public.votes where "resolutionId"=$1 and "sessionId" is null`,[ids.resolution]),0,'the vote did not reach the old ballot');
  await assert.rejects(()=>decide(voteKey),/Decide the earlier held action/);
  await decide(restart);await decide(voteKey);
  assert.equal(await count(`select 1 from public.votes where "resolutionId"=$1 and "delegateId"=$2 and "sessionId" is null`,[ids.resolution,pv]),1,'the vote survived the approved restart');

  // A correction (next revision) of a roll call held as outside the schedule is held with it; so is a copy of it.
  const early=now-270*M;await verify(dev,early);
  const rcId=crypto.randomUUID(),copy=crypto.randomUUID();
  const first=await send(roll(present(pv),{id:rcId,committed:early,device:dev,seq:3}),early);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[first])).reason,'outside_window');
  const correction=await send(roll(present(pv),{id:rcId,revision:2,committed:now-60_000,device:dev,seq:4}),now);
  const copied=await send(roll(present(pv),{id:copy,copiedFrom:rcId,committed:now-30_000,device:dev,seq:5}),now);
  for(const k of [correction,copied])assert.equal((await one<{reason:string;state:string}>('select reason,state from public.held_action where id=$1',[k])).state,'held','held, not a permanent conflict');
  await assert.rejects(()=>decide(correction),/Decide the earlier held action/);
  await decide(first);await decide(correction);await decide(copied);
  await asOwner();
  assert.equal(await count('select 1 from public.roll_call where id=$1',[rcId]),2,'both revisions are committed after approval');
  assert.equal(await count('select 1 from public.roll_call where id=$1',[copy]),1);
 }finally{await db.close();}
});

test('real PostgreSQL: a speech score waits for the held speech start that creates its speech',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,one,count,ops,verify}=f;
 try{
  const [pv]=delegates;
  await send(roll(present(pv)),now);
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(230);await verify(dev,now-10*M);await verify(dev,now);
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  // Started offline, reconnected after the staleness limit: the start is held, so the score that follows must be held too.
  const start=await send({type:'speechStart',...f.c,delegateId:pv,resolutionId:ids.resolution,classification:'Other',_device:{deviceId:dev,deviceSeq:1}},now-10*M,'chair',chair,crypto.randomUUID(),'empty');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[start])).reason,'stale');
  const speechId=start.slice(0,24)+'000000000001';
  const score=await send({type:'speechScore',...f.c,speechId,points:3,_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),'1');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[score])).reason,'behind_held');
  assert.equal(await count('select 1 from public.speeches where id=$1',[speechId]),0);
  await assert.rejects(()=>decide(score),/Decide the earlier held action/);
  await decide(start);await decide(score);
  assert.equal(await count(`select 1 from public.participation_events where "speechId"=$1`,[speechId]),1,'the score was recorded against the approved speech');
 }finally{await db.close();}
});

test('real PostgreSQL: a POI score waits for the held recognition of its entry; the Executive snapshot carries each committee\'s live roll call',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,one,count,ops,verify,asOwner,query}=f;
 try{
  const [pv,asker]=delegates;
  // The roll call predates the (backdated) offline actions below, so it is the one in force for them.
  const rollDev=U(241);await verify(rollDev,now-20*M);
  await send(roll(present(pv,asker),{committed:now-20*M,device:rollDev,seq:1}),now-20*M);
  const speechKey=await send({type:'speechStart',...f.c,delegateId:pv,resolutionId:ids.resolution,classification:'Other'},now,'chair',chair,crypto.randomUUID(),'empty');
  const speechId=speechKey.slice(0,24)+'000000000001';
  const rev=async()=>String((await one<{r:string}>('select revision::text r from public.speeches where id=$1',[speechId])).r);
  await send({type:'poiAllowance',...f.c,speechId,limit:2},now,'chair',chair,crypto.randomUUID(),await rev());
  const addKey=await send({type:'poiAdd',...f.c,speechId,delegateId:asker},now,'chair',chair,crypto.randomUUID(),await rev());
  const entryId=addKey.slice(0,24)+'000000000001';
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(240);await verify(dev,now-10*M);await verify(dev,now);
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  // Recognised offline and held as stale; the score of that POI must be held with it.
  const r0=await rev();
  const recognize=await send({type:'poiRecognize',...f.c,speechId,entryId,_device:{deviceId:dev,deviceSeq:1}},now-10*M,'chair',chair,crypto.randomUUID(),r0);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[recognize])).reason,'stale');
  const score=await send({type:'poiScore',...f.c,speechId,entryId,points:2,_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),String(Number(r0)+1));
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[score])).reason,'behind_held');
  await assert.rejects(()=>decide(score),/Decide the earlier held action/);
  await decide(recognize);
  await decide(score);
  assert.equal(await count(`select 1 from public.participation_events where "speechId"=$1 and "categoryId"='poi'`,[speechId]),1,'the POI score was recorded');

  // The Executive snapshot holds one live roll call per committee, with its rows, for the readiness view.
  await asOwner();
  const snapshot=(await query<{s:{rollCalls:{committeeId:string;rows:{delegateId:string;status:string}[]}[]}}>('select public.executive_snapshot($1) s',[ids.conference]))[0].s;
  const committees=await count('select 1 from public.roll_call where state=\'committed\' group by committee_id');
  assert.equal(snapshot.rollCalls.length,committees,'one per committee that has a roll call');
  const ga1=snapshot.rollCalls.find(r=>r.committeeId===ids.ga1)!;
  assert.deepEqual(ga1.rows.filter(r=>r.status!=='Absent').map(r=>r.delegateId).sort(),[pv,asker].sort(),'the live roll call, not an earlier one');
 }finally{await db.close();}
});

test('real PostgreSQL: a correction of an event waits for the held score that creates it',async()=>{
 const f=await fixture();const {db,now,send,delegates,roll,one,count,ops}=f;
 try{
  const [pv]=delegates;
  await send(roll(present(pv)),now);
  await ops(exec,{type:'holdSettings',enforce:true});
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  // A score recorded offline with an unverified clock (3 hours stale) is Uncertain, so it is held...
  const score=await send({type:'participation',...f.c,delegateId:pv,categoryId:'speech',points:2,resolutionId:null},now-3*H);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[score])).reason,'uncertain_time');
  const eventId=score.slice(0,24)+'000000000001';
  assert.equal(await count('select 1 from public.participation_events where id=$1',[eventId]),0);
  // ...and the edit that follows it must be held with it, not refused for a source event that does not exist yet.
  const edit=await send({type:'event',id:eventId,points:3},now,'chair',chair,crypto.randomUUID(),'0');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[edit])).reason,'behind_held');
  await assert.rejects(()=>decide(edit),/Decide the earlier held action/);
  await decide(score);await decide(edit);
  assert.equal(await count('select 1 from public.participation_corrections where event_id=$1',[eventId]),1,'the correction applied to the approved score');
  // With nothing holding it, a correction of an unknown event is still refused.
  await assert.rejects(()=>send({type:'event',id:crypto.randomUUID(),points:3},now,'chair',chair,crypto.randomUUID(),'0'),(e:{code?:string})=>e.code==='42501');
 }finally{await db.close();}
});

for(const approval of ['single','bulk'] as const)test(`real PostgreSQL: restoration waits for its held deduction through ${approval} approval`,async()=>{
 const f=await fixture();const {db,ids,now,delegates,ops,one,count,verify,as}=f;
 try{
  await ops(exec,{type:'holdSettings',enforce:true});
  const send=async(command:unknown,time:number)=>{const key=crypto.randomUUID();await as(chair);await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),'chair',null,iso(time)]);return key;};
  const sourceDevice=U(190),restoreDevice=U(191),delegateId=delegates[0];
  const deduction=await send({type:'pointAdjustment',...f.c,delegateId,action:'deduct',amount:2,reason:'Offline deduction',_device:{deviceId:sourceDevice,deviceSeq:1}},now-3*H);
  const adjustmentId=deduction.slice(0,24)+'000000000001';
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[deduction])).reason,'uncertain_time');
  await verify(restoreDevice,now);
  const restore=await send({type:'pointAdjustment',...f.c,delegateId,action:'restore',adjustmentId,_device:{deviceId:restoreDevice,deviceSeq:1}},now);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[restore])).reason,'behind_held');
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  const bulk=()=>ops(exec,{type:'heldBulkApprove',deviceId:restoreDevice,reason:'Reviewed'});
  if(approval==='single')await assert.rejects(()=>decide(restore),/Decide the earlier held action/);
  else{
   await ops(exec,{type:'clockConfirm',deviceId:restoreDevice,offsetMs:0,reason:'Clock checked'});
   await bulk();
   assert.equal((await one<{state:string}>('select state from public.held_action where id=$1',[restore])).state,'held','bulk skips an unresolved dependency on another device');
  }
  assert.equal(await count('select 1 from public.participation_adjustments'),0);
  await decide(deduction);
  if(approval==='single')await decide(restore);else await bulk();
  assert.equal(await count('select 1 from public.participation_adjustments where reverses=$1',[adjustmentId]),1);
  assert.equal((await one<{total:number}>('select sum(points)::int total from public.participation_adjustments where "delegateId"=$1',[delegateId])).total,0);
  assert.equal((await one<{state:string}>('select state from public.held_action where id=$1',[restore])).state,'applied');
  await assert.rejects(()=>send({type:'pointAdjustment',...f.c,delegateId,action:'restore',adjustmentId:crypto.randomUUID()},now),/Adjustment unavailable/);
 }finally{await db.close();}
});

for(const approval of ['single','bulk'] as const)test(`held event corrections preserve revision order through ${approval} approval`,async()=>{
 const f=await fixture();const {db,now,send,delegates,roll,ops,one,count,verify}=f;
 try{
  await send(roll(present(delegates[0])),now);
  const source=await send({type:'participation',...f.c,delegateId:delegates[0],categoryId:'speech',points:2,resolutionId:null},now);
  const id=source.slice(0,24)+'000000000001',deviceId=U(192);
  await ops(exec,{type:'holdSettings',enforce:true});
  const first=await send({type:'event',id,points:3,_device:{deviceId,deviceSeq:1}},now-3*H,'chair',chair,crypto.randomUUID(),'0');
  await verify(deviceId,now);
  const second=await send({type:'event',id,points:0,undo:true,_device:{deviceId,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),'1');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[second])).reason,'behind_held');
  const decide=(heldId:string)=>ops(exec,{type:'heldDecide',heldId,decision:'approve',reason:'Reviewed'});
  if(approval==='single'){
   await assert.rejects(()=>decide(second),/Decide the earlier held action/);
   await decide(first);await decide(second);
  }else{
   await ops(exec,{type:'clockConfirm',deviceId,offsetMs:0,reason:'Clock checked'});
   await ops(exec,{type:'heldBulkApprove',deviceId,reason:'Reviewed'});
  }
  assert.equal(await count('select 1 from public.participation_corrections where event_id=$1',[id]),2);
  assert.equal((await one<{state:string}>('select state from public.held_action where id=$1',[second])).state,'applied');
 }finally{await db.close();}
});

for(const approval of ['single','bulk'] as const)test(`counted close waits for held votes through ${approval} approval`,async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,ops,one,count,verify}=f;
 try{
  const [delegateId]=delegates;
  await send(roll(present(delegateId)),now);
  const revision=async()=>String((await one<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution])).revision);
  await send({type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural'},now,'chair',chair,crypto.randomUUID(),await revision());
  const vote={type:'vote',...f.c,resolutionId:ids.resolution,delegateId};
  await send({...vote,choice:'For'},now,'chair',chair,crypto.randomUUID(),'0');
  await ops(exec,{type:'holdSettings',enforce:true});
  const heldVote=await send({...vote,choice:'Against',_device:{deviceId:U(193),deviceSeq:1}},now-3*H,'chair',chair,crypto.randomUUID(),'1');
  const deviceId=U(194);await verify(deviceId,now);
  const close=await send({type:'document',id:ids.resolution,status:'Closed',outcome:'Failed',_device:{deviceId,deviceSeq:1}},now,'chair',chair,crypto.randomUUID(),await revision());
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[close])).reason,'behind_held');
  const decide=(heldId:string)=>ops(exec,{type:'heldDecide',heldId,decision:'approve',reason:'Reviewed'});
  if(approval==='single')await assert.rejects(()=>decide(close),/Decide the earlier held action/);
  else{
   await ops(exec,{type:'clockConfirm',deviceId,offsetMs:0,reason:'Clock checked'});
   await ops(exec,{type:'heldBulkApprove',deviceId,reason:'Reviewed'});
   assert.equal((await one<{state:string}>('select state from public.held_action where id=$1',[close])).state,'held');
  }
  assert.equal(await count(`select 1 from public.documents where id=$1 and status='In Debate'`,[ids.resolution]),1);
  await decide(heldVote);
  if(approval==='single')await decide(close);else await ops(exec,{type:'heldBulkApprove',deviceId,reason:'Reviewed'});
  assert.equal(await count(`select 1 from public.documents where id=$1 and status='Closed' and outcome='Failed'`,[ids.resolution]),1);
 }finally{await db.close();}
});

for(const approval of ['single','bulk'] as const)test(`held vote changes preserve revision order through ${approval} approval`,async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,ops,one,count,verify}=f;
 try{
  const [delegateId]=delegates;
  await send(roll(present(delegateId)),now);
  const revision=async()=>String((await one<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution])).revision);
  await send({type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural'},now,'chair',chair,crypto.randomUUID(),await revision());
  const vote={type:'vote',...f.c,resolutionId:ids.resolution,delegateId};
  await send({...vote,choice:'For'},now,'chair',chair,crypto.randomUUID(),'0');
  await ops(exec,{type:'holdSettings',enforce:true});
  const deviceId=U(194);
  // An older offline change is held for its clock; the change that follows it on the same device carries the incremented revision.
  const first=await send({...vote,choice:'Against',_device:{deviceId,deviceSeq:1}},now-3*H,'chair',chair,crypto.randomUUID(),'1');
  await verify(deviceId,now);
  const second=await send({...vote,choice:'For',_device:{deviceId,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),'2');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[second])).reason,'behind_held');
  const decide=(heldId:string)=>ops(exec,{type:'heldDecide',heldId,decision:'approve',reason:'Reviewed'});
  if(approval==='single'){
   await assert.rejects(()=>decide(second),/Decide the earlier held action/);
   await decide(first);await decide(second);
  }else{
   await ops(exec,{type:'clockConfirm',deviceId,offsetMs:0,reason:'Clock checked'});
   await ops(exec,{type:'heldBulkApprove',deviceId,reason:'Reviewed'});
  }
  const final=await one<{choice:string;revision:number}>(`select choice,revision from public.votes where "resolutionId"=$1 and "delegateId"=$2 and "sessionId" is null`,[ids.resolution,delegateId]);
  assert.equal(final.choice,'For');assert.equal(Number(final.revision),3,'both held changes applied in order');
  assert.equal((await one<{state:string}>('select state from public.held_action where id=$1',[second])).state,'applied');
 }finally{await db.close();}
});

test('real PostgreSQL: a ballot opened by approval snapshots the roll calls approved before it in the same chain',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,ops,one,verify}=f;
 try{
  const [pv]=delegates;
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(250);
  // An older offline roll call is held for its clock; the ballot restart that follows on the same device is Trusted but waits behind it.
  const rcId=crypto.randomUUID();
  const rollKey=await send(roll(present(pv),{id:rcId,committed:now-3*H,device:dev,seq:1}),now-3*H);
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[rollKey])).reason,'uncertain_time');
  // No clock report for this device (the reconnect report failed): the roll call stays Uncertain, the restart is within tolerance of its receipt.
  // The roll call is received (and so effective, once approved) after the restart's own client time.
  await new Promise(r=>setTimeout(r,1500));
  const rev=(await one<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution])).revision;
  const modeKey=await send({type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural',_device:{deviceId:dev,deviceSeq:2}},Date.now()-90_000,'chair',chair,crypto.randomUUID(),String(rev));
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[modeKey])).reason,'behind_held');
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  await decide(rollKey);await decide(modeKey);
  assert.equal((await one<{status:string}>('select status from public.ballot_eligibility where resolution_id=$1 and delegate_id=$2',[ids.resolution,pv])).status,'Present & Voting','the ballot was opened against the roll call approved just before it');
 }finally{await db.close();}
});

test('real PostgreSQL: held votes stay with the ballot they were recorded against, and a superseded one is refused on approval',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,ops,one,count,verify}=f;
 try{
  const [pv]=delegates;
  await send(roll(present(pv)),now);
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(251);await verify(dev,now-10*M);await verify(dev,now);
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  const reason=async(id:string)=>(await one<{reason:string}>('select reason from public.held_action where id=$1',[id])).reason;
  const rev=async()=>(await one<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution])).revision;
  const r0=Number(await rev());
  const mode={type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural'};
  const vote={type:'vote',...f.c,resolutionId:ids.resolution,delegateId:pv};
  // Restart, vote, restart again, replacement vote: both restarts are stale and held; the votes are Trusted.
  const restart1=await send({...mode,_device:{deviceId:dev,deviceSeq:1}},now-10*M,'chair',chair,crypto.randomUUID(),String(r0));
  const vote1=await send({...vote,choice:'Against',_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),'0');
  const restart2=await send({...mode,_device:{deviceId:dev,deviceSeq:3}},now-10*M,'chair',chair,crypto.randomUUID(),String(r0+1));
  const vote2=await send({...vote,choice:'For',_device:{deviceId:dev,deviceSeq:4}},now,'chair',chair,crypto.randomUUID(),'0');
  for(const id of [restart1,vote1,restart2,vote2])assert.equal((await one<{state:string}>('select state from public.held_action where id=$1',[id])).state,'held');
  assert.equal(await reason(restart1),'stale');assert.equal(await reason(restart2),'stale');
  // The first ballot's vote waits for its own restart only, so it can be approved before the second restart.
  await assert.rejects(()=>decide(vote1),/Decide the earlier held action/);
  await decide(restart1);await decide(vote1);
  assert.equal((await one<{choice:string}>(`select choice from public.votes where "resolutionId"=$1 and "delegateId"=$2 and "sessionId" is null`,[ids.resolution,pv])).choice,'Against');
  // The replacement vote waits for the second restart, which clears the first ballot's vote; then it is recorded fresh.
  await assert.rejects(()=>decide(vote2),/Decide the earlier held action/);
  await decide(restart2);await decide(vote2);
  const final=await one<{choice:string;revision:number}>(`select choice,revision from public.votes where "resolutionId"=$1 and "delegateId"=$2 and "sessionId" is null`,[ids.resolution,pv]);
  assert.equal(final.choice,'For');assert.equal(Number(final.revision),1,'a fresh vote in the replacement ballot');
 }finally{await db.close();}
});

test('real PostgreSQL: approving a held vote after its ballot was restarted is refused, not inserted into the replacement ballot',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,ops,one,count}=f;
 try{
  const [pv]=delegates;
  await send(roll(present(pv)),now);
  const rev=async()=>String((await one<{revision:number}>('select revision from public.documents where id=$1',[ids.resolution])).revision);
  const mode={type:'voteMode',...f.c,resolutionId:ids.resolution,mode:'normal',voteType:'procedural'};
  await send(mode,now,'chair',chair,crypto.randomUUID(),await rev());
  await ops(exec,{type:'holdSettings',enforce:true});
  // A vote recorded against the first ballot with an unverified clock is held...
  const vote1=await send({type:'vote',...f.c,resolutionId:ids.resolution,delegateId:pv,choice:'Against',_device:{deviceId:U(252),deviceSeq:1}},now-3*H,'chair',chair,crypto.randomUUID(),'0');
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[vote1])).reason,'uncertain_time');
  await new Promise(r=>setTimeout(r,50));
  // ...the ballot is restarted meanwhile...
  await send(mode,Date.now(),'chair',chair,crypto.randomUUID(),await rev());
  // ...so approving the old vote is refused and it stays held for discard.
  await ops(exec,{type:'heldDecide',heldId:vote1,decision:'approve',reason:'Reviewed'});
  const h=await one<{state:string;last_error:string}>('select state,last_error from public.held_action where id=$1',[vote1]);
  assert.equal(h.state,'held');assert.match(h.last_error,/since been restarted/);
  assert.equal(await count(`select 1 from public.votes where "resolutionId"=$1 and "sessionId" is null`,[ids.resolution]),0);
 }finally{await db.close();}
});

test('real PostgreSQL: an amendment transition waits for the held speech finish that clears the floor',async()=>{
 const f=await fixture();const {db,ids,now,send,delegates,roll,ops,one,count,verify,asOwner}=f;
 try{
  const [pv]=delegates;
  await send(roll(present(pv)),now);
  const speechKey=await send({type:'speechStart',...f.c,delegateId:pv,resolutionId:ids.resolution,classification:'Other'},now,'chair',chair,crypto.randomUUID(),'empty');
  const speechId=speechKey.slice(0,24)+'000000000001';
  await asOwner();
  const amendmentId=crypto.randomUUID();
  await db.query(`insert into public.amendments(id,conference_id,committee_id,"resolutionId","submitterId",type,clause,wording,status) values($1,$2,$3,$4,$5,'Add','1','New clause','Accepted for Debate')`,[amendmentId,ids.conference,ids.ga1,ids.resolution,ids.france]);
  const amendmentRev=(await one<{revision:number}>('select revision from public.amendments where id=$1',[amendmentId])).revision;
  const speechRev=(await one<{revision:number}>('select revision from public.speeches where id=$1',[speechId])).revision;
  await ops(exec,{type:'holdSettings',enforce:true});
  const dev=U(253);await verify(dev,now-10*M);await verify(dev,now);
  // The Chair finishes the speech offline (stale, so held), then starts the amendment debate with the floor optimistically clear.
  const finish=await send({type:'speechFinish',...f.c,speechId,_device:{deviceId:dev,deviceSeq:1}},now-10*M,'chair',chair,crypto.randomUUID(),String(speechRev));
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[finish])).reason,'stale');
  const start=await send({type:'amendmentStatus',id:amendmentId,status:'In Debate',_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,crypto.randomUUID(),String(amendmentRev));
  assert.equal((await one<{reason:string}>('select reason from public.held_action where id=$1',[start])).reason,'behind_held');
  // The outbox retries the same delivery: acknowledged again, still one held row, no error.
  await send({type:'amendmentStatus',id:amendmentId,status:'In Debate',_device:{deviceId:dev,deviceSeq:2}},now,'chair',chair,start,String(amendmentRev));
  assert.equal(await count('select 1 from public.held_action where id=$1',[start]),1);
  const decide=(id:string)=>ops(exec,{type:'heldDecide',heldId:id,decision:'approve',reason:'Reviewed'});
  await assert.rejects(()=>decide(start),/Decide the earlier held action/);
  await decide(finish);await decide(start);
  assert.equal(await count(`select 1 from public.amendments where id=$1 and status='In Debate'`,[amendmentId]),1,'the amendment debate started once the floor was clear');
 }finally{await db.close();}
});
