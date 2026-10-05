import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {session} from './remote-context.mts';
const conference=randomUUID(),school=randomUUID();const committees=Array.from({length:4},(_,i)=>({id:randomUUID(),session:randomUUID(),code:['GA1','WHO','HRC','SC'][i]}));
const delegates=Array.from({length:150},(_,i)=>({id:randomUUID(),committee:committees[i%4].id,session:committees[i%4].session}));
const sql=[`begin; insert into public.conferences(id,name,venue,date)values('${conference}','LOAD TEST · synthetic · ${new Date().toISOString()}','Development only','2026-10-05');`,`insert into public.schools(id,conference_id,name)values('${school}','${conference}','Load test school');`];
for(const c of committees){sql.push(`insert into public.committees(id,conference_id,code,name,room)values('${c.id}','${conference}','${c.code}','Load test ${c.code}','Simulation');`);sql.push(`insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state)values('${c.session}','${conference}','${c.id}','Simulation',now(),'active');`);sql.push(`insert into public.user_access(conference_id,user_id,role,committee_id,expires_at)values('${conference}','${session.user.id}','chair','${c.id}',now()+interval '4 hours');`);}
for(const role of ['admin','approval','logistics'])sql.push(`insert into public.user_access(conference_id,user_id,role,expires_at)values('${conference}','${session.user.id}','${role}',now()+interval '4 hours');`);
for(const [i,d]of delegates.entries())sql.push(`insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email)values('${d.id}','${conference}','${d.committee}','${school}','Country ${i}','Simulated delegate ${i}','load${i}@example.com');`);
sql.push(`insert into public.scoring_definitions(conference_id,code,label,values)values('${conference}','speech','Speech',ARRAY[1,2,3]);`,'commit;');
await writeFile('.test-sessions/load-fixtures.sql',sql.join('\n'),{mode:0o600});
await writeFile('.test-sessions/load-fixtures.json',JSON.stringify({conference,committees,delegates}),{mode:0o600});
console.log({conference,delegates:delegates.length,distinctAuthIdentities:1});
