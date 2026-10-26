import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build,collect,psql,stable,type Mode} from '../scripts/isolation-inventory/inventory.mjs';
import {evaluatePolicy,loadAllow,type PolicyModel} from '../scripts/isolation-inventory/policy.mjs';

// HD4: permission-drift checks. Part 1 needs no database: the policy is a pure function over the inventory model, run here on
// the committed model and on hand-mutated copies. Part 2 (TEST_POSTGRES_URL, loopback PostgreSQL 17) mutates a disposable
// database built from the real migrations and proves that every kind of drift is caught by the policy and/or by the byte
// comparison with docs/generated that `npm run check:grants` performs.
const committed=JSON.parse(readFileSync('docs/generated/isolation-t1-inventory.json','utf8'))['supabase-model'] as Mode;
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x)) as T;
const has=(v:string[],needle:RegExp)=>v.some(x=>needle.test(x));

test('policy: the committed model (current tree) has no violations', () => {
 assert.deepEqual(evaluatePolicy(committed as unknown as PolicyModel),[]);
});

test('policy: each rule fails on a hand-mutated copy of the committed model', () => {
 const run=(mutate:(m:Mode)=>void)=>{const m=clone(committed);mutate(m);return evaluatePolicy(m as unknown as PolicyModel);};
 const table=(m:Mode)=>m.rels.find(r=>r.kind==='r'&&r.name==='committees')??m.rels.find(r=>r.kind==='r')!;
 const fn=(m:Mode)=>m.fns.find(f=>!f.exec.service_role&&f.name!=='')!;
 assert.ok(has(run(m=>{table(m).privs.anon=['SELECT'];}),/anon \(or PUBLIC\) holds SELECT/));
 assert.ok(has(run(m=>{table(m).privs.service_role=['TRUNCATE'];}),/service_role holds TRUNCATE/));
 assert.ok(has(run(m=>{table(m).privs.service_role=['SELECT'];}),/service_role holds SELECT/));
 assert.ok(has(run(m=>{table(m).privs.authenticated=['SELECT','INSERT'];}),/authenticated holds INSERT/));
 assert.ok(has(run(m=>{table(m).privs.authenticated=['MAINTAIN'];}),/authenticated holds MAINTAIN/));
 assert.ok(has(run(m=>{table(m).rls=false;}),/row level security is not enabled/));
 assert.ok(has(run(m=>{fn(m).publicExec=true;}),/EXECUTE held by PUBLIC/));
 assert.ok(has(run(m=>{fn(m).exec.anon=true;}),/EXECUTE held by anon/));
 assert.ok(has(run(m=>{fn(m).exec.service_role=true;}),/service_role but not in serviceRoleExecute/));
 assert.ok(has(run(m=>{const f=fn(m);f.security='definer';f.config='';}),/SECURITY DEFINER without a pinned search_path/));
 assert.ok(has(run(m=>{const f=fn(m);f.security='definer';f.config='search_path=public';}),/./)===false);
 assert.ok(has(run(m=>{m.rels.push({schema:'public',name:'v_new',kind:'v',owner:'postgres',rls:false,forceRls:false,options:'',aclRaw:'',privs:{anon:[],authenticated:[],service_role:[],authenticator:[],postgres:[]}});}),/view public\.v_new: not in viewsWithoutRls/));
 assert.ok(has(run(m=>{m.rels.find(r=>r.kind==='S'||false);m.rels.push({schema:'public',name:'s_new',kind:'S',owner:'postgres',rls:false,forceRls:false,options:'',aclRaw:'',privs:{anon:['USAGE'],authenticated:[],service_role:[],authenticator:[],postgres:[]}});}),/sequence public\.s_new: anon holds USAGE/));
 assert.ok(has(run(m=>{m.defaults.push({owner:'postgres',schema:'public',type:'tables',acl:'anon=Dxtm/postgres'});}),/default ACL .* grants to anon/));
 // A removed function leaves the allow-list stale: the allow-list must be reviewed together with the schema.
 assert.ok(has(run(m=>{m.fns=m.fns.filter(f=>f.name!=='submission_link_info');}),/stale allow-list/));
});

test('policy: the allow-lists name exactly the four submission/link-info functions and nothing else', () => {
 const allow=loadAllow();
 assert.deepEqual(allow.serviceRoleExecute.map(k=>k.split('(')[0]).sort(),['public.amendment_link_info','public.submission_link_info','public.submit_amendment','public.submit_resolution']);
 assert.deepEqual(allow.authenticatedTablePrivileges,['SELECT']);
 assert.deepEqual(allow.viewsWithoutRls,['public.participation_history']);
 assert.deepEqual(allow.defaultAclGrantees,[]);
 assert.deepEqual(allow.anonExecute,['public.preproduction_status()'],'only fixed non-sensitive lifecycle metadata is callable before Auth enrollment');
});

const url=process.env.TEST_POSTGRES_URL;
const real=Boolean(url)&&['127.0.0.1','localhost','[::1]'].includes(new URL(url!).hostname);
const dbTest=real?test:test.skip;

/** Roles are cluster-wide and other test files create them in parallel: tolerate losing the race. */
const ensureRoles=`do $$declare r text;begin
 foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin'] loop
  begin
   if r='service_role' then create role service_role nologin noinherit bypassrls;
   elsif r='authenticator' then create role authenticator login noinherit nocreatedb nocreaterole nosuperuser;
   elsif r='supabase_admin' then create role supabase_admin login superuser;
   else execute format('create role %I nologin noinherit',r); end if;
  exception when duplicate_object or unique_violation then null; end;
 end loop;
end$$;`;

// Per-database facts only. Roles are cluster-wide: other test files create and drop roles in the same cluster while this one runs,
// so roleAttrs/customRoles are compared by `npm run check:grants` (own CI step, quiet cluster) but not here.
const fields=(m:Mode)=>JSON.stringify({fns:stable(m).fns,rels:m.rels,colAcl:m.colAcl,policies:m.policies,defaults:m.defaults,schemas:m.schemas,version:m.version});
let base='';
const created:string[]=[];

function inClone(sql:string):{violations:string[];drifted:boolean}{
 const db=`munos_hd4_${randomUUID().replaceAll('-','')}`;
 psql('postgres',`create database ${db} template ${base};`);
 created.push(db);
 try{
  psql(db,sql);
  const mode=collect(db) as Mode;
  return {violations:evaluatePolicy(mode as unknown as PolicyModel),drifted:fields(mode)!==fields(committed)};
 }finally{psql('postgres',`drop database if exists ${db};`);created.splice(created.indexOf(db),1);}
}

dbTest('current tree: the replayed migrations pass the policy and equal the committed inventory byte for byte', () => {
 psql('postgres',ensureRoles);
 base=build('supabase-model');
 const mode=collect(base) as Mode;
 assert.deepEqual(evaluatePolicy(mode as unknown as PolicyModel),[]);
 assert.equal(fields(mode),fields(committed),'docs/generated/isolation-t1-inventory.json is stale: run npm run grants:regenerate');
});

const SAFE_FN=`create function public.hd4_probe() returns int language sql as $$select 1$$;`;
// The hardening migration moved the global default for functions to postgres-only, so a NEW function is not executable by PUBLIC.
// REOPEN re-adds the PostgreSQL default (as a later migration resetting default privileges would) to prove the policy catches it.
const REOPEN='alter default privileges for role postgres grant execute on functions to public;';
const LOCK_FN=`revoke execute on function public.hd4_probe() from public,anon,authenticated,service_role;`;

interface Case{name:string;sql:string;expect:RegExp|null;drifted?:boolean;cleanup?:string}
const columnParent=`hd4_column_${randomUUID().replaceAll('-','')}`;
const cases:Case[]=[
 {name:'column grant: anon SELECT',sql:'grant select(name) on public.committees to anon;',expect:/column public\.committees\.name: anon \(or PUBLIC\) holds SELECT/},
 {name:'column grant: PUBLIC SELECT',sql:'grant select(name) on public.committees to public;',expect:/column public\.committees\.name: anon \(or PUBLIC\) holds SELECT/},
 {name:'column grant: authenticated INSERT',sql:'grant insert(name) on public.committees to authenticated;',expect:/column public\.committees\.name: authenticated holds INSERT/},
 {name:'column grant: service_role UPDATE',sql:'grant update(name) on public.committees to service_role;',expect:/column public\.committees\.name: service_role holds UPDATE/},
 {name:'column grant: inherited UPDATE',sql:`create role ${columnParent}; grant update(name) on public.committees to ${columnParent}; grant ${columnParent} to service_role with inherit true;`,cleanup:`revoke ${columnParent} from service_role; drop role ${columnParent};`,expect:/column public\.committees\.name: service_role holds UPDATE/},
 {name:'extra table grant: anon SELECT',sql:'grant select on public.committees to anon;',expect:/anon \(or PUBLIC\) holds SELECT/},
 {name:'extra table grant: PUBLIC SELECT',sql:'grant select on public.committees to public;',expect:/anon \(or PUBLIC\) holds SELECT/},
 {name:'extra table grant: authenticated INSERT',sql:'grant insert on public.committees to authenticated;',expect:/authenticated holds INSERT/},
 {name:'extra table grant: authenticated TRUNCATE',sql:'grant truncate on public.committees to authenticated;',expect:/authenticated holds TRUNCATE/},
 {name:'extra table grant: service_role SELECT',sql:'grant select on public.committees to service_role;',expect:/service_role holds SELECT/},
 {name:'extra table grant: service_role MAINTAIN',sql:'grant maintain on public.committees to service_role;',expect:/service_role holds MAINTAIN/},
 {name:'extra view grant: service_role on participation_history',sql:'grant select on public.participation_history to service_role;',expect:/service_role holds SELECT/},
 {name:'extra function grant: anon EXECUTE on an existing function',sql:'grant execute on function public.submission_link_info(text) to anon;',expect:/EXECUTE held by anon/},
 {name:'extra function grant: PUBLIC EXECUTE on an existing function',sql:'grant execute on function public.submission_link_info(text) to public;',expect:/EXECUTE held by PUBLIC/},
 {name:'extra function grant: service_role EXECUTE on a fifth function',sql:`grant execute on function public.conference_snapshot(uuid) to service_role;`,expect:/service_role but not in serviceRoleExecute/},
 {name:'new function with the hardened defaults: not exposed, but the inventory drifts',sql:SAFE_FN,expect:null},
 {name:'new function after default privileges are reopened (PUBLIC EXECUTE)',sql:`${REOPEN}${SAFE_FN}`,expect:/hd4_probe\(\): EXECUTE held by PUBLIC/},
 {name:'new function, locked down, then given to service_role',sql:`${SAFE_FN}${LOCK_FN}grant execute on function public.hd4_probe() to service_role;`,expect:/hd4_probe\(\): EXECUTE held by service_role but not/},
 {name:'new function, locked down: no violation but the inventory drifts',sql:`${SAFE_FN}${LOCK_FN}`,expect:null},
 {name:'new overload of an allowed function, service_role EXECUTE',sql:`create function public.submission_link_info(extra int) returns int language sql as $$select 1$$;revoke execute on function public.submission_link_info(int) from public;grant execute on function public.submission_link_info(int) to service_role;`,expect:/submission_link_info\(extra integer\): EXECUTE held by service_role but not/},
 {name:'new overload of an allowed function after default privileges are reopened',sql:`${REOPEN}create function public.submit_amendment(extra int) returns int language sql as $$select 1$$;`,expect:/submit_amendment\(extra integer\): EXECUTE held by PUBLIC/},
 {name:'SECURITY DEFINER function without a pinned search_path',sql:`create function public.hd4_probe() returns int language sql security definer as $$select 1$$;${LOCK_FN}`,expect:/SECURITY DEFINER without a pinned search_path/},
 {name:'SECURITY DEFINER function with a pinned search_path is accepted by the policy but still drifts the inventory',sql:`create function public.hd4_probe() returns int language sql security definer set search_path=pg_catalog as $$select 1$$;${LOCK_FN}`,expect:null},
 {name:'new table: no RLS',sql:'create table public.hd4_table(id int);',expect:/table public\.hd4_table: row level security is not enabled/},
 {name:'new table with RLS but extra privileges for service_role',sql:'create table public.hd4_table(id int);alter table public.hd4_table enable row level security;grant truncate,references,trigger,maintain on public.hd4_table to service_role;',expect:/hd4_table: service_role holds TRUNCATE\+REFERENCES\+TRIGGER\+MAINTAIN/},
 {name:'new table: default privileges re-added (the hosted pre-hardening model)',sql:'alter default privileges for role postgres in schema public grant truncate,references,trigger,maintain on tables to anon,authenticated,service_role;create table public.hd4_table(id int);alter table public.hd4_table enable row level security;',expect:/hd4_table: anon \(or PUBLIC\) holds TRUNCATE\+REFERENCES\+TRIGGER\+MAINTAIN/},
 {name:'default ACL re-added alone (no object created yet)',sql:'alter default privileges for role postgres in schema public grant truncate on tables to service_role;',expect:/default ACL postgres public tables: grants to service_role/},
 {name:'new view without being listed',sql:'create view public.hd4_view as select 1 as x;',expect:/view public\.hd4_view: not in viewsWithoutRls/},
 {name:'new sequence granted to anon',sql:'create sequence public.hd4_seq;grant usage on sequence public.hd4_seq to anon;',expect:/sequence public\.hd4_seq: anon holds USAGE/},
 {name:'RLS switched off on an existing table',sql:'alter table public.committees disable row level security;',expect:/committees: row level security is not enabled/},
];

for(const c of cases)dbTest(`mutation is caught: ${c.name}`,()=>{
 let r:ReturnType<typeof inClone>;
 try{r=inClone(c.sql);}finally{if(c.cleanup)psql('postgres',c.cleanup);}
 assert.ok(r.drifted,'the byte comparison with docs/generated must also fail (npm run check:grants)');
 if(c.expect)assert.ok(has(r.violations,c.expect),`expected ${c.expect}, got ${JSON.stringify(r.violations)}`);
 else assert.deepEqual(r.violations,[]);
});

dbTest('mutation is caught: DROP FUNCTION + CREATE FUNCTION silently loses the service_role grant (stale allow-list) and drifts',()=>{
 const def=psql(base,`select pg_get_functiondef('public.submission_link_info(text)'::regprocedure);`);
 assert.match(def,/create or replace function public\.submission_link_info/i);
 const r=inClone(`drop function public.submission_link_info(text);${def};`);
 assert.ok(r.drifted);
 assert.ok(has(r.violations,/submission_link_info\(link_token text\) is not a function service_role can execute/),JSON.stringify(r.violations));
});

dbTest('mutation is caught: DROP FUNCTION + CREATE FUNCTION re-exposes an allowed function when default privileges were reopened',()=>{
 const def=psql(base,`select pg_get_functiondef('public.submission_link_info(text)'::regprocedure);`);
 const r=inClone(`${REOPEN}drop function public.submission_link_info(text);${def};`);
 assert.ok(r.drifted);
 assert.ok(has(r.violations,/submission_link_info\(link_token text\): EXECUTE held by PUBLIC/),JSON.stringify(r.violations));
 assert.ok(has(r.violations,/EXECUTE held by anon/),JSON.stringify(r.violations));
});

dbTest('mutation is caught: CREATE OR REPLACE keeps the grants (documented non-event) and is not a privilege change',()=>{
 const def=psql(base,`select pg_get_functiondef('public.submission_link_info(text)'::regprocedure);`);
 const r=inClone(`${def};`);
 assert.deepEqual(r.violations,[]);
 assert.equal(r.drifted,false,'function bodies are not part of the committed JSON: a body-only change is reviewed in the migration diff');
});

dbTest('cleanup: no disposable database is left behind',()=>{
 psql('postgres',`drop database if exists ${base};`);
 assert.deepEqual(created,[]);
 assert.equal(psql('postgres',`select count(*) from pg_database where datname like 'munos_hd4_%' and datname<>'${base}';`),'0');
});
