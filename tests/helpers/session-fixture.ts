import {freshDatabase} from './database';

// Shared fixture for the session model database tests: an Executive, a GA1 Chair, a WHO Chair, and three central slots around "now"
// (past X, live A, future B) with GA1's schedule published back-dated so it was already in effect for the past slot.
export const U=(n:number)=>`79000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export const exec=U(1),chair=U(2),whoChair=U(3);
export const H=3600_000,M=60_000;
export const iso=(t:number)=>new Date(t).toISOString();
// Fixtures place sessions up to 5 hours either side of the real clock, and a session window never crosses local midnight. Run the conference
// in a fixed-offset zone where "now" is local midday, so the fixtures mean the same thing at any time of day (the real venue is Asia/Qatar).
export const fixtureTimeZone=(at=Date.now())=>{const k=12-new Date(at).getUTCHours();return k===0?'Etc/GMT':k>0?`Etc/GMT-${k}`:`Etc/GMT+${-k}`;};
export const day=(t:number)=>new Date(t).toLocaleDateString('en-CA',{timeZone:fixtureTimeZone()});
export const setFixtureTimeZone=async(db:{query:(sql:string,p?:unknown[])=>Promise<unknown>},conference:string)=>{
 await db.query(`insert into private.conference_settings(conference_id,time_zone) values($1,$2) on conflict (conference_id) do update set time_zone=excluded.time_zone`,[conference,fixtureTimeZone()]);};

export async function setupSessions(){
 const f=await freshDatabase();
 const {db,ids,query,as,asOwner,grant}=f;
 await setFixtureTimeZone(db,ids.conference);
 await grant(exec,'admin');await grant(chair,'chair',ids.ga1);await grant(whoChair,'chair',ids.who);
 const now=Date.now();
 const mutate=async(user:string,command:Record<string,unknown>,role:string,clientTime:number,key=crypto.randomUUID(),expected:string|null=null)=>{
  await as(user);
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,expected,iso(clientTime)]);return key;};
 const ops=async(user:string,command:Record<string,unknown>,role='admin',key=crypto.randomUUID())=>{
  await as(user);
  await db.query('select public.apply_operations_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,key,JSON.stringify(command),role,null,iso(Date.now())]);return key;};
 const slot=async(name:string,start:number,end:number)=>{
  await mutate(exec,{type:'sessionSlot',action:'create',name,startsAt:iso(start),endsAt:iso(end)},'admin',now);
  await asOwner();return (await query<{id:string}>('select id from public.conference_session_slots where name=$1',[name]))[0].id;};
 const X=await slot('Past X',now-4*H,now-2*H),A=await slot('Live A',now-10*M,now+3*H),B=await slot('Future B',now+4*H,now+5*H);
 const session=async(slotId:string,committee=ids.ga1)=>{await asOwner();return (await query<{id:string}>('select id from public.sessions where "slotId"=$1 and committee_id=$2',[slotId,committee]))[0].id;};
 await asOwner();
 await db.query(`insert into public.schedule_version(conference_id,committee_id,effective_from,changed_by,reason,automation_enabled,sessions)
  values($1,$2,$3,$4,'Fixture',true,private.ops_schedule_snapshot($1,$2,null))`,[ids.conference,ids.ga1,iso(now-12*H),exec]);
 const send=(command:Record<string,unknown>,clientTime:number,role='chair',user=chair,key=crypto.randomUUID(),expected:string|null=null)=>mutate(user,command,role,clientTime,key,expected);
 const one=async<T=Record<string,unknown>>(sql:string,p:unknown[]=[])=>{await asOwner();return (await query<T>(sql,p))[0];};
 const count=async(sql:string,p:unknown[]=[])=>Number((await one<{n:number}>(`select count(*)::int n from (${sql}) q`,p)).n);
 const score={type:'participation',sessionId:ids.session,delegateId:ids.france,categoryId:'speech',points:1,resolutionId:null};
 const eventOf=(key:string)=>key.slice(0,24)+'000000000001';
 const debateRevision=async()=>String((await one<{r:string}>('select coalesce((select revision from public.debate_states where committee_id=$1 and "sessionId" is null),0)::text r',[ids.ga1])).r);
 return {...f,now,mutate,ops,slot,session,send,one,count,score,eventOf,debateRevision,X,A,B};
}
