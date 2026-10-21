import {randomUUID} from 'node:crypto';
import {literal} from './postgres';
/** SQL that adds a disposable committee (code `code`) with a session, three delegates and a submission link. Run as the owner. */
export function committeeSql(conference:string,code:string){
 const committee=randomUUID(),session=randomUUID(),token=`${code}${'Z'.repeat(30)}`.slice(0,40).replace(/[^A-Za-z0-9_-]/g,'Z');
 const delegates=[1,2,3].map(()=>randomUUID());
 const sql=`insert into public.committees(id,conference_id,code,name,room) values(${literal(committee)},${literal(conference)},${literal(code)},${literal(`${code} committee`)},'Room');
  insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values(${literal(session)},${literal(conference)},${literal(committee)},'Session 1',now(),'scheduled');
  ${delegates.map((id,i)=>`insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email) values(${literal(id)},${literal(conference)},${literal(committee)},(select id from public.schools limit 1),'Country ${code} ${i}','Delegate ${i}','${code.toLowerCase()}${i}@example.com');`).join('\n')}
  insert into public.submission_links(conference_id,committee_id,token) values(${literal(conference)},${literal(committee)},${literal(token)});`;
 return {committee,session,token,delegates,sql};
}
export const newDocumentCommand=(c:{committee:string;session:string;delegates:string[]},title='Draft')=>JSON.stringify({type:'newDocument',committeeId:c.committee,sessionId:c.session,title,submitterId:c.delegates[0]});
export const googleDoc=(n:string)=>n.padEnd(30,'x');
