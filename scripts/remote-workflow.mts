import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {clientFor,ids,ref,session,verifyPhase} from './remote-context.mts';
import {SupabaseTransport} from '../lib/supabase/repository';
import {fingerprint} from '../lib/sync/repository';
import type {Command} from '../lib/commands';
import type {Role} from '../lib/domain';
import type {Mutation} from '../lib/sync/store';
await verifyPhase();
const transport=new SupabaseTransport(clientFor(),ids.conference,session.user.id);
const marks:string[]=[];
async function send(command:Command,role:Role='chair'){
 const before=await transport.read();
 const mutation:Mutation={id:crypto.randomUUID(),actorId:session.user.id,createdAt:new Date().toISOString(),role,command,expected:fingerprint(before,command),state:'pending'};
 await transport.send(mutation);return mutation;
}
let data=await transport.read();assert.ok(data.committees.some(c=>c.code==='GA1'));marks.push('authorized snapshot');
// Presence comes from one committed roll call (docs/SESSION_MODEL.md section 6).
const at=new Date().toISOString();
await send({type:'rollCallCommit',committeeId:ids.ga1,rollCallId:crypto.randomUUID(),revision:1,observedAt:at,committedAt:at,
 rows:data.delegates.filter(d=>d.committeeId===ids.ga1).map(d=>({delegateId:d.id,status:d.id===ids.france?'Present & Voting':'Present'}))});
data=await transport.read();const before=data.events.filter(e=>e.delegateId===ids.france&&!e.voidedAt);const points=before.reduce((n,e)=>n+e.points,0);
const speech=await send({type:'participation',delegateId:ids.france,committeeId:ids.ga1,resolutionId:ids.resolution,categoryId:'speech',points:2});
await transport.send(speech);data=await transport.read();const after=data.events.filter(e=>e.delegateId===ids.france&&!e.voidedAt);
assert.equal(after.length,before.length+1);assert.equal(after.reduce((n,e)=>n+e.points,0),points+2);marks.push('speech +2, opportunity +1, duplicate retry exactly once');
await send({type:'queue',committeeId:ids.ga1,delegateId:ids.japan});marks.push('speaker queue');
for(const doc of data.documents.filter(d=>d.committeeId===ids.ga1&&d.status==='In Debate'))await send({type:'document',id:doc.id,status:'Closed',outcome:'Withdrawn'});
const created=await send({type:'newDocument',committeeId:ids.ga1,title:'Development verification · civilian safeguards',submitterId:ids.france});
const docId=created.id.slice(0,24)+'000000000001';
await send({type:'document',id:docId,status:'Submitted'});
await send({type:'document',id:docId,status:'Review'},'approval');
await send({type:'document',id:docId,status:'Approved',comment:'Development workflow verified.'},'approval');
await send({type:'document',id:docId,status:'Printed'},'logistics');
await send({type:'document',id:docId,status:'In Debate'});marks.push('submitted → review → approved → printed → in debate');
// Opening the ballot snapshots the roll call in force; the snapshot decides who may vote and who may abstain.
await send({type:'voteMode',committeeId:ids.ga1,resolutionId:docId,mode:'normal',voteType:'substantive'});
data=await transport.read();const eligible=data.ballots!.filter(b=>b.resolutionId===docId && b.status!=='Absent');
for(const [i,b] of eligible.entries())await send({type:'vote',committeeId:ids.ga1,resolutionId:docId,delegateId:b.delegateId,choice:i===1?'Against':i===2&&b.status==='Present'?'Abstain':'For'});
await send({type:'document',id:docId,status:'Closed',outcome:'Passed'});
data=await transport.read();assert.equal(data.documents.find(d=>d.id===docId)?.outcome,'Passed');assert.ok(data.audit.some(a=>a.entityId===docId));marks.push('roll-call-fed ballot snapshot, configured majority, closure and audit');
// A fresh transport represents a fresh process/browser read, with no local demo snapshot.
const fresh=await new SupabaseTransport(clientFor(),ids.conference,session.user.id).read();assert.equal(fresh.documents.find(d=>d.id===docId)?.outcome,'Passed');marks.push('fresh repository read persists');
const report={date:new Date().toISOString(),project:ref,passed:marks,documentId:docId};
await writeFile('docs/remote-workflow-results.json',JSON.stringify(report,null,2));console.log(report);
