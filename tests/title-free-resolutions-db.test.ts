import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {POST as submit} from '../app/api/submissions/route';
import {COMPAT_RESOLUTION_TITLE,compatResolutionTitle} from '../lib/resolution-title';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Command} from '../lib/commands';
import {SupabaseTransport} from '../lib/supabase/repository';
import {DurableRepository} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';

// Title-free resolutions against the real migrations (PGlite replays every one): the existing SQL is unchanged and still
// receives a valid title, from the public route and from the Chair command.
const executive='64000000-0000-4000-8000-000000000001', chair='64000000-0000-4000-8000-000000000002', panel='64000000-0000-4000-8000-000000000003', print='64000000-0000-4000-8000-000000000004';
const token='B'.repeat(10)+'d_e-'+'8'.repeat(10);
const docOf=(n:string)=>`https://docs.google.com/document/d/${n.padEnd(30,'x')}/edit?usp=sharing`;
const multipart=(fields:Record<string,string>)=>{
 const boundary='----titlefreedb';
 const body=Object.entries(fields).map(([k,v])=>`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('')+`--${boundary}--\r\n`;
 return new Request('http://localhost/api/submissions',{method:'POST',body,headers:{'content-type':`multipart/form-data; boundary=${boundary}`}});
};
type H={id:string;documentId:string;code:string;title:string;decision:string;round:number;comment:string|null};

async function setup(){
 const f=await freshDatabase();const {db,ids,query,as,asOwner,asServer,grant,operationsExpected}=f;
 await grant(executive,'admin');await grant(chair,'chair',ids.ga1);await grant(panel,'approval');await grant(print,'logistics');
 await asOwner();await db.query(`insert into public.staff(conference_id,name,auth_user_id) values($1,'Priya Nair',$2)`,[ids.conference,panel]);
 const used=new Map<string,string|null>();
 const send=async(user:string,command:unknown,role:string,key=crypto.randomUUID())=>{
  await asOwner();const id=(command as {id?:string}).id;
  const fresh=id?String((await query<{revision:string}>('select revision from public.documents where id=$1',[id]))[0]?.revision??'0'):null;
  const expected=used.has(key)?used.get(key)!:fresh;used.set(key,expected);
  await as(user);await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,'2026-10-21T10:00:00Z']);return key;};
 const history=async(user:string,doc:string)=>{await as(user);return (await query<{s:{documentDecisions:H[]}}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s.documentDecisions.filter(h=>h.documentId===doc);};
 const openLink=async()=>{
  await as(executive);
  const command={type:'submissionLink',action:'create',committeeId:ids.ga1,token,shareWith:''};
  const expected=await operationsExpected(command);
  await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(command),'admin',expected,'2026-10-21T08:00:00Z']);
  await asServer();
 };
 return {...f,send,history,openLink};
}

type Fixture=Awaited<ReturnType<typeof setup>>;
/**
 * Runs `run` with the public route wired to the Supabase backend, and with a stand-in for PostgREST: the supabase client's
 * rpc() call is executed against the migrated database as service_role. `rpcTitles` records every title sent to submit_resolution.
 */
async function withRoute(f:Fixture,run:(rpcTitles:unknown[])=>Promise<void>){
 const realFetch=globalThis.fetch;
 const previous={backend:process.env.NEXT_PUBLIC_DATA_BACKEND,url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY,vercel:process.env.VERCEL_ENV};
 const {query,asServer}=f;
 try{
  await f.openLink();
  const rpcTitles:unknown[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
   const body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;
   const fn=url.pathname.split('/').pop()!;
   await asServer();
   try{
    const rows=fn==='submission_link_info'
     ?await query<{r:unknown}>('select public.submission_link_info($1) r',[body.link_token])
     :(rpcTitles.push(body.title),await query<{r:unknown}>('select public.submit_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[body.link_token,body.submission,body.submitter,body.title,body.google_doc_id,body.file_name,body.storage_key,body.file_sha256,body.file_size]));
    return new Response(JSON.stringify(rows[0].r),{status:200,headers:{'content-type':'application/json'}});
   }catch(error){return new Response(JSON.stringify({message:(error as Error).message,code:'P0001'}),{status:400,headers:{'content-type':'application/json'}});}
  }) as typeof fetch;
  process.env.NEXT_PUBLIC_DATA_BACKEND='supabase';process.env.NEXT_PUBLIC_SUPABASE_URL='https://devtestrefabcdefghij.supabase.co';process.env.SUPABASE_SECRET_KEY='test-secret-not-real';delete process.env.VERCEL_ENV;
  await run(rpcTitles);
 }finally{
  globalThis.fetch=realFetch;
  for(const [k,v] of [['NEXT_PUBLIC_DATA_BACKEND',previous.backend],['NEXT_PUBLIC_SUPABASE_URL',previous.url],['SUPABASE_SECRET_KEY',previous.key],['VERCEL_ENV',previous.vercel]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await f.db.close();
 }
}
const docIdOf=(submission:string)=>submission.slice(0,24)+'000000000001';
const receipt=async(f:Fixture,submission:string)=>{await f.asOwner();return f.query<{title:string;documentId:string}>(`select request_payload->>'title' title,document_id "documentId" from private.resolution_submissions where id=$1`,[submission]);};
const docCount=async(f:Fixture)=>{await f.asOwner();return (await f.query<{n:number}>('select count(*)::int n from public.documents where committee_id=$1',[f.ids.ga1]))[0].n;};

test('public route -> Supabase backend -> real submit_resolution: a title-free post creates a Draft titled with the compatibility value; retries replay and a reload finds the original',async()=>{
 const f=await setup();const {ids,query,asOwner}=f;
 await withRoute(f,async(rpcTitles)=>{
  const fields={token,submitterId:ids.france};
  const first=crypto.randomUUID(),doc=docIdOf(first);
  const created=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbTitleFree')}));
  assert.equal(created.status,201);
  const createdBody=await created.json();assert.equal(createdBody.status,'created');assert.match(createdBody.code,/^GA1 \/ \d{2}$/,'code assigned by the database as before');
  assert.deepEqual(rpcTitles,[COMPAT_RESOLUTION_TITLE],'no title posted -> only the compatibility title reaches the RPC');
  await asOwner();
  const row=(await query<{title:string;status:string;code:string;submitterId:string}>('select title,status,code,"submitterId" from public.documents where id=$1',[doc]))[0];
  assert.deepEqual(row,{title:COMPAT_RESOLUTION_TITLE,status:'Draft',code:createdBody.code,submitterId:ids.france});
  assert.match((await query<{text:string}>('select text from public.document_versions where "documentId"=$1',[doc]))[0].text,/^Submitted through the GA1 submission link by France\./,'version text does not depend on the title');
  const docs=await docCount(f);
  // (b) A retry of the same title-free submission replays, as does one carrying an INVALID legacy title (it falls back to the compatibility value).
  const retry=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbTitleFree')}));
  assert.equal(retry.status,200);assert.equal((await retry.json()).status,'replayed');
  for(const bad of ['x','   ','y'.repeat(201)]){
   const r=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbTitleFree'),title:bad}));
   assert.equal(r.status,200,`invalid legacy title of ${bad.length} characters falls back to the compatibility title`);assert.equal((await r.json()).status,'replayed');
  }
  // (c) A reload (new submission id) of the same Google Doc finds the original through duplicate detection, with or without a legacy title.
  const reload=await submit(multipart({...fields,submissionId:crypto.randomUUID(),googleDoc:docOf('dbTitleFree')}));
  assert.equal(reload.status,200);const reloadBody=await reload.json();assert.deepEqual([reloadBody.status,reloadBody.code],['duplicate',createdBody.code]);
  const reloadLegacy=await submit(multipart({...fields,submissionId:crypto.randomUUID(),googleDoc:docOf('dbTitleFree'),title:'Typed into an old form'}));
  assert.equal(reloadLegacy.status,200);assert.equal((await reloadLegacy.json()).status,'duplicate');
  assert.equal(await docCount(f),docs,'still exactly one document for that source');
  // The rest of the validation is untouched: the same submission id with a different document is still a conflict.
  const changed=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbOtherDoc')}));
  assert.equal(changed.status,409);assert.equal((await changed.json()).error,'idempotency_conflict');
 });
});

test('LEGACY RETRY (Codex P2): a submission accepted by the pre-deploy code is retried by an old cached form with the same id and inputs -> original result, no 409, no second document',async()=>{
 const f=await setup();const {ids,query,asOwner,asServer}=f;
 await withRoute(f,async(rpcTitles)=>{
  const sid=crypto.randomUUID(),googleDoc=docOf('dbPreDeploy'),googleDocId=googleDoc.split('/d/')[1].split('/')[0];
  // 1. Accepted BEFORE the deploy: exactly the RPC call the pre-title-free backend made (the old form's cleaned title, file parameters null).
  const original='Protecting civilians in cyberspace';
  await asServer();
  const first=(await query<{r:{status:string;code:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[token,sid,ids.france,original,googleDocId]))[0].r;
  assert.equal(first.status,'created');
  assert.deepEqual((await receipt(f,sid)).map(r=>r.title),[original]);
  const docs=await docCount(f);
  // 2. The delegate's old page retries the SAME submission id after the deploy. A retry that could not send the title is a 409 (the reproduced bug)...
  const bare=await submit(multipart({token,submitterId:ids.france,submissionId:sid,googleDoc}));
  assert.equal(bare.status,409,'a retry that cannot send the original title cannot match the stored receipt');
  assert.equal((await bare.json()).error,'idempotency_conflict');
  // ...but the old form does send its title, and it is now passed through unchanged, so the receipt matches.
  rpcTitles.length=0;
  const retry=await submit(multipart({token,submitterId:ids.france,submissionId:sid,googleDoc,title:original}));
  assert.equal(retry.status,200);const body=await retry.json();assert.deepEqual([body.ok,body.status,body.code],[true,'replayed',first.code]);
  assert.deepEqual(rpcTitles,[original],'the exact original title reaches the RPC');
  // The old server also reduced whitespace before sending, so a differently spaced copy of the same title is byte-identical too.
  const spaced=await submit(multipart({token,submitterId:ids.france,submissionId:sid,googleDoc,title:'  Protecting \t civilians\r\n in   cyberspace  '}));
  assert.equal(spaced.status,200);assert.equal((await spaced.json()).status,'replayed');
  assert.deepEqual(rpcTitles,[original,original]);
  // Nothing was created or rewritten.
  assert.equal(await docCount(f),docs,'no second document');
  assert.deepEqual((await receipt(f,sid)).map(r=>r.title),[original],'the receipt is untouched');
  await asOwner();assert.equal((await query<{title:string}>('select title from public.documents where id=$1',[docIdOf(sid)]))[0].title,original);
  // A genuinely changed title on the same id is still an idempotency conflict (the RPC contract is unchanged).
  const changed=await submit(multipart({token,submitterId:ids.france,submissionId:sid,googleDoc,title:'A different title'}));
  assert.equal(changed.status,409);
  // (c) The delegate reloads instead: a new submission id with the same Google Doc finds the original through duplicate detection.
  const reload=await submit(multipart({token,submitterId:ids.france,submissionId:crypto.randomUUID(),googleDoc}));
  assert.equal(reload.status,200);const reloadBody=await reload.json();assert.deepEqual([reloadBody.status,reloadBody.code],['duplicate',first.code]);
  assert.equal(await docCount(f),docs,'still one document');
 });
});

test('a valid legacy title on a NEW submission is forwarded and stored as the old code did; an invalid or oversized one falls back to the compatibility title',async()=>{
 const f=await setup();const {ids,query,asOwner}=f;
 await withRoute(f,async(rpcTitles)=>{
  const fields={token,submitterId:ids.france};
  const cases:[string,string,string][]=[['dbLegacyOk','  Protecting   civilians ','Protecting civilians'],['dbLegacyShort','x',COMPAT_RESOLUTION_TITLE],['dbLegacyLong','z'.repeat(201),COMPAT_RESOLUTION_TITLE],['dbLegacyEdge','e'.repeat(200),'e'.repeat(200)],['dbLegacyBlank','   ',COMPAT_RESOLUTION_TITLE]];
  for(const [name,sent,stored] of cases){
   const sid=crypto.randomUUID();rpcTitles.length=0;
   const r=await submit(multipart({...fields,submissionId:sid,googleDoc:docOf(name),title:sent}));
   assert.equal(r.status,201,name);
   assert.deepEqual(rpcTitles,[stored],name);
   await asOwner();
   assert.equal((await query<{title:string}>('select title from public.documents where id=$1',[docIdOf(sid)]))[0].title,stored,name);
   assert.deepEqual((await receipt(f,sid)).map(x=>x.title),[stored],name);
  }
 });
});

test('the compatibility title passes the unchanged submit_resolution check, and a bad title is still refused by it (the RPC was not loosened)',async()=>{
 const {db,ids,query,asOwner,openLink}=await setup();
 try{
  await openLink();
  const call=(title:string,n:string)=>query<{r:{status:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[token,crypto.randomUUID(),ids.france,title,n.padEnd(30,'x')]);
  assert.equal((await call(compatResolutionTitle(),'rpcCompat'))[0].r.status,'created');
  await assert.rejects(()=>call('ab','rpcShort'),/invalid_title/,'the server rule is unchanged; it simply never fires for the compatibility title');
  await assert.rejects(()=>call('y'.repeat(201),'rpcLong'),/invalid_title/);
  await asOwner();
  assert.ok((await query<{n:number}>('select count(*)::int n from public.documents where title<>$1',[COMPAT_RESOLUTION_TITLE]))[0].n>0,'seeded resolutions keep their stored titles');
 }finally{await db.close();}
});

test('Chair create: the compatibility title satisfies the unchanged SQL; a title-less command is what the client never sends',async()=>{
 const {db,ids,query,asOwner,send}=await setup();
 try{
  const create=crypto.randomUUID(),doc=create.slice(0,24)+'000000000001';
  // The command exactly as components/documents.tsx sends it: Main Submitter only, plus the compatibility value.
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:compatResolutionTitle(),submitterId:ids.france},'chair',create);
  await asOwner();
  const row=(await query<{title:string;status:string;submitterId:string;code:string}>('select title,status,"submitterId",code from public.documents where id=$1',[doc]))[0];
  assert.deepEqual([row.title,row.status,row.submitterId],[COMPAT_RESOLUTION_TITLE,'Draft',ids.france]);
  assert.match(row.code,/^GA1 \/ [0-9a-f]{8}$/);
  const version=(await query<{text:string;number:number;fileName:string}>('select text,number,"fileName" from public.document_versions where "documentId"=$1',[doc]))[0];
  assert.deepEqual([version.text,version.number,version.fileName],[COMPAT_RESOLUTION_TITLE,1,'draft-preview.txt'],'draft version text starts from (and here is) the compatibility title, as the local reducer does');
  // Idempotent replay of the same mutation creates nothing new.
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:compatResolutionTitle(),submitterId:ids.france},'chair',create);
  await asOwner();assert.equal((await query('select 1 from public.documents where id=$1',[doc])).length,1);
  // A command queued before the change still carries a real title and is stored as it was.
  const old=crypto.randomUUID();
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:'Queued before the change',submitterId:ids.france},'chair',old);
  await asOwner();assert.equal((await query<{title:string}>('select title from public.documents where id=$1',[old.slice(0,24)+'000000000001']))[0].title,'Queued before the change');
  // The SQL itself has no title rule beyond not-null: this is why the client always sends the value.
  await assert.rejects(()=>send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,submitterId:ids.france},'chair'),/null value/i);
  await assert.rejects(()=>send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:null,submitterId:ids.france},'chair'),/null value/i,'the server stays strict: a null title is refused too');
  await asOwner();assert.equal((await query('select 1 from public.documents where title is null')).length,0);
 }finally{await db.close();}
});

test('feedback and history stay visible for a title-free resolution through Draft, Printed, In Debate and Closed',async()=>{
 const {db,ids,asOwner,send,history}=await setup();
 try{
  const draft=crypto.randomUUID();const doc=draft.slice(0,24)+'000000000001';
  await send(chair,{type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,title:compatResolutionTitle(),submitterId:ids.france},'chair',draft);
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Review'},'approval');
  await send(panel,{type:'document',id:doc,status:'Draft',comment:'Cite sources.'},'approval');
  const atDraft=await history(panel,doc);
  assert.deepEqual(atDraft.map(h=>h.decision),['review_started','changes_requested'],'Draft');
  assert.equal(atDraft[1].comment,'Cite sources.');
  assert.ok(atDraft[1].code.length>0,'the code is carried, so the identity needs nothing else from the title');
  assert.equal(atDraft[1].title,COMPAT_RESOLUTION_TITLE,'the projection still carries the stored title, which no screen shows');
  await send(chair,{type:'document',id:doc,status:'Submitted'},'chair');
  await send(panel,{type:'document',id:doc,status:'Approved'},'approval');
  await asOwner();await db.query(`update public.documents set status='Closed',outcome='Withdrawn' where id=$1`,[ids.resolution]);
  await db.query('update public.committees set "currentSessionId"=$1 where id=$2',[ids.session,ids.ga1]);
  await send(print,{type:'document',id:doc,status:'Printed'},'logistics');
  assert.equal((await history(panel,doc)).length,3,'Printed');
  await send(chair,{type:'document',id:doc,status:'In Debate'},'chair');
  assert.equal((await history(panel,doc)).length,3,'In Debate');
  assert.equal((await history(chair,doc)).length,3);
  await asOwner();await db.query(`update public.documents set status='Closed',outcome='Passed' where id=$1`,[doc]);
  const closed=await history(panel,doc);
  assert.deepEqual(closed.map(h=>h.decision),['review_started','changes_requested','approved'],'Closed');
  assert.equal(closed.find(h=>h.decision==='changes_requested')!.comment,'Cite sources.');
 }finally{await db.close();}
});

// The same Chair create, but through the real client path: DurableRepository (queue + outbox) -> SupabaseTransport ->
// public.apply_conference_mutation, with PGlite standing in for PostgREST. The SQL above stays strict; the client never
// lets a title-less create reach it.
async function durableChair(){
 const f=await setup();const {ids,query,as,asOwner,db}=f;
 const wire:{name:string;mutation:string;command:Record<string,unknown>}[]=[];
 const failures:{code?:string;message:string}[]=[];
 let online=false;
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  if(!online)return {data:null,error:{message:'Failed to fetch'},status:0};
  await as(chair);
  try{
   if(name.startsWith('apply_')){
    wire.push({name,mutation:String(args.mutation),command:JSON.parse(JSON.stringify(args.command))});
    await db.query(`select public.${name}($1,$2,$3,$4,$5,$6)`,[args.conf,args.mutation,JSON.stringify(args.command),args.requested_role,args.expected,args.client_time]);
    return {data:null,error:null,status:200};
   }
   return {data:(await query<{r:unknown}>(`select public.${name}($1) r`,[args.conf]))[0].r,error:null,status:200};
  }catch(e){const x=e as {code?:string;message:string};failures.push({code:x.code,message:x.message});return {data:null,error:{code:x.code,message:x.message},status:400};}
 }} as unknown as SupabaseClient;
 const transport=new SupabaseTransport(client,ids.conference,chair);
 online=true;const seedData=await transport.read();online=false;
 const name='title-free-db-'+crypto.randomUUID(),store=new DurableStore(name);
 const repo=new DurableRepository(name,()=>structuredClone(seedData),store,transport);
 await repo.ready();
 // Back online: keep asking for a sync (a flush already in flight is skipped) until the outbox drains or a conflict stops it.
 const sync=async()=>{online=true;for(let n=0;n<500;n++){await repo.flush();if(repo.getHealth().pending===0||repo.getHealth().conflicts>0)return;await new Promise(r=>setTimeout(r,10));}assert.fail('outbox did not drain');};
 const docs=async(ids2:string[])=>{await asOwner();return query<{id:string;title:string;status:string;submitterId:string}>('select id,title,status,"submitterId" from public.documents where id=any($1::uuid[]) order by id',[ids2]);};
 const close=async()=>{repo.dispose();await store.close();await db.close();};
 return {...f,wire,failures,repo,store,name,transport,sync,docs,close};
}
const create=(extra:Record<string,unknown>,ids:Record<string,string>)=>({type:'newDocument',committeeId:ids.ga1,sessionId:ids.session,submitterId:ids.france,...extra}) as unknown as Command;

test('a title-less create through the real DurableRepository + SupabaseTransport reaches apply_conference_mutation with the compatibility title and SUCCEEDS',async()=>{
 const t=await durableChair();const {ids,repo,store,name,wire,failures,transport,sync,docs,query,asOwner}=t;
 try{
  // Missing, null, blank and non-string titles (JS callers, tests, older code paths), plus the typed command the form sends.
  const variants=[{},{title:null},{title:''},{title:'   '},{title:7},{title:compatResolutionTitle()}];
  for(const v of variants)await repo.execute(create(v,ids),'chair');
  await repo.execute(create({title:'Queued before the change'},ids),'chair');
  const queued=(await store.read(name))!.pending;
  assert.equal(queued.length,7,'everything is queued durably while offline');
  for(const m of queued.slice(0,6))assert.deepEqual(m.command,create({title:COMPAT_RESOLUTION_TITLE},ids),'the persisted outbox JSON already carries the compatibility title');
  assert.equal(JSON.stringify(queued[6].command),JSON.stringify(create({title:'Queued before the change'},ids)),'a legacy command with a real title is persisted byte-identically');
  await sync();
  assert.deepEqual(failures,[],'PostgreSQL rejected nothing');
  assert.equal(repo.getHealth().conflicts,0);assert.equal(repo.getHealth().pending,0);
  assert.equal(wire.length,7);
  for(const w of wire){assert.equal(w.name,'apply_conference_mutation');assert.equal(typeof w.command.title,'string');}
  assert.deepEqual(wire.map(w=>w.command.title),[...Array(6).fill(COMPAT_RESOLUTION_TITLE),'Queued before the change']);
  const rows=await docs(queued.map(m=>m.id.slice(0,24)+'000000000001'));
  assert.equal(rows.length,7,'every create landed exactly once');
  assert.deepEqual(rows.map(r=>r.status),Array(7).fill('Draft'));
  assert.equal(rows.filter(r=>r.title===COMPAT_RESOLUTION_TITLE).length,6);
  assert.equal(rows.find(r=>r.id===queued[6].id.slice(0,24)+'000000000001')!.title,'Queued before the change');
  // Replay (a lost response resends the same mutation id with the same JSON) is idempotent: no second document, same bytes.
  const sentBefore=wire.length;
  for(const m of queued)await transport.send(m);
  assert.deepEqual(wire.slice(sentBefore).map(w=>JSON.stringify(w.command)),wire.slice(0,sentBefore).map(w=>JSON.stringify(w.command)),'replay is byte-identical to the first send');
  assert.deepEqual(failures,[]);
  await asOwner();assert.equal((await query<{n:number}>('select count(*)::int n from public.documents where id=any($1::uuid[])',[queued.map(m=>m.id.slice(0,24)+'000000000001')]))[0].n,7);
 }finally{await t.close();}
});
