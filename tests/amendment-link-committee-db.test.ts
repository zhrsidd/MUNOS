import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {literal,realDatabase} from './helpers/postgres';

const token='a'.repeat(48),otherToken='b'.repeat(48);
const wrongSession='51000000-0000-4000-8000-000000000001';
const otherConference='51000000-0000-4000-8000-000000000002';
const otherCommittee='51000000-0000-4000-8000-000000000003';
const otherResolution='51000000-0000-4000-8000-000000000004';
const otherSchool='51000000-0000-4000-8000-000000000005';
const otherDelegate='51000000-0000-4000-8000-000000000006';
interface LinkInfo {
 committee:{id:string;code:string;name:string};
 resolution:{id:string;code:string;title:string;submitterId:string|null}|null;
 delegates:{id:string;country:string}[];
}
interface Engine {
 ids:Record<string,string>;
 exec(sql:string):Promise<unknown>;
 json<T>(sql:string):Promise<T>;
 close():Promise<void>;
}
async function embedded(upgradeAt?:string){
 const d=await freshDatabase({upgradeAt});
 const engine:Engine={ids:d.ids,exec:sql=>d.db.exec(sql),json:async<T>(sql:string)=>(await d.query<{j:T}>(sql))[0].j,close:()=>d.db.close()};
 return {...engine,upgrade:d.upgrade};
}
async function native(url:string):Promise<Engine>{
 const d=await realDatabase(url);
 return {ids:d.ids,exec:sql=>d.owner.query(`${sql};`),json:sql=>d.owner.json(`${sql};`),close:d.close};
}
async function prepare(e:Engine){
 await e.exec(`reset role;
  update public.committees set "currentSessionId"=null where id=${literal(e.ids.ga1)};
  update public.documents set "sessionId"=null where id=${literal(e.ids.resolution)};
  insert into public.amendment_links(conference_id,committee_id,token)
   values(${literal(e.ids.conference)},${literal(e.ids.ga1)},${literal(token)});`);
}
async function info(e:Engine,t=token,subject=''):Promise<LinkInfo|null>{
 await e.exec(`reset role;select set_config('request.jwt.claim.sub',${literal(subject)},false);set role service_role;`);
 return (await e.json<{value:LinkInfo|null}>(`select jsonb_build_object('value',public.amendment_link_info(${literal(t)})) as j`)).value;
}
async function properties(e:Engine){
 await e.exec('reset role;');
 return e.json(`select jsonb_build_object('oid',p.oid::text,'owner',p.proowner::text,'acl',p.proacl::text,
  'definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,'returns',p.prorettype::regtype::text) as j
  from pg_proc p where p.oid='public.amendment_link_info(text)'::regprocedure`);
}
async function cases(t:TestContext,e:Engine){
 await prepare(e);
 const check=async(name:string,run:()=>Promise<void>)=>{
  await t.test(name,async()=>{
   await e.exec('reset role;begin;');
   try{await run();}finally{await e.exec('rollback;reset role;');}
  });
 };
 await check('a committee-keyed resolution opens with no selected session and keeps its public identity',async()=>{
  const link=await info(e);
  assert.ok(link?.resolution,'the In Debate resolution must not depend on a selected session');
  assert.equal(link.committee.id,e.ids.ga1);
  assert.deepEqual(Object.keys(link).sort(),['committee','delegates','resolution']);
  assert.deepEqual(Object.keys(link.resolution).sort(),['code','id','submitterId','title']);
  assert.equal(link.resolution.id,e.ids.resolution);
  assert.equal(link.resolution.submitterId,e.ids.france);
  assert.equal(link.resolution.code,'GA1 / 01');
  assert.ok(link.delegates.some(d=>d.id===e.ids.france));
 });
 await check('a wrong retained session pointer cannot close committee debate',async()=>{
  await e.exec(`insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state)
   values(${literal(wrongSession)},${literal(e.ids.conference)},${literal(e.ids.ga1)},'Retained label',now(),'active');
   update public.committees set "currentSessionId"=${literal(wrongSession)} where id=${literal(e.ids.ga1)};
   update public.documents set "sessionId"=${literal(e.ids.session)} where id=${literal(e.ids.resolution)};`);
  assert.equal((await info(e))?.resolution?.id,e.ids.resolution);
 });
 await check('a valid link with no resolution In Debate returns a closed form',async()=>{
  await e.exec(`update public.documents set status='Approved' where id=${literal(e.ids.resolution)};`);
  const link=await info(e);assert.ok(link);assert.equal(link.committee.id,e.ids.ga1);assert.equal(link.resolution,null);
 });
 await check('revoked and unknown links return nothing',async()=>{
  assert.equal(await info(e,'unknown-link'),null);
  await e.exec(`reset role;update public.amendment_links set revoked_at=now() where committee_id=${literal(e.ids.ga1)};`);
  assert.equal(await info(e),null);
 });
 await check('an archived committee returns nothing',async()=>{
  await e.exec(`update public.committees set archived=true where id=${literal(e.ids.ga1)};`);
  assert.equal(await info(e),null);
 });
 await check('link class must match the lifecycle even for a server principal with a subject',async()=>{
  await e.exec(`update public.amendment_links set test_only=false where committee_id=${literal(e.ids.ga1)};`);
  assert.equal(await info(e,token,e.ids.france),null);
 });
 await check('committee and conference scope, delegate projection and composite binding stay narrow',async()=>{
  await e.exec(`insert into public.conferences(id,name,venue,date) values(${literal(otherConference)},'SYNTHETIC · other conference','Test',current_date);
   insert into public.schools(id,conference_id,name) values(${literal(otherSchool)},${literal(otherConference)},'Other test school');
   insert into public.committees(id,conference_id,code,name,room) values(${literal(otherCommittee)},${literal(otherConference)},'OTHER','Other committee','Test');
   insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email)
    values(${literal(otherDelegate)},${literal(otherConference)},${literal(otherCommittee)},${literal(otherSchool)},'Other country','Synthetic delegate','other@example.com');
   insert into public.documents(id,conference_id,committee_id,"submitterId",code,title,status) values(${literal(otherResolution)},${literal(otherConference)},${literal(otherCommittee)},${literal(otherDelegate)},'OTHER / 01','Other resolution','In Debate');
   insert into public.amendment_links(conference_id,committee_id,token) values(${literal(otherConference)},${literal(otherCommittee)},${literal(otherToken)});
   do $scope$begin
    update public.amendment_links set conference_id=${literal(otherConference)} where committee_id=${literal(e.ids.ga1)};
    raise exception 'Expected conference/committee foreign-key denial';
   exception when foreign_key_violation then null;end $scope$;`);
  const link=await info(e),other=await info(e,otherToken);assert.ok(link&&other);
  assert.equal(link.resolution?.id,e.ids.resolution);
  assert.equal(other.committee.id,otherCommittee);assert.equal(other.resolution?.id,otherResolution);
  assert.equal(other.resolution?.submitterId,otherDelegate);
  await e.exec('reset role;');
  const expected=await e.json<{ids:string[]}>(`select jsonb_build_object('ids',jsonb_agg(id::text order by id)) as j from public.delegates where committee_id=${literal(e.ids.ga1)}`);
  assert.deepEqual(link.delegates.map(d=>d.id).sort(),expected.ids.sort());
  assert.ok(link.delegates.every(d=>Object.keys(d).sort().join(',')==='country,id'));
 });
 await check('only service_role can execute, without widening PUBLIC or API-role access',async()=>{
  const acl=await e.json<{public:boolean;anon:boolean;authenticated:boolean;service:boolean}>(`select jsonb_build_object(
   'public',exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.amendment_link_info(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
   'anon',has_function_privilege('anon','public.amendment_link_info(text)','EXECUTE'),
   'authenticated',has_function_privilege('authenticated','public.amendment_link_info(text)','EXECUTE'),
   'service',has_function_privilege('service_role','public.amendment_link_info(text)','EXECUTE')) as j`);
  assert.deepEqual(acl,{public:false,anon:false,authenticated:false,service:true});
  for(const role of ['anon','authenticated'])await e.exec(`set role ${role};
   do $denied$begin perform public.amendment_link_info(${literal(token)});raise exception 'Expected EXECUTE denial';
   exception when insufficient_privilege then null;end $denied$;reset role;`);
  assert.equal((await info(e))?.resolution?.id,e.ids.resolution);
  assert.equal((await info(e,token,e.ids.france))?.resolution?.id,e.ids.resolution);
 });
}
test('PGlite: amendment link metadata follows committee debate and retains every access guard',async t=>{
 const e=await embedded();try{await cases(t,e);}finally{await e.close();}
});
test('PostgreSQL 17: amendment link metadata follows committee debate and retains every access guard',
 {skip:!process.env.TEST_POSTGRES_URL},async t=>{
  const e=await native(process.env.TEST_POSTGRES_URL!);try{await cases(t,e);}finally{await e.close();}
 });
test('upgrading amendment metadata preserves its function identity, security properties and ACL',async()=>{
 const e=await embedded('20261101090000_snapshot_committee_prefilter.sql');
 try{
  await prepare(e);const before=await properties(e);
  assert.equal((await info(e))?.resolution,null,'the applied-chain definition reproduces the old session-pointer defect');
  await e.upgrade();
  assert.deepEqual(await properties(e),before,'CREATE OR REPLACE must retain ownership, ACL and pinned definer properties');
  assert.equal((await info(e))?.resolution?.id,e.ids.resolution);
 }finally{await e.close();}
});
