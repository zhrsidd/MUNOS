import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFixture,fixtureJson} from '../scripts/rehearsal/fixture';
import {resolveChairMapping,identityModeOf,type ChairIdentity,type MultiCommitteeFile,type LegacyScopedFile} from '../scripts/rehearsal/identities';
import {assignChair,assessReadiness,readinessVerdict,checkSingleLinkSubmissions,plannedSubmissions,DOCUMENTED_SUBMIT_FRACTION,MAX_SINGLE_LINK_SUBMISSIONS,RESOLUTION_LINK_LIMIT_PER_10_MIN,type ChairTraffic} from '../scripts/rehearsal/readiness';
import {evaluate,report} from '../scripts/rehearsal/metrics';
import {buildScenario,recipients,type SimUser} from '../scripts/rehearsal/scenario';
import {planPool,checkPoolDir,MAX_NEW_SIGN_INS_PER_RUN} from '../scripts/rehearsal/identity-pool';
import {freshDatabase} from './helpers/database';
import {fingerprint} from '../lib/sync/repository';
import type {ConferenceData} from '../lib/domain';

const N=14;
const conference='22222222-2222-4222-8222-222222222222';
const user=(prefix:string,i:number)=>`${prefix}000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const chairUsers=Array.from({length:N},(_,i)=>user('c1',i));
const support={approval:user('a1',1),admins:user('a2',2),executive:user('a3',3)};
const multi=()=>buildFixture({mode:'multi-committee',conference,committees:N,delegates:N*30,grantHours:3,users:{chairs:chairUsers,...support}});
const chairIdentities=(f:ReturnType<typeof multi>):ChairIdentity[]=>chairUsers.map((u,i)=>({userId:u,token:`token-${i}`,committee:f.committees[i].id,index:i}));
const multiFile=(f:ReturnType<typeof multi>,chairs=N):MultiCommitteeFile=>({mode:'multi-committee',chairs:Array.from({length:chairs},(_,i)=>({session:`.test-sessions/rehearsal/chair-${i}.json`,committee:f.committees[i]?.id})),approval:{session:'a'},admins:{session:'b'},executive:{session:'c'}});
const grantsOf=(sql:string)=>sql.slice(sql.indexOf('insert into public.user_access')).split('\n').filter(l=>l.startsWith(' ('));

test('realistic fixture: 14 real committees, 14 normal sessions, 14 distinct Chair grants, chair k → committee k, no floors',()=>{
 const f=multi(),g=multi();
 assert.deepEqual(f,g,'deterministic for one conference id');
 assert.equal(f.mode,'multi-committee');
 assert.equal(new Set(f.committees.map(c=>c.id)).size,N,'14 distinct committee ids');
 assert.equal(new Set(f.committees.map(c=>c.session)).size,N,'14 distinct normal session ids');
 assert.deepEqual(f.floors,[],'no synthetic floor sessions');
 assert.equal((f.sql.match(/'active'\)/g)??[]).length,N,'exactly one session row per committee');
 assert.doesNotMatch(f.sql,/Simulation floor/);
 assert.equal(f.chairGrants.length,N,'14 Chair identity mappings');
 f.chairGrants.forEach((grant,k)=>assert.deepEqual(grant,{user:chairUsers[k],committee:f.committees[k].id,committeeIndex:k}));
 const chairRows=grantsOf(f.sql).filter(l=>l.includes("'chair'"));
 assert.equal(chairRows.length,N,'14 Chair grants in the SQL');
 chairRows.forEach((row,k)=>assert.ok(row.includes(`'${chairUsers[k]}','chair','${f.committees[k].id}'`),`grant ${k} → committee ${k}`));
 assert.equal(new Set(chairRows.map(r=>r.match(/'chair','([0-9a-f-]{36})'/)![1])).size,N,'each grant points at a different committee');
 assert.equal(grantsOf(f.sql).length,N+3,'plus one Approval, Admins and Executive grant');
 assert.ok(!/auth\.|service_role|sb_secret|access_token|refresh_token/i.test(f.sql),'never touches Auth or embeds credentials');
});

test('realistic fixture refuses fewer or duplicate Chair users (no readiness substitution)',()=>{
 assert.throws(()=>buildFixture({mode:'multi-committee',conference,committees:N,delegates:10,grantHours:3,users:{chairs:chairUsers.slice(0,1),...support}}),/one Chair user per committee/);
 assert.throws(()=>buildFixture({mode:'multi-committee',conference,committees:N,delegates:10,grantHours:3,users:{chairs:Array(N).fill(chairUsers[0]),...support}}),/DISTINCT Chair users/);
});

test('runtime mapping: Chair devices of committee k use Chair identity k, committee k and its own session',()=>{
 const f=multi();const chairs=chairIdentities(f);
 const mapping=resolveChairMapping(multiFile(f),f.committees,chairUsers);
 assert.deepEqual(mapping,Array.from({length:N},(_,k)=>k));
 const users=buildScenario({staff:50,minutes:10,committees:N,seed:9});
 const chairDevices=users.filter(u=>u.role==='chair');
 for(const u of chairDevices){
  const a=assignChair(u,{mode:'realistic-multi-committee',committees:f.committees,chairs,mapping});
  assert.equal(a.chairIndex,u.committee);assert.equal(a.identity.userId,chairUsers[u.committee]);
  assert.equal(a.committee.id,f.committees[u.committee].id);assert.equal(a.committee.session,f.committees[u.committee].session);
 }
 const inThree=chairDevices.filter(u=>u.committee===3);
 assert.ok(inThree.length>=2,'scenario has several Chair devices in committee 3');
 assert.equal(new Set(inThree.map(u=>assignChair(u,{mode:'realistic-multi-committee',committees:f.committees,chairs,mapping}).identity.userId)).size,1,'devices in the same committee share that committee\'s identity');
 const traffic:ChairTraffic[]=chairDevices.map(u=>{const a=assignChair(u,{mode:'realistic-multi-committee',committees:f.committees,chairs,mapping});return {committeeId:a.committee.id,committeeCode:a.committee.code,identity:a.identity.userId};});
 const r=assessReadiness({mode:'realistic-multi-committee',committees:f.committees,chairTraffic:traffic});
 assert.equal(r.label,'READINESS RUN');assert.deepEqual(r.reasons,[]);
 assert.equal(r.actualCommitteesWithChairTraffic,N);assert.equal(r.distinctChairIdentities,N);assert.equal(r.chairDevices,chairDevices.length);
 assert.ok(r.committees.every(c=>c.chairIdentities===1&&c.chairDevices>=1),'committee → exactly one Chair identity');
 assert.ok(readinessVerdict({pass:true,checks:[]},r).pass,'a qualifying run can pass when its metrics pass');
});

test('Chair scope is enforced by RLS: committee 3\'s identity writes its own committee and cannot touch committee 4',async()=>{
 const f=multi();const {db,query,as,asOwner}=await freshDatabase();
 try{
  await asOwner();
  for(const u of [...chairUsers,support.approval,support.admins,support.executive])await query('insert into auth.users(id) values($1)',[u]);
  await db.exec(f.sql);
  assert.equal((await query<{n:number}>("select count(distinct committee_id)::int n from public.user_access where conference_id=$1 and role='chair'",[conference]))[0].n,N,'14 committee-scoped Chair grants');
  assert.equal((await query<{n:number}>('select count(*)::int n from public.sessions where conference_id=$1',[conference]))[0].n,N,'14 normal sessions');
  const [c3,c4]=[f.committees[3],f.committees[4]];
  const delegateOf=async(committee:string)=>(await query<{id:string}>('select id from public.delegates where committee_id=$1 order by id limit 1',[committee]))[0].id;
  const [d3,d4]=[await delegateOf(c3.id),await delegateOf(c4.id)];
  await as(chairUsers[3]);
  const snapshot=async()=>(await query<{s:ConferenceData}>('select public.conference_state_snapshot($1) s',[conference]))[0].s;
  const mine=await snapshot();
  assert.ok(mine.delegates.length>0&&mine.delegates.every(d=>d.committeeId===c3.id),'Chair 3 reads only committee 3 delegates');
  const mutate=async(command:Record<string,unknown>)=>query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[conference,crypto.randomUUID(),command,'chair',fingerprint(await snapshot(),command as never),new Date().toISOString()]);
  await mutate({type:'attendance',delegateId:d3,sessionId:c3.session,status:'Present'});
  const denied=(e:unknown)=>(e as {code?:string}).code==='42501';
  await assert.rejects(()=>mutate({type:'attendance',delegateId:d4,sessionId:c4.session,status:'Present'}),denied,'Chair 3 cannot write committee 4 (42501)');
  await assert.rejects(()=>mutate({type:'currentSession',committeeId:c4.id,sessionId:c4.session}),denied,'Chair 3 cannot set committee 4\'s current session (42501)');
  await as(chairUsers[4]);
  assert.ok((await snapshot()).delegates.every(d=>d.committeeId===c4.id),'Chair 4 reads only committee 4');
  await asOwner();
  assert.equal((await query<{n:number}>("select count(*)::int n from public.attendance where conference_id=$1",[conference]))[0].n,1,'only the in-scope write landed');
 }finally{await db.close();}
});

test('no readiness substitution: legacy single-Chair floors and all-roles runs can never PASS',()=>{
 const legacy=buildFixture({mode:'legacy-floors',conference,committees:N,delegates:10,floors:N,grantHours:3,users:{chair:chairUsers[0],...support}});
 const legacyFile:LegacyScopedFile={chair:{session:'x',committee:legacy.chairCommittee.id,sessions:legacy.floors},approval:{session:'a'},admins:{session:'b'},executive:{session:'c'}};
 assert.equal(identityModeOf(legacyFile),'legacy-single-committee');
 const users=buildScenario({staff:50,minutes:10,committees:N,seed:9}).filter(u=>u.role==='chair');
 const chairs:ChairIdentity[]=[{userId:chairUsers[0],token:'t',committee:legacy.chairCommittee.id,index:0}];
 const traffic=users.map(u=>{const a=assignChair(u,{mode:'legacy-single-committee',committees:legacy.committees,chairs,legacy:{committee:legacy.chairCommittee.id,sessions:legacy.floors}});return {committeeId:a.committee.id,committeeCode:a.committee.code,identity:a.identity.userId};});
 assert.equal(new Set(traffic.map(t=>t.committeeId)).size,1,'legacy: every Chair write resolves to one actual committee');
 const r=assessReadiness({mode:'legacy-single-committee',committees:legacy.committees,chairTraffic:traffic});
 assert.equal(r.label,'NOT A READINESS RUN');assert.equal(r.qualifiesForReadiness,false);
 assert.ok(r.reasons.some(x=>/not realistic-multi-committee/.test(x))&&r.reasons.some(x=>/one actual committee/.test(x))&&r.reasons.some(x=>/1 distinct Chair identities for 14/.test(x)));
 const v=readinessVerdict({pass:true,checks:[{check:'all metric thresholds',pass:true}]},r);
 assert.equal(v.pass,false,'perfect metrics still cannot make a legacy run PASS');assert.equal(v.label,'NOT A READINESS RUN');
 const superuser=assessReadiness({mode:'worst-case-superuser',committees:legacy.committees,chairTraffic:legacy.committees.map(c=>({committeeId:c.id,committeeCode:c.code,identity:'same-superuser'}))});
 assert.equal(superuser.qualifiesForReadiness,false);assert.ok(superuser.reasons.some(x=>/serve more than one committee|distinct Chair identities/.test(x)));
});

test('readiness mode fails fast: fewer Chair identities than committees, wrong scope, reused session or reused Auth user',()=>{
 const f=multi();
 assert.throws(()=>resolveChairMapping(multiFile(f,1),f.committees),/1 Chair identities for 14 committees/);
 assert.throws(()=>resolveChairMapping(multiFile(f,N-1),f.committees),/13 Chair identities for 14 committees/);
 const swapped=multiFile(f);[swapped.chairs[0].committee,swapped.chairs[1].committee]=[swapped.chairs[1].committee,swapped.chairs[0].committee];
 assert.throws(()=>resolveChairMapping(swapped,f.committees),/scoped to .* but simulated committee 0/);
 const reused=multiFile(f);reused.chairs[5].session=reused.chairs[4].session;
 assert.throws(()=>resolveChairMapping(reused,f.committees),/reuses session file/);
 assert.throws(()=>resolveChairMapping(multiFile(f),f.committees,Array(N).fill(chairUsers[0])),/same Chair Auth user/);
 const unassigned=multiFile(f);delete unassigned.chairs[2].committee;
 assert.throws(()=>resolveChairMapping(unassigned,f.committees),/has no committee/);
 // A realistic run whose Chair devices do not cover every committee is not a readiness run either.
 const partial=assessReadiness({mode:'realistic-multi-committee',committees:f.committees,chairTraffic:f.committees.slice(0,5).map((c,k)=>({committeeId:c.id,committeeCode:c.code,identity:chairUsers[k]}))});
 assert.equal(partial.qualifiesForReadiness,false);assert.ok(partial.reasons.some(x=>/no Chair traffic for 9 committee/.test(x)));
});

test('Realtime: a Chair event for committee A only reaches Chair devices assigned to committee A (plus the Executive)',()=>{
 const f=multi();const chairs=chairIdentities(f);const mapping=resolveChairMapping(multiFile(f),f.committees,chairUsers);
 const users=buildScenario({staff:50,minutes:10,committees:N,seed:4}).filter(u=>u.role!=='delegate');
 const committeeOf=(u:SimUser)=>assignChair(u,{mode:'realistic-multi-committee',committees:f.committees,chairs,mapping}).committee.id;
 for(const writer of users.filter(u=>u.role==='chair')){
  const reached=recipients('topic-aware',users,{topic:'chair',committee:writer.committee});
  const chairsReached=reached.filter(u=>u.role==='chair');
  assert.ok(chairsReached.length>=1&&chairsReached.every(u=>committeeOf(u)===committeeOf(writer)),'only same-committee Chairs');
  assert.equal(chairsReached.length,users.filter(u=>u.role==='chair'&&committeeOf(u)===committeeOf(writer)).length,'every Chair device of that committee');
  assert.ok(reached.every(u=>u.role==='chair'||u.role==='executive'),'no Approval/Admins refresh on chair events');
 }
});

test('identity pool planning: one session file per Chair plus support roles, only under .test-sessions/, conservative sign-in cap',()=>{
 const {entries,template}=planPool(14,'.test-sessions/rehearsal');
 assert.equal(template.chairs.length,14);assert.equal(new Set(template.chairs.map(c=>c.session)).size,14);
 assert.ok(template.chairs.every(c=>c.committee===undefined),'committees are assigned later by the fixture');
 assert.equal(entries.length,17);assert.ok(entries.every(e=>e.path.startsWith('.test-sessions/rehearsal/')));
 for(const bad of ['/tmp/x','sessions','.test-sessions/../x','../.test-sessions/x'])assert.throws(()=>checkPoolDir(bad),/\.test-sessions/);
 assert.throws(()=>planPool(0,'.test-sessions/x'));assert.throws(()=>planPool(41,'.test-sessions/x'));
 assert.ok(MAX_NEW_SIGN_INS_PER_RUN<30,'stays under the default 30 anonymous sign-ins per IP per hour');
});

// ---- Public-form fixture: real delegate ids for resolution submissions -----------------------------------------------
test('readiness fixture: 420 deterministic delegate ids spread over the 14 real committees, inserted verbatim, in fixture.json',()=>{
 const f=multi(),again=multi();
 assert.equal(f.delegates.length,N*30,'exactly 420 delegates');
 assert.deepEqual(f.delegates,again.delegates,'deterministic for the same conference id');
 assert.equal(new Set(f.delegates.map(d=>d.id)).size,N*30,'all delegate ids unique');
 const committeeIds=new Set(f.committees.map(c=>c.id));
 assert.ok(f.delegates.every(d=>committeeIds.has(d.committee)),'every delegate references a real fixture committee');
 assert.ok(f.delegates.every(d=>d.session===f.committees.find(c=>c.id===d.committee)!.session),'and that committee\'s session');
 for(const c of f.committees)assert.equal(f.delegates.filter(d=>d.committee===c.id).length,30,`${c.code} receives delegates`);
 assert.doesNotMatch(f.sql,/gen_random_uuid/,'no server-generated delegate ids');
 for(const d of f.delegates)assert.ok(f.sql.includes(`('${d.id}','${conference}','${d.committee}'`),'fixture.sql inserts the same id and committee');
 const json=JSON.parse(JSON.stringify(fixtureJson(f)));
 assert.deepEqual(json.delegates,f.delegates,'fixture.json carries those exact ids');
 assert.ok(!/token|secret|session_|refresh|password|auth\./i.test(JSON.stringify(json).replace(/"session":"[0-9a-f-]{36}"/g,'')),'no tokens or secrets in fixture.json');
 // rehearsal-run.mts: submitters = fixture.delegates for the --submit-committee (GA1) → a real GA1 delegation.
 const ga1=json.committees.find((c:{code:string})=>c.code==='GA1');
 const submitters=json.delegates.filter((d:{committee:string})=>d.committee===ga1.id);
 assert.equal(submitters.length,30);assert.ok(submitters.every((d:{id:string})=>f.delegates.some(x=>x.id===d.id&&x.committee===ga1.id)));
 assert.ok(!/auth\.users|auth\.sessions|signInAnonymously/.test(f.sql),'delegates get no Auth user or session');
 const legacy=buildFixture({mode:'legacy-floors',conference,committees:N,delegates:N*30,floors:N,grantHours:3,users:{chair:chairUsers[0],...support}});
 assert.deepEqual(legacy.delegates,f.delegates,'legacy mode uses the same deterministic delegate model');
});

test('readiness fixture SQL creates exactly the fixture.json delegates in the database, with no Auth users',async()=>{
 const f=multi();const {db,query,asOwner}=await freshDatabase();
 try{
  await asOwner();
  for(const u of [...chairUsers,support.approval,support.admins,support.executive])await query('insert into auth.users(id) values($1)',[u]);
  const authBefore=(await query<{n:number}>('select count(*)::int n from auth.users'))[0].n;
  await db.exec(f.sql);
  const rows=await query<{id:string;committee_id:string}>('select id,committee_id from public.delegates where conference_id=$1 order by id',[conference]);
  assert.deepEqual(rows.map(r=>[r.id,r.committee_id]).sort(),f.delegates.map(d=>[d.id,d.committee]).sort(),'database delegates = fixture.json delegates');
  assert.equal((await query<{n:number}>('select count(*)::int n from auth.users'))[0].n,authBefore,'no Auth identity created for delegates');
 }finally{await db.close();}
});

// ---- Single-link submission preflight (capacity run never plans an intentional 429) ----------------------------------
const c2=(delegates:number,submitFraction:number,staff=50)=>buildScenario({staff,delegates,minutes:8,committees:N,startWindowSeconds:150,delegateWindowSeconds:120,submitFraction});
test('documented C2 (50 staff + 150 delegates, one link) plans 150 page loads and at most 18 submissions',()=>{
 assert.equal(DOCUMENTED_SUBMIT_FRACTION,0.1);
 const plan=checkSingleLinkSubmissions(c2(150,DOCUMENTED_SUBMIT_FRACTION),true);
 assert.ok(plan.ok);assert.equal(plan.pageLoads,150);
 assert.ok(plan.planned>0&&plan.planned<=MAX_SINGLE_LINK_SUBMISSIONS,`planned ${plan.planned}`);
 assert.ok(plan.planned<RESOLUTION_LINK_LIMIT_PER_10_MIN,'below the designed 20 / 10 min link limit');
 const upper=checkSingleLinkSubmissions(c2(200,DOCUMENTED_SUBMIT_FRACTION),true);
 assert.ok(upper.ok&&upper.pageLoads===200&&upper.planned<=MAX_SINGLE_LINK_SUBMISSIONS,'200 page loads also stays under the cap');
 assert.equal(plannedSubmissions(c2(150,DOCUMENTED_SUBMIT_FRACTION)),plan.planned,'deterministic plan');
});
test('a deliberately high submission fraction is refused before any traffic; no readiness run needs an intentional 429',()=>{
 const high=checkSingleLinkSubmissions(c2(150,0.3),true);
 assert.equal(high.ok,false);assert.ok(high.planned>MAX_SINGLE_LINK_SUBMISSIONS);
 assert.match(high.reason,/Single-link readiness run plans \d+ submissions; maximum is 18 to stay below the designed 20\/10min link limit\. Lower --submit-fraction or use a separate rate-limit test\./);
 assert.ok(checkSingleLinkSubmissions(c2(150,0.3),false).ok,'page-load-only runs (no --submit-token) post nothing');
 assert.equal(plannedSubmissions(c2(150,0)),0);
 // The verdict still fails on any rate-limit response; the preflight keeps the capacity run from causing one.
 assert.equal(evaluate(report([{action:'submit',ms:100,outcome:'rate_limited'}]),0,0).pass,false);
});
