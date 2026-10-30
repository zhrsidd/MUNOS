import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

// Session model phase 2 (docs/SESSION_MODEL.md 12.3 and 12.4) on real PostgreSQL with every migration applied.
// Central slots sit in 2099 so every schedule version (stamped with the server clock) is already in effect for them.
const U=(n:number)=>`77000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const exec=U(1),chair=U(2),other=U(3),panel=U(4),print=U(5);
const D='2099-10-17';
const slots={S5:[`${D}T08:30:00+03:00`,`${D}T11:30:00+03:00`],S6:[`${D}T12:30:00+03:00`,`${D}T14:30:00+03:00`],S7:[`${D}T14:45:00+03:00`,`${D}T16:45:00+03:00`]} as const;

async function setup(){
 const f=await freshDatabase();
 const {db,ids,query,as,asOwner,grant}=f;
 await grant(exec,'admin');await grant(chair,'chair',ids.ga1);await grant(other,'chair',ids.who);await grant(panel,'approval');await grant(print,'logistics');
 const mutate=async(user:string,command:unknown,role='admin',key=crypto.randomUUID(),expected:string|null=null)=>{
  await as(user);
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,'2099-10-17T05:00:00Z']);return key;};
 const ops=async(user:string,command:unknown,role='admin',key=crypto.randomUUID())=>{
  await as(user);
  await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,null,'2099-10-17T05:00:00Z']);return key;};
 const slot=async(name:string,start:string,end:string|null)=>{
  await mutate(exec,{type:'sessionSlot',action:'create',name,startsAt:new Date(start).toISOString(),endsAt:end?new Date(end).toISOString():null});
  await asOwner();return (await query<{id:string}>('select id from public.conference_session_slots where name=$1 and not archived',[name]))[0].id;};
 const sessionOf=async(slotId:string,committee:string)=>{await asOwner();return (await query<{id:string}>('select id from public.sessions where "slotId"=$1 and committee_id=$2',[slotId,committee]))[0]?.id??null;};
 const at=async(committee:string,instant:string)=>{await asOwner();return (await query<{r:Record<string,unknown>}>('select private.committee_session_at($1,$2,$3::timestamptz) r',[ids.conference,committee,instant]))[0].r;};
 const versions=async(committee:string)=>{await asOwner();return query<Record<string,unknown>>('select * from public.schedule_version where committee_id=$1 order by effective_from',[committee]);};
 const S:Record<string,string>={};
 for(const [name,[a,b]] of Object.entries(slots))S[name]=await slot(name,a,b);
 return {...f,mutate,ops,slot,sessionOf,at,versions,S};
}

test('real PostgreSQL: Executive publishes a schedule version from the central slots; lead, grace and automation are configurable',async()=>{
 const {db,ids,ops,versions,at,sessionOf,S,query,asOwner}=await setup();
 try{
  await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'First publish'});
  let v=await versions(ids.ga1);
  assert.equal(v.length,1);
  assert.equal(v[0].lead_minutes,5,'lead defaults to the confirmed 5 minutes');
  assert.equal(v[0].grace_minutes,20,'grace defaults to the proposed 20 minutes');
  assert.equal(v[0].automation_enabled,true);
  const snap=v[0].sessions as {id:string;slotId:string;start:string;end:string;leadMinutes?:number}[];
  assert.deepEqual(snap.map(s=>s.slotId),[S.S5,S.S6,S.S7]);
  assert.equal(snap[1].id,await sessionOf(S.S6,ids.ga1));
  assert.equal(new Date(snap[1].start).toISOString(),new Date(`${D}T12:30:00+03:00`).toISOString());

  // The label follows the window rule: 11:45 is the break, so the previous session holds; 12:25 switches; 14:40 switches again.
  const label=async(t:string)=>(await at(ids.ga1,`${D}T${t}:00+03:00`)).sessionId;
  assert.equal(await label('08:20'),null);
  assert.equal(await label('11:45'),await sessionOf(S.S5,ids.ga1));
  assert.equal(await label('12:25'),await sessionOf(S.S6,ids.ga1));
  assert.equal(await label('14:40'),await sessionOf(S.S7,ids.ga1));
  assert.equal(await label('17:05'),null);
  assert.equal((await at(ids.ga1,`${D}T17:10:00+03:00`)).flag,'outside_schedule');

  // Configurable: lead 15 / grace 0, one slot with its own lead. Versions are immutable and only append.
  await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,leadMinutes:15,graceMinutes:0,automationEnabled:true,slotLeads:{[S.S6]:10},reason:'Longer lead'});
  v=await versions(ids.ga1);
  assert.equal(v.length,2);
  assert.ok(new Date(v[1].effective_from as string)>new Date(v[0].effective_from as string),'effective_from strictly increases');
  assert.equal((v[1].sessions as {leadMinutes?:number}[])[1].leadMinutes,10);
  assert.equal((await at(ids.ga1,`${D}T12:19:00+03:00`)).sessionId,await sessionOf(S.S5,ids.ga1),'S6 per-slot lead 10 switches at 12:20');
  assert.equal((await at(ids.ga1,`${D}T12:20:00+03:00`)).sessionId,await sessionOf(S.S6,ids.ga1));
  assert.equal((await at(ids.ga1,`${D}T16:45:00+03:00`)).sessionId,null,'grace 0 closes at the scheduled end');

  // Whole conference: one version per active committee, together.
  await ops(exec,{type:'scheduleVersion',reason:'All committees'});
  await asOwner();
  const per=await query<{n:number}>('select count(*)::int n from public.schedule_version where reason=$1',['All committees']);
  const active=await query<{n:number}>('select count(*)::int n from public.committees where conference_id=$1 and not archived',[ids.conference]);
  assert.equal(per[0].n,active[0].n);
  assert.ok(active[0].n>1);
 }finally{await db.close();}
});

test('real PostgreSQL: a rejected publish writes nothing; the audit log and receipts follow the existing contract',async()=>{
 const {db,ids,ops,mutate,slot,versions,query,asOwner}=await setup();
 try{
  const count=async()=>{await asOwner();return Number((await query<{n:number}>('select count(*)::int n from public.schedule_version',[]))[0].n);};
  const bad=await slot('No end time',`${D}T18:00:00+03:00`,null);
  await assert.rejects(()=>ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'x'}),/needs an end time/);
  assert.equal(await count(),0,'a central session without an end blocks the publish and nothing is written');
  await asOwner();const revision=String((await query<{r:string}>('select revision::text r from public.conference_session_slots where id=$1',[bad]))[0].r);
  await mutate(exec,{type:'sessionSlot',id:bad,action:'archive'},'admin',crypto.randomUUID(),revision);
  await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'Archived slot is excluded'});
  assert.equal(await count(),1);
  const before=await count();
  await assert.rejects(()=>ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,leadMinutes:-1,reason:'x'}),/negative_lead/);
  await assert.rejects(()=>ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,graceMinutes:-1,reason:'x'}),/negative_grace/);
  await assert.rejects(()=>ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'  '}),/reason is required/);
  await assert.rejects(()=>ops(exec,{type:'scheduleVersion',committeeId:'00000000-0000-4000-8000-00000000dead',reason:'x'}),/Committee unavailable/);
  assert.equal(await count(),before,'every rejection leaves the table unchanged');
  await asOwner();
  const audit=await query<{action:string}>(`select action from public.audit_log where action like 'scheduleVersion%'`,[]);
  assert.equal(audit.length,1,'the successful publish is audited once');
  assert.equal((await versions(ids.ga1)).length,1);
 }finally{await db.close();}
});

test('real PostgreSQL: only the Executive can run schedule commands; replays are idempotent; payload reuse is rejected',async()=>{
 const {db,ids,ops,versions,S}=await setup();
 try{
  const commands:Record<string,unknown>[]=[
   {type:'scheduleVersion',committeeId:ids.ga1,reason:'x'},
   {type:'automationToggle',committeeId:ids.ga1,enabled:false,reason:'x'},
   {type:'overrideSet',scope:'conference',slotId:S.S5},
   {type:'labelCorrection',recordTable:'speeches',recordId:U(900),label:null,reason:'x'},
   {type:'clockConfirm',deviceId:U(901),offsetMs:1000,reason:'x'},
  ];
  for(const c of commands)for(const [user,role] of [[chair,'chair'],[chair,'admin'],[other,'chair'],[panel,'approval'],[print,'logistics']] as const)
   await assert.rejects(()=>ops(user,c,role),(e:{code?:string})=>e.code==='42501',`${String(c.type)} as ${role} (${user})`);
  assert.equal((await versions(ids.ga1)).length,0);

  const key=await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'Replay'});
  await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'Replay'},'admin',key);
  assert.equal((await versions(ids.ga1)).length,1,'the same key and payload acknowledges without a second version');
  await assert.rejects(()=>ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'Different'},'admin',key),/Idempotency key reused/);
  assert.equal((await versions(ids.ga1)).length,1);
 }finally{await db.close();}
});

test('real PostgreSQL: schedule tables are read-only to API roles and append-only for everyone',async()=>{
 const {db,ids,ops,as,asOwner,asServer,query}=await setup();
 try{
  await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,reason:'Seed'});
  const tables=['schedule_version','session_override','session_override_end','roll_call','roll_call_row','record_label','label_correction','held_action','device_clock_sync','clock_confirmation'];
  for(const t of tables){
   await as(exec);
   await assert.rejects(()=>db.query(`insert into public.${t} select * from public.${t} where false`),/permission denied/,`${t}: no INSERT for authenticated`);
   await assert.rejects(()=>db.query(`update public.${t} set conference_id=conference_id where false`),/permission denied/,`${t}: no UPDATE`);
   await assert.rejects(()=>db.query(`delete from public.${t} where false`),/permission denied/,`${t}: no DELETE`);
   await asServer();
   await assert.rejects(()=>db.query(`select 1 from public.${t} limit 1`),/permission denied/,`${t}: service_role has no privilege`);
  }
  await as(exec);
  assert.equal((await db.query('select 1 from public.schedule_version')).rows.length,1,'the Executive reads versions');
  await as(chair);
  assert.equal((await db.query('select 1 from public.schedule_version')).rows.length,1,'a Chair reads their committee versions');
  await as(other);
  assert.equal((await db.query('select 1 from public.schedule_version')).rows.length,0,'another committee Chair does not');
  await asOwner();
  await assert.rejects(()=>db.query(`update public.schedule_version set reason='rewritten'`),/append-only/);
  await assert.rejects(()=>db.query(`delete from public.schedule_version`),/append-only/);
  await assert.rejects(()=>db.query(`truncate public.schedule_version`),/append-only/);
  assert.equal((await query<{reason:string}>('select reason from public.schedule_version',[]))[0].reason,'Seed');
 }finally{await db.close();}
});

test('real PostgreSQL: overrides - committee expiry is stored at creation; a conference override names a slot and each committee resolves its own session',async()=>{
 const {db,ids,ops,at,sessionOf,S,query,asOwner}=await setup();
 try{
  await ops(exec,{type:'scheduleVersion',reason:'All'});
  await asOwner();
  // Committee override set now, automation on: it expires at the next scheduled switch (08:25 on the 17th, the first window).
  const mid=crypto.randomUUID();
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.ga1,sessionId:await sessionOf(S.S7,ids.ga1)},'admin',mid);
  await asOwner();
  const row=(await query<{id:string;expires_at:string;set_at:string;slot_id:string|null}>('select id,expires_at,set_at,slot_id from public.session_override where committee_id=$1',[ids.ga1]))[0];
  assert.equal(row.id,mid.slice(0,24)+'000000000001','the override id is the command id, so a replay cannot add another');
  assert.equal(new Date(row.expires_at).toISOString(),new Date(`${D}T08:25:00+03:00`).toISOString());
  const whoS7=await sessionOf(S.S7,ids.who);
  await assert.rejects(()=>ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.ga1,sessionId:whoS7}),/Session unavailable/,'a session of another committee');
  await assert.rejects(()=>ops(exec,{type:'overrideSet',scope:'conference',slotId:S.S5,committeeId:ids.ga1}),/names one central slot/);
  await assert.rejects(()=>ops(exec,{type:'overrideSet',scope:'galaxy'}),/scope invalid/);

  // Conference override on slot S6 at 2099-10-17 12:00 local (owner-inserted so the instant is in the schedule's year).
  await asOwner();
  const kid=U(5000);
  const ga1S6=await sessionOf(S.S6,ids.ga1),whoS6=await sessionOf(S.S6,ids.who);
  // The captured mapping: GA1 had its S6 session; WHO had none in the slot.
  await db.query(`insert into public.session_override(id,conference_id,scope,slot_id,targets,set_by,set_at) values($1,$2,'conference',$3,$4::jsonb,$5,$6)`,
   [kid,ids.conference,S.S6,JSON.stringify({[ids.ga1]:ga1S6,[ids.who]:null}),exec,`${D}T12:00:00+03:00`]);
  assert.equal((await at(ids.ga1,`${D}T12:10:00+03:00`)).sessionId,ga1S6,'GA1 shows its own S6 session');
  const none=await at(ids.who,`${D}T12:10:00+03:00`);
  assert.equal(none.sessionId,null);assert.equal(none.flag,'no_session');assert.equal(none.source,'override');
  assert.notEqual(whoS6,null,'WHO does have an S6 session now: the override still shows none, because the mapping was captured when it was set');
  // The conference override ends for each committee at its own next switch (12:25 with the default lead).
  assert.equal((await at(ids.ga1,`${D}T12:25:00+03:00`)).source,'schedule');
  // A committee override beats it.
  await db.query(`insert into public.session_override(id,conference_id,scope,committee_id,session_id,set_by,set_at,expires_at) values($1,$2,'committee',$3,$4,$5,$6,$7)`,
   [U(5001),ids.conference,ids.ga1,await sessionOf(S.S7,ids.ga1),exec,`${D}T12:05:00+03:00`,`${D}T12:25:00+03:00`]);
  assert.equal((await at(ids.ga1,`${D}T12:10:00+03:00`)).sessionId,await sessionOf(S.S7,ids.ga1));
 }finally{await db.close();}
});

test('real PostgreSQL: automation toggle is a new version; enabling ends manual overrides in scope without rewriting them',async()=>{
 const {db,ids,ops,versions,sessionOf,S,query,asOwner}=await setup();
 try{
  await ops(exec,{type:'scheduleVersion',reason:'All'});
  await assert.rejects(()=>ops(exec,{type:'automationToggle',enabled:true}),/reason is required/);
  await ops(exec,{type:'automationToggle',committeeId:ids.ga1,enabled:false,reason:'Manual running'});
  let v=await versions(ids.ga1);
  assert.equal(v.length,2);assert.equal(v[1].automation_enabled,false);
  assert.deepEqual(v[1].sessions,v[0].sessions,'a toggle copies the latest snapshot');
  assert.equal(v[1].lead_minutes,v[0].lead_minutes);

  // Off: an override has no scheduled expiry (the midnight cap applies when it is resolved).
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.ga1,sessionId:await sessionOf(S.S5,ids.ga1)});
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.who,sessionId:await sessionOf(S.S5,ids.who)});
  await asOwner();
  const rows=await query<{committee_id:string;expires_at:string|null}>('select committee_id,expires_at from public.session_override order by committee_id',[]);
  assert.equal(rows.find(r=>r.committee_id===ids.ga1)!.expires_at,null);

  // Toggling off again is a no-op; enabling for GA1 ends only GA1's override, at the new version's instant.
  await ops(exec,{type:'automationToggle',committeeId:ids.ga1,enabled:false,reason:'Again'});
  assert.equal((await versions(ids.ga1)).length,2);
  await ops(exec,{type:'automationToggle',committeeId:ids.ga1,enabled:true,reason:'Back to schedule'});
  v=await versions(ids.ga1);
  assert.equal(v.length,3);
  await asOwner();
  const ended=await query<{committee_id:string;ended_at:string;ended_reason:string}>('select o.committee_id,e.ended_at,e.ended_reason from public.session_override_end e join public.session_override o on o.id=e.override_id',[]);
  assert.equal(ended.length,1);assert.equal(ended[0].committee_id,ids.ga1);assert.equal(ended[0].ended_reason,'automation_enabled');
  assert.equal(new Date(ended[0].ended_at).toISOString(),new Date(v[2].effective_from as string).toISOString());
  assert.equal((await query('select 1 from public.session_override',[])).length,2,'the original rows are never rewritten or removed');

  // Whole-conference enable ends the rest, including conference-scope overrides.
  await ops(exec,{type:'overrideSet',scope:'conference',slotId:S.S6});
  await ops(exec,{type:'automationToggle',committeeId:ids.who,enabled:false,reason:'WHO manual'});
  await ops(exec,{type:'automationToggle',enabled:true,reason:'Everything back to the schedule'});
  await asOwner();
  const open=await query<{n:number}>('select count(*)::int n from public.session_override o where not exists(select 1 from public.session_override_end e where e.override_id=o.id)',[]);
  assert.equal(open[0].n,0);
  await assert.rejects(()=>ops(exec,{type:'automationToggle',committeeId:ids.who,enabled:'maybe',reason:'x'}),()=>true);
 }finally{await db.close();}
});

test('real PostgreSQL: label correction is an explicit record - corrected to no session is distinct from no correction; clock confirmation needs a known device',async()=>{
 const {db,ids,ops,sessionOf,S,query,asOwner}=await setup();
 try{
  const ga1S5=await sessionOf(S.S5,ids.ga1),ga1S6=await sessionOf(S.S6,ids.ga1),whoS5=await sessionOf(S.S5,ids.who);
  const rid=U(700);
  await asOwner();
  await db.query(`insert into public.record_label(record_table,record_id,conference_id,committee_id,displayed_label,assigned_label) values('speeches',$1,$2,$3,$4,$4)`,[rid,ids.conference,ids.ga1,ga1S5]);
  const final=async()=>{await asOwner();return (await query<{f:string|null}>(`select private.final_label('speeches',$1) f`,[rid]))[0].f;};
  assert.equal(await final(),ga1S5,'no correction: the assigned label');
  await ops(exec,{type:'labelCorrection',recordTable:'speeches',recordId:rid,label:ga1S6,reason:'Chair confirmed it was S6'});
  assert.equal(await final(),ga1S6);
  await new Promise(r=>setTimeout(r,5));
  await ops(exec,{type:'labelCorrection',recordTable:'speeches',recordId:rid,label:null,reason:'Outside any session'});
  assert.equal(await final(),null,'corrected to no session: null, not a fall-back to the assigned label');
  await asOwner();
  assert.equal((await query('select 1 from public.label_correction where record_id=$1',[rid])).length,2,'both corrections are retained');
  await assert.rejects(()=>ops(exec,{type:'labelCorrection',recordTable:'speeches',recordId:rid,label:whoS5,reason:'x'}),/Session unavailable/,'another committee session');
  await assert.rejects(()=>ops(exec,{type:'labelCorrection',recordTable:'speeches',recordId:rid,reason:'x'}),/label must be/);
  await assert.rejects(()=>ops(exec,{type:'labelCorrection',recordTable:'speeches',recordId:U(701),label:null,reason:'x'}),/Record unavailable/);

  const device=U(800);
  await assert.rejects(()=>ops(exec,{type:'clockConfirm',deviceId:device,offsetMs:90000,reason:'Slow tablet'}),/Device unavailable/);
  await asOwner();
  await db.query(`insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values($1,$2,$3,'2099-10-17',90000)`,[ids.conference,device,chair]);
  await ops(exec,{type:'clockConfirm',deviceId:device,offsetMs:90000,reason:'Slow tablet'});
  await assert.rejects(()=>ops(exec,{type:'clockConfirm',deviceId:device,offsetMs:864000000,reason:'x'}),/within one day/);
  await asOwner();
  assert.equal((await query('select 1 from public.clock_confirmation where device_id=$1',[device])).length,1);
 }finally{await db.close();}
});

test('real PostgreSQL: a conference override keeps the mapping it was set with; archiving a slot or session never changes a historical assignment',async()=>{
 const {db,ids,ops,mutate,at,sessionOf,S,query,asOwner}=await setup();
 try{
  await ops(exec,{type:'scheduleVersion',reason:'All'});
  const key=await ops(exec,{type:'overrideSet',scope:'conference',slotId:S.S6});
  await asOwner();
  const row=(await query<{set_at:string;targets:Record<string,string|null>}>('select set_at,targets from public.session_override where id=$1',[key.slice(0,24)+'000000000001']))[0];
  const ga1S6=await sessionOf(S.S6,ids.ga1);
  assert.equal(row.targets[ids.ga1],ga1S6,'every active committee is captured at creation');
  assert.ok(Object.keys(row.targets).length>=2);
  const instant=new Date(new Date(row.set_at).getTime()+1000).toISOString();
  assert.equal((await at(ids.ga1,instant)).sessionId,ga1S6);
  await asOwner();
  const revision=String((await query<{r:string}>('select revision::text r from public.conference_session_slots where id=$1',[S.S6]))[0].r);
  await mutate(exec,{type:'sessionSlot',id:S.S6,action:'archive'},'admin',crypto.randomUUID(),revision);
  const after=await at(ids.ga1,instant);
  assert.equal(after.sessionId,ga1S6,'the same historical instant resolves to the same session after the slot is archived');
  assert.equal(after.source,'override');
  // A committee created after the override was set is not covered by it.
  await asOwner();
  const newer=crypto.randomUUID();
  await db.query(`insert into public.committees(id,conference_id,code,name,room) values($1,$2,'NEW','Newer','R9')`,[newer,ids.conference]);
  assert.equal((await at(newer,instant)).source,'none');
 }finally{await db.close();}
});

test('real PostgreSQL: turning automation on always ends the overrides in scope - by publishing a version, by toggling, and for committees already on',async()=>{
 const {db,ids,ops,sessionOf,S,query,asOwner}=await setup();
 try{
  const open=async()=>{await asOwner();return (await query<{committee_id:string}>('select committee_id from public.session_override o where not exists(select 1 from public.session_override_end e where e.override_id=o.id) order by committee_id',[])).map(r=>r.committee_id);};
  await ops(exec,{type:'scheduleVersion',reason:'All'});
  await ops(exec,{type:'automationToggle',committeeId:ids.ga1,enabled:false,reason:'Manual'});
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.ga1,sessionId:await sessionOf(S.S5,ids.ga1)});
  assert.deepEqual(await open(),[ids.ga1]);

  // 1. Publishing a version with automation on ends it.
  await ops(exec,{type:'scheduleVersion',committeeId:ids.ga1,automationEnabled:true,reason:'Republish with automation'});
  assert.deepEqual(await open(),[],'a published version that turns automation on ends the committee override');
  await asOwner();
  const e=(await query<{ended_reason:string;ended_at:string}>('select ended_reason,ended_at from public.session_override_end',[]))[0];
  const latest=(await query<{t:string}>('select max(effective_from) t from public.schedule_version where committee_id=$1',[ids.ga1]))[0].t;
  assert.equal(e.ended_reason,'automation_enabled');assert.equal(new Date(e.ended_at).toISOString(),new Date(latest).toISOString());

  // 2. Whole-conference enable also ends overrides in committees that were already on, and conference-scope overrides.
  await ops(exec,{type:'automationToggle',committeeId:ids.ga1,enabled:false,reason:'GA1 manual'});
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.ga1,sessionId:await sessionOf(S.S5,ids.ga1)});
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.who,sessionId:await sessionOf(S.S5,ids.who)});
  await ops(exec,{type:'overrideSet',scope:'conference',slotId:S.S7});
  assert.equal((await open()).length,3);
  await ops(exec,{type:'automationToggle',enabled:true,reason:'Everything back to the schedule'});
  assert.deepEqual(await open(),[],'WHO was already on and GA1 was off: both overrides and the conference override end');

  // 3. Enabling a committee that is already on ends its own override too, and writes no new version.
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.who,sessionId:await sessionOf(S.S6,ids.who)});
  await asOwner();
  const before=Number((await query<{n:number}>('select count(*)::int n from public.schedule_version where committee_id=$1',[ids.who]))[0].n);
  await ops(exec,{type:'automationToggle',committeeId:ids.who,enabled:true,reason:'Back to schedule'});
  assert.deepEqual(await open(),[]);
  await asOwner();
  assert.equal(Number((await query<{n:number}>('select count(*)::int n from public.schedule_version where committee_id=$1',[ids.who]))[0].n),before);
  // Publishing with automation off never ends anything.
  await ops(exec,{type:'overrideSet',scope:'committee',committeeId:ids.who,sessionId:await sessionOf(S.S5,ids.who)});
  await ops(exec,{type:'scheduleVersion',committeeId:ids.who,automationEnabled:false,reason:'Manual mode'});
  assert.deepEqual(await open(),[ids.who]);
 }finally{await db.close();}
});

test('real PostgreSQL: roll calls follow the attendance boundary - Approval Panel and Logistics cannot read delegates\' statuses',async()=>{
 const {db,ids,as,asOwner,grant}=await setup();
 try{
  const observer=U(6);await grant(observer,'observer');
  await asOwner();
  const del=(await db.query<{id:string}>('select id from public.delegates where committee_id=$1 limit 1',[ids.ga1])).rows[0].id;
  const rc=U(7000);
  await db.query(`insert into public.roll_call(id,revision,conference_id,committee_id,state,observed_at,local_committed_at,server_committed_at,time_confidence,effective_at,created_by) values($1,1,$2,$3,'committed',now(),now(),now(),'trusted',now(),$4)`,[rc,ids.conference,ids.ga1,exec]);
  await db.query(`insert into public.roll_call_row(roll_call_id,revision,conference_id,committee_id,delegate_id,status) values($1,1,$2,$3,$4,'Present & Voting')`,[rc,ids.conference,ids.ga1,del]);
  for(const [user,table,expected] of [[exec,'roll_call',1],[chair,'roll_call',1],[observer,'roll_call',1],[panel,'roll_call',0],[print,'roll_call',0],[other,'roll_call',0],
                                      [exec,'roll_call_row',1],[chair,'roll_call_row',1],[observer,'roll_call_row',1],[panel,'roll_call_row',0],[print,'roll_call_row',0],[other,'roll_call_row',0]] as const){
   await as(user);
   assert.equal((await db.query(`select 1 from public.${table} where ${table==='roll_call'?'id':'roll_call_id'}=$1`,[rc])).rows.length,expected,`${table} as ${user}`);
  }
  // The attendance boundary it must match.
  await as(panel);assert.equal((await db.query('select 1 from public.attendance')).rows.length,0);
  await as(print);assert.equal((await db.query('select 1 from public.attendance')).rows.length,0);
 }finally{await db.close();}
});

test('real PostgreSQL: a bulk change takes one instant - every version and every override ending share it, and resolving exactly then gives the schedule',async()=>{
 const {db,ids,ops,at,sessionOf,S,query,asOwner}=await setup();
 try{
  const run=async(bulk:Record<string,unknown>)=>{
   await ops(exec,{type:'scheduleVersion',reason:'All'});
   for(const c of [ids.ga1,ids.who]){
    await ops(exec,{type:'automationToggle',committeeId:c,enabled:false,reason:'Manual'});
    await ops(exec,{type:'overrideSet',scope:'committee',committeeId:c,sessionId:await sessionOf(S.S5,c)});
   }
   await ops(exec,{type:'overrideSet',scope:'conference',slotId:S.S6});
   await ops(exec,bulk);
   await asOwner();
   const latest=await query<{committee_id:string;t:string}>('select distinct on (committee_id) committee_id,effective_from t from public.schedule_version where reason=$1 order by committee_id,effective_from desc',['Bulk enable']);
   const instants=new Set(latest.map(r=>new Date(r.t).getTime()));
   assert.equal(latest.length,2,'GA1 and WHO were off, so only they changed state');
   assert.equal(instants.size,1,'one effective_from for every committee in the bulk change');
   const eff=[...instants][0];
   const ends=await query<{t:string}>('select ended_at t from public.session_override_end',[]);
   assert.ok(ends.length>=3);
   assert.deepEqual([...new Set(ends.map(r=>new Date(r.t).getTime()))],[eff],'every override ends at that same instant');
   for(const c of [ids.ga1,ids.who]){
    assert.equal((await at(c,new Date(eff-1).toISOString())).source,'override','one millisecond earlier the manual override still applies');
    assert.equal((await at(c,new Date(eff).toISOString())).source,'schedule','exactly at the instant the schedule applies');
   }
  };
  await run({type:'automationToggle',enabled:true,reason:'Bulk enable'});
 }finally{await db.close();}
});

test('real PostgreSQL: bulk schedule publication takes one instant for its versions and the override endings it causes',async()=>{
 const {db,ids,ops,at,sessionOf,S,query,asOwner}=await setup();
 try{
  await ops(exec,{type:'scheduleVersion',reason:'All'});
  for(const c of [ids.ga1,ids.who]){
   await ops(exec,{type:'automationToggle',committeeId:c,enabled:false,reason:'Manual'});
   await ops(exec,{type:'overrideSet',scope:'committee',committeeId:c,sessionId:await sessionOf(S.S5,c)});
  }
  await ops(exec,{type:'scheduleVersion',automationEnabled:true,reason:'Bulk publish'});
  await asOwner();
  const rows=await query<{committee_id:string;t:string}>(`select committee_id,effective_from t from public.schedule_version where reason='Bulk publish'`,[]);
  assert.ok(rows.length>2);
  const eff=new Set(rows.map(r=>new Date(r.t).getTime()));
  assert.equal(eff.size,1,'one effective_from for every committee in the bulk publication');
  const ends=await query<{t:string}>('select ended_at t from public.session_override_end',[]);
  assert.equal(ends.length,2);
  assert.deepEqual([...new Set(ends.map(r=>new Date(r.t).getTime()))],[...eff]);
  const t=[...eff][0];
  for(const c of [ids.ga1,ids.who]){
   assert.equal((await at(c,new Date(t-1).toISOString())).source,'override');
   assert.equal((await at(c,new Date(t).toISOString())).source,'schedule');
  }
 }finally{await db.close();}
});
