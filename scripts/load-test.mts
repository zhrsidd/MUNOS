// Development guard is enforced by remote-context. Never substitute production URLs.
import {readFile,writeFile} from 'node:fs/promises';
import {clientFor,session,ref} from './remote-context.mts';
import {SupabaseTransport} from '../lib/supabase/repository';
import type {Mutation} from '../lib/sync/store';
import type {Command} from '../lib/commands';
import type {Role} from '../lib/domain';
const fixture=JSON.parse(await readFile('.test-sessions/load-fixtures.json','utf8')) as {conference:string;delegates:{id:string;committee:string;session:string}[]};
const concurrency=Number(process.env.LOAD_CLIENTS||150);if(concurrency<1||concurrency>200)throw Error('Use 1–200 clients');
const timings:Record<string,number[]>={};const errors:{phase:string;message:string}[]=[];
let disconnects=0,connections=0,reconnections=0;
async function measure<T>(phase:string,op:()=>Promise<T>):Promise<T>{const start=performance.now();try{return await op();}catch(e){errors.push({phase,message:e instanceof Error?e.message:JSON.stringify(e)});throw e;}finally{(timings[phase]??=[]).push(performance.now()-start);}}
const clients=Array.from({length:concurrency},()=>clientFor());
const channels=clients.map((client,i)=>client.channel(`load-${Date.now()}-${i}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'operational_changes',filter:`conference_id=eq.${fixture.conference}`},()=>{}));
await Promise.all(channels.map(channel=>measure('realtime_connect',()=>new Promise<void>(resolve=>{
 let done=false;const timeout=setTimeout(()=>{if(!done){done=true;errors.push({phase:'realtime_connect',message:'Subscription timed out'});resolve();}},20000);
 channel.subscribe(status=>{if(status==='SUBSCRIBED'&&!done){done=true;clearTimeout(timeout);connections++;resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')disconnects++;});
}))));
await Promise.allSettled(clients.map(async(client,i)=>{
 const transport=new SupabaseTransport(client,fixture.conference,session.user.id);const d=fixture.delegates[i%fixture.delegates.length];
 await measure('burst_read',()=>transport.read());
 async function send(command:Command,expected:string|null=null,role:Role='chair',id=crypto.randomUUID()){
 const m:Mutation={id,createdAt:new Date().toISOString(),actorId:session.user.id,command,expected,role,state:'pending'};
 await measure(command.type,()=>transport.send(m));return m;
 }
 await send({type:'attendance',delegateId:d.id,sessionId:d.session,status:'Present'},'0');
 const speech=await send({type:'participation',delegateId:d.id,sessionId:d.session,resolutionId:null,categoryId:'speech',points:2});
 await measure('duplicate_retry',()=>transport.send(speech));
 const draft=await send({type:'newDocument',committeeId:d.committee,sessionId:d.session,submitterId:d.id,title:`Load verification ${i}`});
 const id=draft.id.slice(0,24)+'000000000001';
 await send({type:'document',id,status:'Submitted'},'1');await send({type:'document',id,status:'Approved'},'2','approval');await send({type:'document',id,status:'Printed'},'3','logistics');
}));
// Close and rebuild every channel to exercise reconnect. HTTP requests continue independently.
await Promise.all(channels.map((c,i)=>clients[i].removeChannel(c)));
await Promise.all(clients.map((client,i)=>measure('realtime_reconnect',()=>new Promise<void>(resolve=>{
 const channel=client.channel(`reconnect-${Date.now()}-${i}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'operational_changes',filter:`conference_id=eq.${fixture.conference}`},()=>{});
 const timer=setTimeout(()=>{errors.push({phase:'realtime_reconnect',message:'Subscription timed out'});resolve();},20000);
 channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);reconnections++;resolve();}});
}))));
const data=await new SupabaseTransport(clients[0],fixture.conference,session.user.id).read();
const writes={expectedParticipation:concurrency,actualParticipation:data.events.length,duplicateParticipation:Math.max(0,data.events.length-concurrency),attendance:data.attendance.length,printed:data.documents.filter(d=>d.status==='Printed').length};
await Promise.all(clients.map(c=>c.removeAllChannels()));
const percentiles=Object.fromEntries(Object.entries(timings).map(([phase,t])=>{t.sort((a,b)=>a-b);const p=(n:number)=>Math.round(t[Math.min(t.length-1,Math.ceil(t.length*n)-1)]);return[phase,{requests:t.length,p50_ms:p(.5),p95_ms:p(.95),p99_ms:p(.99)}];}));
const report={date:new Date().toISOString(),project:ref,conference:fixture.conference,concurrency,distinctAuthIdentities:1,authNote:'150 simulated operational clients reuse one explicitly authorized test identity. This is not a 150-person anonymous enrollment/NAT burst test.',requests:Object.values(timings).reduce((n,t)=>n+t.length,0),errorRate:errors.length/Object.values(timings).reduce((n,t)=>n+t.length,0),errors,writes,realtime:{connections,reconnections,disconnects},latency:percentiles,databaseCpu:'Not available from Data API; inspect Supabase Observability for this time window.'};
await writeFile('docs/load-test-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(errors.length||writes.actualParticipation!==concurrency||writes.printed!==concurrency)process.exitCode=1;
