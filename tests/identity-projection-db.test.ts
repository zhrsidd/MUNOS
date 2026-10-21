import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

// Migration 20261021130000: the Main Submitter's COUNTRY (and nothing else about the delegate) reaches the roles that
// cannot read public.delegates, exactly where they could already read the resolution.
const approval='70000000-0000-4000-8000-000000000001',logistics='70000000-0000-4000-8000-000000000002',chairGa1='70000000-0000-4000-8000-000000000003',chairWho='70000000-0000-4000-8000-000000000004',observer='70000000-0000-4000-8000-000000000005',admin='70000000-0000-4000-8000-000000000006';
type Doc={id:string;code:string;status:string;committeeId:string;submitterCountry?:string|null};
type Snap={documents:Doc[];delegates:unknown[]};
const extra={ga1Draft:'71000000-0000-4000-8000-000000000001',ga1Printed:'71000000-0000-4000-8000-000000000002',ga1Closed:'71000000-0000-4000-8000-000000000003'};

async function setup(){
 const f=await freshDatabase();const {db,ids}=f;
 await f.grant(approval,'approval');await f.grant(logistics,'logistics');await f.grant(chairGa1,'chair',ids.ga1);await f.grant(chairWho,'chair',ids.who);await f.grant(observer,'observer');await f.grant(admin,'admin');
 await f.asOwner();
 // Seed holds GA1/01 In Debate (France), GA1/02 Review (Japan), WHO/01 Approved (Brazil), SC/01 Submitted (Kenya).
 // Add the remaining lifecycle states so every role/state pair is covered.
 const insert=(id:string,code:string,status:string,submitter:string,outcome:string|null)=>db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title,status,outcome) values($1,$2,$3,$4,$5,$6,'t',$7,$8)`,[id,ids.conference,ids.ga1,ids.session,submitter,code,status,outcome]);
 await insert(extra.ga1Draft,'GA1 / 03','Draft','c7477b44-53a9-4ea5-ab92-5a22deadd456',null);   // Kenya
 await insert(extra.ga1Printed,'GA1 / 04','Printed','91495434-4a1c-4e48-ac9f-bacda095f501',null); // Germany
 await insert(extra.ga1Closed,'GA1 / 05','Closed','aca41e3e-1594-4918-a524-2bc00e9034a5','Passed'); // Canada
 const countries=new Map((await f.query<{id:string;country:string}>('select d.id,del.country from public.documents d join public.delegates del on del.id=d."submitterId"')).map(r=>[r.id,r.country]));
 const status=new Map((await f.query<{id:string;status:string}>('select id,status::text from public.documents')).map(r=>[r.id,r.status]));
 const committee=new Map((await f.query<{id:string;committee_id:string}>('select id,committee_id from public.documents')).map(r=>[r.id,r.committee_id]));
 const snapshot=async(user:string)=>{await f.as(user);return (await f.query<{s:Snap}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;};
 return {...f,countries,status,committee,snapshot};
}

test('documents carry submitterCountry exactly where the reader can already see the document',async()=>{
 const f=await setup();try{
  const {ids,countries,status,committee}=f;
  const visible:Record<string,(id:string)=>boolean>={
   [approval]:id=>['Submitted','Review','Approved'].includes(status.get(id)!),
   [logistics]:id=>['Approved','Printed','In Debate','Closed'].includes(status.get(id)!),
   [chairGa1]:id=>committee.get(id)===ids.ga1,
   [chairWho]:id=>committee.get(id)===ids.who,
   [observer]:()=>true,
   [admin]:()=>true,
  };
  for(const [user,sees] of Object.entries(visible)){
   const snap=await f.snapshot(user);
   const expectedIds=[...countries.keys()].filter(sees).sort();
   assert.deepEqual(snap.documents.map(d=>d.id).sort(),expectedIds,`${user}: visible documents unchanged by the projection`);
   assert.ok(expectedIds.length>0);
   for(const d of snap.documents)assert.equal(d.submitterCountry,countries.get(d.id),`${user} ${d.code}`);
   // The direct projection never lists a document the reader cannot read (it repeats the documents SELECT policy).
   const map=(await f.query<{m:Record<string,string>}>('select private.document_submitter_countries($1) m',[ids.conference]))[0].m;
   assert.deepEqual(Object.keys(map).sort(),expectedIds,`${user}: country map has exactly the readable documents`);
  }
  // Spot checks the other way round: approval never learns a Draft/Printed/In Debate/Closed submitter's country.
  const panel=JSON.stringify(await f.snapshot(approval));
  assert.ok(panel.includes('"submitterCountry":"Kenya"'),'SC/01 is Submitted, so Approval reads its country');
  for(const country of ['Germany','Canada','France'])assert.ok(!panel.includes(`"submitterCountry":"${country}"`),`approval must not learn ${country}`);
  assert.ok(!JSON.stringify(await f.snapshot(logistics)).includes('"submitterCountry":"Japan"'),'logistics cannot see the Review document, so not its country');
  // The Executive snapshot keeps the same documents projection as the core snapshot.
  await f.as(admin);
  const executive=(await f.query<{s:Snap}>('select public.executive_snapshot($1) s',[ids.conference]))[0].s;
  assert.deepEqual(executive.documents,(await f.snapshot(admin)).documents);
  assert.ok(executive.documents.every(d=>d.submitterCountry===countries.get(d.id)));
  // A Chair of another committee gets nothing for this committee, and an old reader without the field is unaffected.
  assert.ok(!JSON.stringify(await f.snapshot(chairWho)).includes('France'));
 }finally{await f.db.close();}
});

test('Approval and Logistics still read no delegate rows and no personal data',async()=>{
 const f=await setup();try{
  for(const user of [approval,logistics]){
   const snap=await f.snapshot(user);
   assert.deepEqual(snap.delegates,[],'snapshot carries no delegates');
   assert.equal(Number((await f.query<{n:string}>('select count(*) n from public.delegates'))[0].n),0,'RLS still hides public.delegates');
   const text=JSON.stringify(snap);
   for(const secret of ['Mohammad Maaz','Hana Tanaka','Lucas Silva','@example.com'])assert.ok(!text.includes(secret),`${user} must not see ${secret}`);
   // Only the country string was added: every document key is an old key plus submitterCountry.
   for(const d of snap.documents)assert.ok('submitterCountry' in d);
  }
  // Operations snapshot (history) carries the country and no other delegate field.
  await f.as(approval);
  const ops=JSON.stringify((await f.query('select public.operations_snapshot($1) s',[f.ids.conference]))[0]);
  assert.ok(!ops.includes('@example.com')&&!ops.includes('Mohammad Maaz'));
 }finally{await f.db.close();}
});

test('the helper functions are not callable by the browser roles, and the country is scoped to conference and committee',async()=>{
 const f=await setup();try{
  const {ids}=f;const france=ids.france;
  const call=`select private.submitter_country('${ids.conference}','${ids.ga1}','${france}') c`;
  await f.asOwner();
  assert.equal((await f.query<{c:string}>(call))[0].c,'France','owner (definer context) reads the country');
  assert.equal((await f.query<{c:string|null}>(`select private.submitter_country('${ids.conference}','${ids.who}','${france}') c`))[0].c,null,'delegate from a different committee');
  assert.equal((await f.query<{c:string|null}>(`select private.submitter_country('${crypto.randomUUID()}','${ids.ga1}','${france}') c`))[0].c,null,'different conference');
  assert.equal((await f.query<{c:string|null}>(`select private.submitter_country('${ids.conference}','${ids.ga1}','${crypto.randomUUID()}') c`))[0].c,null,'unknown delegate');
  assert.equal((await f.query<{c:string|null}>(`select private.submitter_country('${ids.conference}','${ids.ga1}',null) c`))[0].c,null,'no submitter');
  for(const user of [approval,logistics,chairGa1,admin]){
   await f.as(user);
   await assert.rejects(()=>f.db.query(call),/permission denied/,`authenticated ${user} cannot call the helper`);
  }
  await f.asOwner();await f.db.exec('set role anon');
  await assert.rejects(()=>f.db.query(call),/permission denied/,'anon cannot call the helper');
  await assert.rejects(()=>f.db.query(`select private.document_submitter_countries('${ids.conference}')`),/permission denied/,'anon cannot call the projection');
  await assert.rejects(()=>f.db.query(`select public.conference_snapshot('${ids.conference}')`),/permission denied/);
  // A signed-in user with no access, or a revoked one, gets an empty map.
  await f.asOwner();
  await f.db.query('update public.user_access set revoked_at=now() where user_id=$1',[approval]);
  await f.as(approval);
  assert.deepEqual((await f.query<{m:unknown}>('select private.document_submitter_countries($1) m',[ids.conference]))[0].m,{});
  // Grants: only the projection is executable by authenticated; the helper has no browser grant at all.
  await f.asOwner();
  const acl=await f.query<{name:string;anon:boolean;auth:boolean;pub:boolean}>(`select p.proname name,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') auth,exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0) pub from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('submitter_country','document_submitter_countries') order by 1`);
  assert.deepEqual(acl.map(r=>[r.name,r.anon,r.auth,r.pub]),[['document_submitter_countries',false,true,false],['submitter_country',false,false,false]]);
  // Patching in place must not change who runs or may call the patched functions.
  const patched=await f.query<{name:string;definer:boolean;anon:boolean;auth:boolean}>(`select p.proname name,p.prosecdef definer,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') auth from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (('public','conference_snapshot'),('public','executive_snapshot'),('private','decision_history'),('public','amendment_link_info')) order by 1`);
  assert.deepEqual(patched.map(r=>[r.name,r.definer,r.anon,r.auth]),[['amendment_link_info',true,false,false],['conference_snapshot',false,false,true],['decision_history',true,false,true],['executive_snapshot',false,false,true]]);
 }finally{await f.db.close();}
});

test('decision_history carries submitterCountry, including for a document that left the reader\'s view',async()=>{
 const f=await setup();try{
  const {ids,db,query,as,asOwner}=f;
  await asOwner();await db.query(`insert into public.staff(conference_id,name,auth_user_id) values($1,'Priya Nair',$2)`,[ids.conference,approval]);
  const used=new Map<string,string|null>();
  const send=async(user:string,command:{id?:string},role:string,key=crypto.randomUUID())=>{
   await asOwner();const fresh=command.id?String((await query<{revision:string}>('select revision from public.documents where id=$1',[command.id]))[0]?.revision??'0'):null;
   const expected=used.has(key)?used.get(key)!:fresh;used.set(key,expected);
   await as(user);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,'2026-10-21T10:00:00Z']);};
  const draft=crypto.randomUUID();const doc=draft.slice(0,24)+'000000000001';
  await send(chairGa1,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'History',submitterId:ids.france} as never,'chair',draft);
  await send(chairGa1,{type:'document',id:doc,status:'Submitted'} as never,'chair');
  await send(approval,{type:'document',id:doc,status:'Review'} as never,'approval');
  await send(approval,{type:'document',id:doc,status:'Draft',comment:'Needs a funding clause.'} as never,'approval');
  await send(chairGa1,{type:'document',id:doc,status:'Submitted'} as never,'chair');
  await send(approval,{type:'document',id:doc,status:'Approved'} as never,'approval');
  type Entry={documentId:string;decision:string;code:string;submitterCountry:string|null};
  const history=async(user:string)=>{await as(user);return (await query<{s:Entry[]}>(`select public.operations_snapshot($1)->'documentDecisions' s`,[ids.conference]))[0].s;};
  const mine=async(user:string)=>(await history(user)).filter(e=>e.documentId===doc);
  assert.deepEqual((await mine(approval)).map(e=>[e.decision,e.submitterCountry]),[['review_started','France'],['changes_requested','France'],['approved','France']]);
  assert.deepEqual((await mine(chairGa1)).map(e=>e.submitterCountry),['France','France','France']);
  assert.equal((await mine(chairWho)).length,0,'another committee still gets no rows');
  assert.equal((await mine(logistics)).length,0,'logistics still gets no history');
  // The resolution moves on to Printed: it leaves the Approval Panel's view, but its history still names the country.
  await asOwner();await db.query(`update public.documents set status='Printed' where id=$1`,[doc]);
  const snap=await f.snapshot(approval);
  assert.ok(!snap.documents.some(d=>d.id===doc),'document left the Approval Panel view');
  assert.deepEqual((await mine(approval)).map(e=>[e.code.slice(0,3),e.submitterCountry]),[['GA1','France'],['GA1','France'],['GA1','France']],'history keeps the country');
  // A legacy comment row (no recorded decision) carries it too.
  await asOwner();await db.query(`insert into public.document_comments(conference_id,committee_id,"documentId",text,"createdAt") values($1,$2,'548c2e6f-84b8-4116-a2f1-ccfa8f1d5d27','Old note','2026-10-01T00:00:00Z')`,[ids.conference,ids.ga1]);
  const legacy=(await history(approval)).find(e=>e.documentId==='548c2e6f-84b8-4116-a2f1-ccfa8f1d5d27')!;
  assert.equal(legacy.decision,'comment');assert.equal(legacy.submitterCountry,'Japan');
  // No other delegate field leaks through history.
  assert.ok(!JSON.stringify(await history(approval)).includes('@example.com'));
 }finally{await f.db.close();}
});

test('amendment_link_info adds resolution.submitterId and nothing else',async()=>{
 const f=await setup();try{
  const {ids,db,query,asOwner,asServer}=f;
  await asOwner();
  await db.query('update public.committees set "currentSessionId"=$2 where id=$1',[ids.ga1,ids.session]);
  const token='identity_token_12345678901234567';
  await db.query('insert into public.amendment_links(conference_id,committee_id,token) values($1,$2,$3)',[ids.conference,ids.ga1,token]);
  const info=async()=>(await query<{s:{committee:Record<string,unknown>;resolution:Record<string,unknown>|null;delegates:Record<string,unknown>[]}}>('select public.amendment_link_info($1) s',[token]))[0].s;
  await asServer();
  const s=await info();
  assert.deepEqual(Object.keys(s).sort(),['committee','delegates','resolution']);
  assert.deepEqual(Object.keys(s.resolution!).sort(),['code','id','submitterId','title']);
  assert.equal(s.resolution!.id,ids.resolution);assert.equal(s.resolution!.submitterId,ids.france);
  assert.deepEqual(Object.keys(s.committee).sort(),['code','id','name']);
  assert.ok(s.delegates.every(d=>Object.keys(d).sort().join()==='country,id'),'delegate list unchanged: id and country only');
  assert.ok(s.delegates.some(d=>d.id===ids.france));
  assert.ok(!JSON.stringify(s).includes('@example.com')&&!JSON.stringify(s).includes('Mohammad'));
  // Still service_role only.
  await asOwner();await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select public.amendment_link_info($1)',[token]),/permission denied/);
  await asOwner();await db.exec('set role anon');
  await assert.rejects(()=>db.query('select public.amendment_link_info($1)',[token]),/permission denied/);
  // No resolution in debate: still null, as before.
  await asOwner();await db.query(`update public.documents set status='Closed',outcome='Withdrawn' where id=$1`,[ids.resolution]);
  await asServer();assert.equal((await info()).resolution,null);
 }finally{await f.db.close();}
});
