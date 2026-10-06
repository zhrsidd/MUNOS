import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createSeed} from '../lib/seed';
export const conf='10000000-0000-4000-8000-000000000001';
const uuid=(id:string)=>{if(id==='conf1')return conf; const h=createHash('sha256').update('conference-os-development:'+id).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const seed=createSeed();
const out:string[]=['-- Synthetic DEVELOPMENT records only. All emails use example.com. No access grants.','begin;'];
const val=(v:unknown):string=>v===null||v===undefined?'null':typeof v==='number'?String(v):typeof v==='object'?`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`:`'${String(v).replaceAll("'","''")}'`;
function insert(table:string,row:Record<string,unknown>){out.push(`insert into public.${table} (${Object.keys(row).map(k=>`"${k}"`).join(',')}) values (${Object.values(row).map(val).join(',')}) on conflict do nothing;`);}
insert('conferences',{...seed.conference,id:conf,voting_rule:'simple_majority'});
for(const c of seed.committees)insert('committees',{id:uuid(c.id),conference_id:conf,code:c.code==='ECOSOC'?'WHO':c.code==='UNHRC'?'HRC':c.code,name:c.code==='ECOSOC'?'World Health Organization':c.name,room:c.room});
for(const s of seed.schools)insert('schools',{...s,id:uuid(s.id),conference_id:conf});
for(const d of seed.delegates){const {committeeId,...rest}=d;insert('delegates',{...rest,id:uuid(d.id),conference_id:conf,committee_id:uuid(committeeId),schoolId:uuid(d.schoolId)});}
for(const s of seed.sessions){const{committeeId,...rest}=s;insert('sessions',{...rest,id:uuid(s.id),conference_id:conf,committee_id:uuid(committeeId)});}
insert('sessions',{id:uuid('s4'),conference_id:conf,committee_id:uuid('unhrc'),name:'Session 1 · Human rights',startsAt:'2026-10-05T06:30:00Z',state:'active'});
for(const d of seed.documents){const{committeeId,versionIds,comments,...rest}=d;void versionIds;void comments;insert('documents',{...rest,id:uuid(d.id),conference_id:conf,committee_id:uuid(committeeId),sessionId:d.sessionId?uuid(d.sessionId):null,submitterId:uuid(d.submitterId),code:d.code.replace('ECOSOC','WHO')});}
for(const v of seed.versions)insert('document_versions',{...v,id:uuid(v.id),conference_id:conf,committee_id:uuid(seed.documents.find(d=>d.id===v.documentId)!.committeeId),documentId:uuid(v.documentId),createdBy:null});
for(const a of seed.attendance)insert('attendance',{...a,id:uuid(a.id),conference_id:conf,committee_id:uuid(seed.sessions.find(s=>s.id===a.sessionId)!.committeeId),sessionId:uuid(a.sessionId),delegateId:uuid(a.delegateId)});
for(const s of seed.scoring)out.push(`insert into public.scoring_definitions(id,conference_id,code,label,values) values(${val(uuid(s.id))},${val(conf)},${val(s.id)},${val(s.label)},ARRAY[${s.values.join(',')}]) on conflict do nothing;`);
for(const e of seed.events)insert('participation_events',{...e,id:uuid(e.id),conference_id:conf,committee_id:uuid(seed.sessions.find(s=>s.id===e.sessionId)!.committeeId),sessionId:uuid(e.sessionId),delegateId:uuid(e.delegateId),resolutionId:e.resolutionId?uuid(e.resolutionId):null,chairId:null});
for(const q of seed.queue){const{position,...rest}=q;void position;insert('speaker_queue',{...rest,id:uuid(q.id),conference_id:conf,committee_id:uuid(seed.sessions.find(s=>s.id===q.sessionId)!.committeeId),sessionId:uuid(q.sessionId),delegateId:uuid(q.delegateId)});}
for(const [sessionId,t] of Object.entries(seed.timers))insert('timers',{...t,id:uuid('timer-'+sessionId),conference_id:conf,committee_id:uuid(seed.sessions.find(s=>s.id===sessionId)!.committeeId),sessionId:uuid(sessionId)});
for(const staff of seed.staff){insert('staff',{id:uuid(staff.id),conference_id:conf,name:staff.name});insert('conference_staff',{id:uuid(staff.id+'-role'),conference_id:conf,staff_id:uuid(staff.id),role:staff.role});for(const c of staff.committeeIds)insert('committee_staff',{id:uuid(staff.id+c),conference_id:conf,committee_id:uuid(c),staff_id:uuid(staff.id)});}
out.push('commit;');await writeFile('supabase/seed.sql',out.join('\n')+'\n');
await writeFile('supabase/fixture-ids.json',JSON.stringify({conference:conf,ga1:uuid('ga1'),who:uuid('ecosoc'),hrc:uuid('unhrc'),sc:uuid('sc'),session:uuid('s1'),france:uuid('d0'),japan:uuid('d1'),resolution:uuid('r1')},null,2));
