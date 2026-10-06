import {createClient} from '@supabase/supabase-js';
import nextEnv from '@next/env';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {SupabaseTransport} from '../lib/supabase/repository';
import {ConflictError,fingerprint} from '../lib/sync/repository';
import type {Command} from '../lib/commands';
nextEnv.loadEnvConfig(process.cwd());
const ref='opmydpozhdgkpcnjwpqb',url=process.env.NEXT_PUBLIC_SUPABASE_URL!;
assert.equal(url,`https://${ref}.supabase.co`);
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const path=process.env.STAFF_SESSION_FILE ?? '.test-sessions/development.json';
const saved=JSON.parse(await readFile(path,'utf8')); // Existing identity required; NEVER sign up here.
const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const renewed=await auth.auth.refreshSession({refresh_token:saved.refresh_token});assert.ifError(renewed.error);const session=renewed.data.session!;
await writeFile(path,JSON.stringify(session),{mode:0o600});
const client=createClient(url,key,{accessToken:async()=>session.access_token,auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})}});
const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8'));
const access=await client.from('user_access').select('role,committee_id').eq('conference_id',ids.conference);
assert.ifError(access.error);assert.ok(access.data?.length);assert.ok(access.data!.every(a=>a.role==='chair'&&a.committee_id===ids.ga1),'Use an existing GA1-only Chair identity');
const transport=new SupabaseTransport(client,ids.conference,session.user.id);
const startedAt=new Date().toISOString();
const cases:{name:string;status:number;code:string;milliseconds:number}[]=[];
async function send(command:Command,expected?:string|null){const data=await transport.read();const m={id:crypto.randomUUID(),createdAt:new Date().toISOString(),actorId:session.user.id,role:'chair' as const,command,expected:expected===undefined?fingerprint(data,command):expected,state:'pending' as const};await transport.send(m);return m;}
async function stale(name:string,command:Command){
 const before=JSON.stringify(await transport.read());
 const mutation=crypto.randomUUID(),client_time=new Date().toISOString();
 for(let i=0;i<3;i++){
  const start=performance.now();const r=await client.rpc('apply_conference_mutation',{conf:ids.conference,mutation,command,requested_role:'chair',expected:'stale-rehearsal',client_time});
  const ms=Math.round(performance.now()-start);assert.equal(r.status,409);assert.equal(r.error?.code,'PT409');assert.ok(ms<8000,'Conflict must return within the bounded request timeout');cases.push({name,status:r.status,code:r.error!.code,milliseconds:ms});
 }
 await assert.rejects(()=>transport.send({id:mutation,createdAt:client_time,actorId:session.user.id,role:'chair',command,expected:'stale-rehearsal',state:'pending'}),ConflictError);
 assert.equal(JSON.stringify(await transport.read()),before,`${name} stale requests changed state`);
}
let data=await transport.read();
const attendance=data.attendance.find(a=>a.sessionId===ids.session&&a.delegateId===ids.france)!;
assert.ok(attendance);
const ordinary=await send({type:'attendance',sessionId:ids.session,delegateId:ids.france,status:attendance.status});
const afterFirst=await transport.read();await transport.send(ordinary);const afterRetry=await transport.read();
assert.deepEqual(afterFirst,afterRetry,'Successful retry must not apply twice');
await stale('attendance',{type:'attendance',sessionId:ids.session,delegateId:ids.france,status:attendance.status});
data=await transport.read();const queue=data.queue.filter(q=>q.sessionId===ids.session&&(q.lane??'open')==='open').sort((a,b)=>a.position-b.position);
await stale('queueOrder',{type:'queueOrder',sessionId:ids.session,lane:'open',ids:queue.map(q=>q.id)});
let speech=data.speeches?.find(s=>s.sessionId===ids.session&&s.state!=='finished');let createdSpeech=false;
if(!speech){await send({type:'speechStart',sessionId:ids.session,delegateId:ids.france,resolutionId:null,classification:'Other'});speech=(await transport.read()).speeches!.find(s=>s.sessionId===ids.session&&s.state!=='finished')!;createdSpeech=true;}
try{await stale('speech',{type:'poiAllowance',sessionId:ids.session,speechId:speech.id,limit:speech.poiLimit});}finally{if(createdSpeech)await send({type:'speechFinish',sessionId:ids.session,speechId:speech.id});}
const doc=(await transport.read()).documents.find(d=>d.committeeId===ids.ga1&&d.status==='Draft')!;assert.ok(doc);
await stale('document',{type:'document',id:doc.id,status:'Submitted'});
await stale('vote',{type:'vote',sessionId:ids.session,resolutionId:doc.id,delegateId:ids.france,choice:'For'});
const report={project:ref,startedAt,completedAt:new Date().toISOString(),purpose:'Single existing-identity RPC correctness verification, not a staff load/readiness baseline',cases,successfulWriteUnaffected:true,idempotentRetryExactlyOnce:true,clientConflictError:true,staleWritesChangedNothing:true,timedRequests:cases.length,clientMappingRequests:5,totalStaleRequests:cases.length+5,errors40001:0};
await writeFile('docs/stale-conflict-remote-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
