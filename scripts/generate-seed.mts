import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createSeed} from '../lib/seed';
export const conf='10000000-0000-4000-8000-000000000001';
const uuid=(id:string)=>{if(id==='conf1')return conf; const h=createHash('sha256').update('conference-os-development:'+id).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const seed=createSeed();
const out:string[]=['-- Synthetic DEVELOPMENT records only. All emails use example.com. No access grants.','begin;'];
const val=(v:unknown):string=>v===null||v===undefined?'null':typeof v==='number'?String(v):typeof v==='object'?`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`:`'${String(v).replaceAll("'","''")}'`;
function insert(table:string,row:Record<string,unknown>,to=out){to.push(`insert into public.${table} (${Object.keys(row).map(k=>`"${k}"`).join(',')}) values (${Object.values(row).map(val).join(',')}) on conflict do nothing;`);}
insert('conferences',{...seed.conference,id:conf,voting_rule:'simple_majority'});
for(const c of seed.committees)insert('committees',{id:uuid(c.id),conference_id:conf,code:c.code==='ECOSOC'?'WHO':c.code==='UNHRC'?'HRC':c.code,name:c.code==='ECOSOC'?'World Health Organization':c.name,room:c.room});
for(const s of seed.schools)insert('schools',{...s,id:uuid(s.id),conference_id:conf});
for(const d of seed.delegates){const {committeeId,...rest}=d;insert('delegates',{...rest,id:uuid(d.id),conference_id:conf,committee_id:uuid(committeeId),schoolId:uuid(d.schoolId)});}
for(const s of seed.sessions){const{committeeId,...rest}=s;insert('sessions',{...rest,id:uuid(s.id),conference_id:conf,committee_id:uuid(committeeId)});}
insert('sessions',{id:uuid('s4'),conference_id:conf,committee_id:uuid('unhrc'),name:'Session 1 · Human rights',startsAt:'2026-10-05T06:30:00Z',state:'active'});
for(const d of seed.documents){const{committeeId,versionIds,comments,...rest}=d;void versionIds;void comments;insert('documents',{...rest,id:uuid(d.id),conference_id:conf,committee_id:uuid(committeeId),sessionId:d.sessionId?uuid(d.sessionId):null,submitterId:uuid(d.submitterId),code:d.code.replace('ECOSOC','WHO')});}
for(const v of seed.versions)insert('document_versions',{...v,id:uuid(v.id),conference_id:conf,committee_id:uuid(seed.documents.find(d=>d.id===v.documentId)!.committeeId),documentId:uuid(v.documentId),createdBy:null});
for(const s of seed.scoring)out.push(`insert into public.scoring_definitions(id,conference_id,code,label,values) values(${val(uuid(s.id))},${val(conf)},${val(s.id)},${val(s.label)},ARRAY[${s.values.join(',')}]) on conflict do nothing;`);
// Live state is keyed by committee and presence comes from committed roll calls (docs/SESSION_MODEL.md sections 6 and 8). Upgrade tests
// seed an older schema first, so the live rows are written in the shape that schema has: committee-keyed rows and roll calls once
// 20261031090000_committee_live_state is applied, otherwise the session-keyed rows (attendance, queue, events, a timer) it replaced.
const current:string[]=[],legacy:string[]=[];
const legacySession:Record<string,string>={ga1:'s1',ecosoc:'s2',sc:'s3'};
const committeeOf=(x:{committeeId?:string;sessionId?:string|null})=>x.committeeId??seed.sessions.find(s=>s.id===x.sessionId)!.committeeId;
for(const r of seed.rollCalls??[]){
 insert('roll_call',{id:uuid(r.id),revision:r.revision,conference_id:conf,committee_id:uuid(r.committeeId),state:'committed',observed_at:r.observedAt,local_committed_at:r.committedAt,server_committed_at:r.committedAt,received_at:r.committedAt,effective_at:r.effectiveAt,time_confidence:'trusted',created_by:uuid('seed-chair')},current);
 for(const row of r.rows)insert('roll_call_row',{roll_call_id:uuid(r.id),revision:r.revision,conference_id:conf,committee_id:uuid(r.committeeId),delegate_id:uuid(row.delegateId),status:row.status},current);
}
seed.delegates.forEach((d,i)=>{const status=seed.rollCalls?.find(r=>r.committeeId===d.committeeId)?.rows.find(x=>x.delegateId===d.id)?.status;const sessionId=legacySession[d.committeeId];
 if(status&&sessionId)insert('attendance',{id:uuid(`a${i}`),delegateId:uuid(d.id),sessionId:uuid(sessionId),status,updatedAt:'2026-10-05T06:30:00.000Z',conference_id:conf,committee_id:uuid(d.committeeId)},legacy);});
for(const e of seed.events){const{committeeId,sessionId,...rest}=e;void committeeId;const cid=committeeOf(e);
 for(const [to,sid] of [[current,sessionId],[legacy,sessionId??legacySession[cid]]] as const)insert('participation_events',{...rest,id:uuid(e.id),conference_id:conf,committee_id:uuid(cid),sessionId:sid?uuid(sid):null,delegateId:uuid(e.delegateId),resolutionId:e.resolutionId?uuid(e.resolutionId):null,chairId:null},to);}
for(const q of seed.queue){const{position,committeeId,sessionId,...rest}=q;void position;void committeeId;const cid=committeeOf(q);
 for(const [to,sid] of [[current,sessionId],[legacy,sessionId??legacySession[cid]]] as const)insert('speaker_queue',{...rest,id:uuid(q.id),conference_id:conf,committee_id:uuid(cid),sessionId:sid?uuid(sid):null,delegateId:uuid(q.delegateId)},to);}
out.push(`do $seed$ begin
if exists(select 1 from information_schema.columns where table_schema='public' and table_name='roll_call' and column_name='effective_at') then
${current.join('\n')}
else
${legacy.join('\n')}
end if;
end $seed$;`);
for(const staff of seed.staff){insert('staff',{id:uuid(staff.id),conference_id:conf,name:staff.name});insert('conference_staff',{id:uuid(staff.id+'-role'),conference_id:conf,staff_id:uuid(staff.id),role:staff.role});for(const c of staff.committeeIds)insert('committee_staff',{id:uuid(staff.id+c),conference_id:conf,committee_id:uuid(c),staff_id:uuid(staff.id)});}
out.push('commit;');await writeFile('supabase/seed.sql',out.join('\n')+'\n');
await writeFile('supabase/fixture-ids.json',JSON.stringify({conference:conf,ga1:uuid('ga1'),who:uuid('ecosoc'),hrc:uuid('unhrc'),sc:uuid('sc'),session:uuid('s1'),france:uuid('d0'),japan:uuid('d1'),resolution:uuid('r1')},null,2));
