import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {POST as submit} from '../app/api/submissions/route';
import {COMPAT_RESOLUTION_TITLE,compatResolutionTitle} from '../lib/resolution-title';

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

test('public route -> Supabase backend -> real submit_resolution: title-free and legacy-title posts both create a Draft titled with the compatibility value',async()=>{
 const {db,ids,query,asOwner,asServer,openLink}=await setup();
 const realFetch=globalThis.fetch;
 const previous={backend:process.env.NEXT_PUBLIC_DATA_BACKEND,url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY,vercel:process.env.VERCEL_ENV};
 try{
  await openLink();
  const rpcTitles:unknown[]=[];
  // A stand-in for PostgREST: the supabase client's rpc() call is executed against the migrated database as service_role.
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
  const fields={token,submitterId:ids.france};
  // 1. No title at all.
  const first=crypto.randomUUID(),doc=first.slice(0,24)+'000000000001';
  const created=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbTitleFree')}));
  assert.equal(created.status,201);
  const createdBody=await created.json();assert.equal(createdBody.status,'created');assert.match(createdBody.code,/^GA1 \/ \d{2}$/,'code assigned by the database as before');
  await asOwner();
  const row=(await query<{title:string;status:string;code:string;submitterId:string}>('select title,status,code,"submitterId" from public.documents where id=$1',[doc]))[0];
  assert.deepEqual(row,{title:COMPAT_RESOLUTION_TITLE,status:'Draft',code:createdBody.code,submitterId:ids.france});
  assert.match((await query<{text:string}>('select text from public.document_versions where "documentId"=$1',[doc]))[0].text,/^Submitted through the GA1 submission link by France\./,'version text does not depend on the title');
  // 2. An older cached page still posts a title: succeeds (even one the old 3-character rule refused) and is never stored.
  const second=crypto.randomUUID(),doc2=second.slice(0,24)+'000000000001';
  const legacy=await submit(multipart({...fields,submissionId:second,googleDoc:docOf('dbLegacyTitle'),title:'x'}));
  assert.equal(legacy.status,201);
  await asOwner();
  assert.equal((await query<{title:string}>('select title from public.documents where id=$1',[doc2]))[0].title,COMPAT_RESOLUTION_TITLE,'the supplied title is not stored');
  assert.equal((await query('select 1 from public.documents where title=$1',['x'])).length,0);
  assert.deepEqual(rpcTitles,[COMPAT_RESOLUTION_TITLE,COMPAT_RESOLUTION_TITLE],'only the compatibility title ever reaches the RPC');
  // 3. Idempotency still holds: retrying the same submission id, with or without a legacy title, is a replay, not a conflict.
  const retry=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbTitleFree')}));
  assert.equal(retry.status,200);assert.equal((await retry.json()).status,'replayed');
  const retryLegacy=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbTitleFree'),title:'Typed into an old form'}));
  assert.equal(retryLegacy.status,200);assert.equal((await retryLegacy.json()).status,'replayed');
  // 4. The rest of the validation is untouched: the same submission id with a different document is still a conflict.
  const changed=await submit(multipart({...fields,submissionId:first,googleDoc:docOf('dbOtherDoc')}));
  assert.equal(changed.status,409);assert.equal((await changed.json()).error,'idempotency_conflict');
  await asOwner();
  assert.equal((await query('select 1 from public.documents where title=$1 and id in ($2,$3)',[COMPAT_RESOLUTION_TITLE,doc,doc2])).length,2);
 }finally{
  globalThis.fetch=realFetch;
  for(const [k,v] of [['NEXT_PUBLIC_DATA_BACKEND',previous.backend],['NEXT_PUBLIC_SUPABASE_URL',previous.url],['SUPABASE_SECRET_KEY',previous.key],['VERCEL_ENV',previous.vercel]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await db.close();
 }
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
