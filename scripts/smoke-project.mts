// Controlled smoke test of a DCMUN project in its development role, through the app's own client code
// (lib/access-codes and SupabaseTransport). Creates only clearly labelled TEST records in the test conference.
// Inputs (environment, never printed): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
// NEXT_PUBLIC_CONFERENCE_ID, STAGING_SUPABASE_REFS (target guard), SMOKE_EXECUTIVE_CODE (an Executive code).
// Prints pass marks and ids only: no keys, tokens or access codes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {assertToolTarget} from '../lib/platform/target-guard';
import {listAccessCodes,redeemStaffCode,rotateAccessCode} from '../lib/access-codes';
import {SupabaseTransport} from '../lib/supabase/repository';
import {ConflictError} from '../lib/sync/repository';
import type {Command} from '../lib/commands';
import type {OperationsCommand} from '../lib/operations/commands';
import {operationsFingerprint} from '../lib/operations/fingerprint';
import type {Role} from '../lib/domain';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,conf=process.env.NEXT_PUBLIC_CONFERENCE_ID!;
const ref=assertToolTarget(url);
assert.ok(key&&conf&&process.env.SMOKE_EXECUTIVE_CODE,'Publishable key, conference id and SMOKE_EXECUTIVE_CODE are required');
const device=()=>createClient(url!,key,{auth:{persistSession:false,autoRefreshToken:false}});
const userId=async(c:SupabaseClient)=>(await c.auth.getSession()).data.session!.user.id;
const marks:string[]=[];const pass=(m:string)=>{marks.push(m);console.log('PASS',m);};
const entity=(mutation:string)=>mutation.slice(0,24)+'000000000001';
const expires=new Date(Date.now()+24*3600_000).toISOString();

async function send(t:SupabaseTransport,actor:string,role:Role,command:Command,expected:string|null=null,id=randomUUID(),createdAt=new Date().toISOString()){
 await t.send({id,createdAt,actorId:actor,role,command,expected,state:'pending'});
 return {id,createdAt};
}
async function refused(p:Promise<unknown>,pattern?:RegExp){
 try{await p;}catch(e){// By constructor name: tsx can load lib/sync/repository twice (ESM script, CJS library), so instanceof is unreliable here.
 assert.equal((e as Error).constructor.name,ConflictError.name,`expected a ConflictError, got ${(e as Error).message}`);if(pattern)assert.match((e as Error).message,pattern);return;}
 assert.fail('expected refusal');
}

// 1. Executive device redeems the Executive code through the normal gate.
const stranger=device();
assert.equal(await redeemStaffCode(stranger,conf,'0000-0000-0000-0000-0000-0000'),'invalid');pass('wrong code is refused as invalid');
const exec=device();
assert.equal(await redeemStaffCode(exec,conf,process.env.SMOKE_EXECUTIVE_CODE!),'ok');
const execId=await userId(exec);pass('Executive code redeemed on a fresh anonymous device');
const execT=new SupabaseTransport(exec,conf,execId,[],false,['admin']);
const first=await execT.read();
assert.equal(first.conference.name,'DCMUN Development Test');pass('Executive snapshot reads the test conference');

// 2. Executive builds a minimal TEST committee (reused if an earlier run created it).
const committeeId=first.committees.find(c=>c.code==='TST')?.id ?? entity((await send(execT,execId,'admin',{type:'committee',code:'TST',name:'TEST Committee (not real)',room:'TEST Room'})).id);
const schoolId=first.schools.find(s=>s.name==='TEST School (not real)')?.id ?? entity((await send(execT,execId,'admin',{type:'school',name:'TEST School (not real)'})).id);
if(!first.delegates.some(d=>d.committeeId===committeeId))await send(execT,execId,'admin',{type:'import',rows:[
 {name:'TEST Delegate A',country:'France',email:'test-delegate-a@example.com',schoolId,committeeId},
 {name:'TEST Delegate B',country:'Japan',email:'test-delegate-b@example.com',schoolId,committeeId}]});
let built=await execT.read();
if(!built.sessions.some(s=>s.committeeId===committeeId)){await send(execT,execId,'admin',{type:'session',committeeId,name:'TEST Session 1'});built=await execT.read();}
const committee=built.committees.find(c=>c.id===committeeId);assert.ok(committee,'committee visible');
const delegates=built.delegates.filter(d=>d.committeeId===committeeId);assert.equal(delegates.length,2);
const session=built.sessions.find(s=>s.committeeId===committeeId)!;assert.ok(session,'session exists');
pass(`TEST committee ${committeeId}, 2 delegates, session ${session.id}`);

// 3. An identical replay of a mutation (same id, payload and client time) is idempotent; a changed payload is refused.
const replay={type:'school',name:`TEST School replay ${Date.now()}`} as Command;
const original=await send(execT,execId,'admin',replay);
await send(execT,execId,'admin',replay,null,original.id,original.createdAt);
assert.equal((await execT.read()).schools.filter(s=>s.name===(replay as {name:string}).name).length,1);pass('replayed mutation is idempotent');
await refused(send(execT,execId,'admin',{type:'school',name:'TEST other'},null,original.id,original.createdAt),/Idempotency key reused/);pass('reused mutation id with a different payload is refused');

// 4. Chair code for the TEST committee, redeemed on a second device.
const chairCode=await rotateAccessCode(exec,conf,'chair',committeeId,expires);
const chair=device();
assert.equal(await redeemStaffCode(chair,conf,chairCode),'ok');
const chairId=await userId(chair);pass('Chair code redeemed on a second fresh device');
const chairT=new SupabaseTransport(chair,conf,chairId,[committeeId],false,['chair']);
const chairView=await chairT.read();
assert.ok(chairView.committees.some(c=>c.id===committeeId));pass('Chair snapshot shows the assigned committee');

// 5. Core Chair operations: attendance, speaker queue, stale conflict, role boundary.
const [a,b]=delegates;
const revision=(delegateId:string)=>String(chairView.attendance.find(r=>r.sessionId===session.id&&r.delegateId===delegateId)?.revision ?? 0);
await send(chairT,chairId,'chair',{type:'attendance',sessionId:session.id,delegateId:a.id,status:'Present'},revision(a.id));
await send(chairT,chairId,'chair',{type:'attendance',sessionId:session.id,delegateId:b.id,status:'Present & Voting'},revision(b.id));
let after=await chairT.read();
assert.equal(after.attendance.filter(r=>r.sessionId===session.id).length,2);pass('Chair records attendance');
await send(chairT,chairId,'chair',{type:'queue',sessionId:session.id,delegateId:a.id});
after=await chairT.read();
assert.ok(after.queue.some(q=>q.delegateId===a.id));pass('Chair adds a speaker to the queue');
await refused(send(chairT,chairId,'chair',{type:'attendance',sessionId:session.id,delegateId:a.id,status:'Absent'},revision(a.id)));pass('stale attendance edit is a conflict, not an overwrite');
await refused(send(chairT,chairId,'chair',{type:'committee',code:'BAD',name:'x',room:'x'}));pass('Chair cannot run an Executive command');
await assert.rejects(listAccessCodes(chair,conf));pass('Chair cannot read access-code status');

// 6. Executive opens the delegate submission link for the TEST committee (used by the server-path check).
const linkCommand={type:'submissionLink',action:'create',committeeId,token:randomUUID().replaceAll('-','')} as OperationsCommand;
await send(execT,execId,'admin',linkCommand,operationsFingerprint(await execT.read(),linkCommand));
const ops=await execT.read();
assert.ok((ops as {submissionLinks?:{committeeId:string}[]}).submissionLinks?.some(l=>l.committeeId===committeeId));pass('Executive creates the TEST submission link');

// 7. Executive issues a normal Executive code; rotation retires the code this run redeemed (last, so a failed run keeps it).
await rotateAccessCode(exec,conf,'admin',null,expires);
const codes=await listAccessCodes(exec,conf);
assert.equal(codes.filter(c=>c.role==='admin'&&c.active).length,1,'exactly one active Executive code');pass('Executive rotation leaves one active Executive code');
console.log(JSON.stringify({project:ref,conference:conf,committee:committeeId,session:session.id,passed:marks.length},null,1));
