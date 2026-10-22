// T1 privilege inventory generator (docs/ISOLATION_DESIGN.md section 11, test T1).
//
// DISPOSABLE LOCAL USE ONLY. Creates a uniquely named database on a LOOPBACK PostgreSQL 17 server, replays every committed
// migration from empty on top of a modelled Supabase role/default-privilege baseline, reads pg_proc / pg_class /
// pg_policy / pg_default_acl, and writes a deterministic Markdown + JSON inventory to docs/generated/.
//
//   TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54417/postgres npx tsx scripts/isolation-inventory/inventory.mts [--check]
//
// It never contacts a hosted Supabase project and refuses any non-loopback host. `--check` regenerates in memory and exits
// non-zero when docs/generated differs (use in review). It does not modify supabase/migrations.
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluatePolicy} from './policy.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../..');
function connection():URL{
 const base=process.env.TEST_POSTGRES_URL;
 if(!base)throw new Error('Set TEST_POSTGRES_URL to a loopback PostgreSQL 17 URL');
 const url=new URL(base);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Refusing a non-loopback PostgreSQL server');
 return url;
}

export function psql(db:string,sql:string,file?:string):string{
 const url=connection();
 const args=['-X','-q','-At','-v','ON_ERROR_STOP=1',...(file?['-f',file]:[])];
 const r=spawnSync(process.env.PSQL_BIN??'psql',args,{input:file?undefined:sql,encoding:'utf8',maxBuffer:256*1024*1024,
  env:{...process.env,PGHOST:url.hostname.replace(/^\[|\]$/g,''),PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:db}});
 if(r.status!==0)throw new Error(`psql failed (${file??'inline'}): ${r.stderr}`);
 return r.stdout.trim();
}
const json=<T,>(db:string,sql:string):T=>JSON.parse(psql(db,sql)) as T;

const ROLES=['anon','authenticated','service_role','authenticator','postgres'] as const;
const DATA_API=['anon','authenticated','service_role'] as const;
const FILTER_SCHEMAS=`('public','private')`;

interface Fn{schema:string;name:string;args:string;result:string;kind:string;security:string;owner:string;volatility:string;config:string;lang:string;trigger:boolean;src:string;aclDefault:boolean;aclRaw:string;
 usage:Record<string,boolean>;exec:Record<string,boolean>;publicExec:boolean}
interface Rel{schema:string;name:string;kind:string;owner:string;rls:boolean;forceRls:boolean;options:string;aclRaw:string;privs:Record<string,string[]>}
interface Policy{table:string;name:string;cmd:string;roles:string;permissive:boolean;using:string;check:string}
export interface Mode{fns:Fn[];rels:Rel[];colAcl:{table:string;column:string;acl:string}[];policies:Policy[];defaults:{owner:string;schema:string;type:string;acl:string}[];
 schemas:{name:string;owner:string;acl:string;usage:Record<string,boolean>;create:Record<string,boolean>}[];roleAttrs:{name:string;super:boolean;login:boolean;inherit:boolean;bypassrls:boolean;memberOf:string}[];
 customRoles:string[];version:string;probe:Probe}
interface Probe{lines:string[]}

const roleList=ROLES.map(r=>`'${r}'`).join(',');
const roleObj=(expr:(r:string)=>string)=>`json_build_object(${ROLES.map(r=>`'${r}',${expr(r)}`).join(',')})`;

export function collect(db:string):Omit<Mode,'probe'>{
 const fns=json<Fn[]>(db,`select coalesce(json_agg(x order by x."schema",x."name",x."args"),'[]') from (
  select n.nspname "schema",p.proname "name",pg_get_function_identity_arguments(p.oid) "args",pg_get_function_result(p.oid) "result",p.prokind "kind",
   case when p.prosecdef then 'definer' else 'invoker' end "security",pg_get_userbyid(p.proowner) "owner",
   case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end "volatility",
   coalesce(array_to_string(p.proconfig,', '),'') "config",l.lanname "lang",(p.prorettype='pg_catalog.trigger'::regtype) "trigger",p.prosrc "src",
   (p.proacl is null) "aclDefault",coalesce(array_to_string(p.proacl,','),'') "aclRaw",
   ${roleObj(r=>`has_schema_privilege('${r}',n.oid,'USAGE')`)} "usage",
   ${roleObj(r=>`has_function_privilege('${r}',p.oid,'EXECUTE')`)} "exec",
   exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') "publicExec"
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname in ${FILTER_SCHEMAS} and p.prokind in ('f','p')
   and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) x;`);
 const privSql=(kind:'t'|'s')=>kind==='t'
  ?`array(select pr from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr where has_table_privilege(%R%,c.oid,pr))`
  :`array(select pr from unnest(array['USAGE','SELECT','UPDATE']) pr where has_sequence_privilege(%R%,c.oid,pr))`;
 const rels=json<Rel[]>(db,`select coalesce(json_agg(x order by x."schema",x."name"),'[]') from (
  select n.nspname "schema",c.relname "name",c.relkind "kind",pg_get_userbyid(c.relowner) "owner",c.relrowsecurity "rls",c.relforcerowsecurity "forceRls",
   coalesce(array_to_string(c.reloptions,','),'') "options",coalesce(array_to_string(c.relacl,','),'') "aclRaw",
   json_build_object(${ROLES.map(r=>`'${r}',case when c.relkind='S' then ${privSql('s').replaceAll('%R%',`'${r}'`)} else ${privSql('t').replaceAll('%R%',`'${r}'`)} end`).join(',')}) "privs"
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ${FILTER_SCHEMAS} and c.relkind in ('r','p','v','m','S','f')
   and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype in ('e','i') )) x;`);
 const colAcl=json<Mode['colAcl']>(db,`select coalesce(json_agg(x order by x."table",x."column"),'[]') from (
  select n.nspname||'.'||c.relname "table",a.attname "column",array_to_string(a.attacl,',') "acl"
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where a.attacl is not null and not a.attisdropped and n.nspname in ${FILTER_SCHEMAS}) x;`);
 const policies=json<Policy[]>(db,`select coalesce(json_agg(x order by x."table",x."name"),'[]') from (
  select n.nspname||'.'||c.relname "table",p.polname "name",case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end "cmd",
   case when p.polroles='{0}' then 'PUBLIC' else (select string_agg(pg_get_userbyid(r),',' order by pg_get_userbyid(r)) from unnest(p.polroles) r) end "roles",
   p.polpermissive "permissive",coalesce(pg_get_expr(p.polqual,p.polrelid),'') "using",coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') "check"
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private','storage')) x;`);
 const defaults=json<Mode['defaults']>(db,`select coalesce(json_agg(x order by x."owner",x."schema",x."type"),'[]') from (
  select pg_get_userbyid(d.defaclrole) "owner",coalesce(n.nspname,'(global)') "schema",
   case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' else 'schemas' end "type",
   array_to_string(d.defaclacl,',') "acl"
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace) x;`);
 const schemas=json<Mode['schemas']>(db,`select coalesce(json_agg(x order by x."name"),'[]') from (
  select n.nspname "name",pg_get_userbyid(n.nspowner) "owner",coalesce(array_to_string(n.nspacl,','),'') "acl",
   ${roleObj(r=>`has_schema_privilege('${r}',n.oid,'USAGE')`)} "usage",${roleObj(r=>`has_schema_privilege('${r}',n.oid,'CREATE')`)} "create"
  from pg_namespace n where n.nspname in ('public','private','auth','storage','extensions')) x;`);
 const roleAttrs=json<Mode['roleAttrs']>(db,`select coalesce(json_agg(x order by x."name"),'[]') from (
  select r.rolname "name",r.rolsuper "super",r.rolcanlogin "login",r.rolinherit "inherit",r.rolbypassrls "bypassrls",
   coalesce((select string_agg(g.rolname,',' order by g.rolname) from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid),'') "memberOf"
  from pg_roles r where r.rolname in (${roleList},'supabase_admin')) x;`);
 const customRoles=json<string[]>(db,`select coalesce(json_agg(rolname order by rolname),'[]') from pg_roles where rolname !~ '^pg_' and rolname not in (${roleList},'supabase_admin');`);
 const version=`PostgreSQL ${Math.floor(Number(psql(db,'show server_version_num;'))/10000)}`;
 return {fns,rels,colAcl,policies,defaults,schemas,roleAttrs,customRoles,version};
}

/** A13: does a later migration that creates, replaces, or drops and recreates a function re-expose it? Runs in the disposable db. */
function a13Probe(db:string,bare:boolean):Probe{
 const lines:string[]=[];
 const who=(label:string)=>{
  const r=json<Record<string,boolean>>(db,`select json_build_object('PUBLIC',exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.a13_probe()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
   ${DATA_API.map(x=>`'${x}',has_function_privilege('${x}','public.a13_probe()','EXECUTE')`).join(',')});`);
  lines.push(`${label}: ${Object.entries(r).map(([k,v])=>`${k}=${v?'yes':'no'}`).join(' ')}`);
 };
 psql(db,`create function public.a13_probe() returns int language sql as $$select 1$$;`);
 who('1. new function created by the migration owner, nothing revoked (the chain includes migration 20261022090000_privilege_hardening, which revokes the default EXECUTE grants)');
 psql(db,`revoke execute on function public.a13_probe() from public,anon,authenticated,service_role;`);
 who('2. after explicit REVOKE EXECUTE from PUBLIC, anon, authenticated, service_role');
 psql(db,`create or replace function public.a13_probe() returns int language sql as $$select 2$$;`);
 who('3. after CREATE OR REPLACE (a later migration that redefines the body)');
 psql(db,`drop function public.a13_probe(); create function public.a13_probe() returns int language sql as $$select 3$$;`);
 who('4. after DROP FUNCTION + CREATE FUNCTION (a later migration that recreates it)');
 psql(db,`create function public.a13_probe(extra int) returns int language sql as $$select 4$$;`);
 const overload=json<Record<string,boolean>>(db,`select json_build_object(${DATA_API.map(x=>`'${x}',has_function_privilege('${x}','public.a13_probe(int)','EXECUTE')`).join(',')});`);
 lines.push(`5. new overload a13_probe(int) next to the revoked one: ${Object.entries(overload).map(([k,v])=>`${k}=${v?'yes':'no'}`).join(' ')}`);
 if(!bare){
  psql(db,`alter default privileges for role postgres in schema public revoke execute on functions from anon,authenticated,service_role;
   alter default privileges for role postgres revoke execute on functions from public;
   drop function public.a13_probe(); drop function public.a13_probe(int);
   create function public.a13_probe() returns int language sql as $$select 5$$;`);
  who('6. after ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS (schema public and global PUBLIC), then DROP + CREATE');
 }
 psql(db,`drop function if exists public.a13_probe(); drop function if exists public.a13_probe(int);`);
 return {lines};
}

/** Creates a disposable database, applies the baseline bootstrap and every migration, returns its name. The caller drops it. */
export function build(label:'supabase-model'|'bare'):string{
 const db=`munos_inv_${randomUUID().replaceAll('-','')}`;
 psql('postgres',`create database ${db};`);
 try{
  psql(db,'',join(here,label==='bare'?'bootstrap-bare.sql':'bootstrap-supabase-model.sql'));
  const dir=join(root,'supabase/migrations');
  for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())psql(db,'',join(dir,f));
  return db;
 }catch(e){psql('postgres',`drop database if exists ${db};`);throw e;}
}

function run(label:'supabase-model'|'bare'){
 const db=build(label);
 try{
  const mode=collect(db);
  const probe=a13Probe(db,label==='bare');
  return {...mode,probe} as Mode;
 }finally{psql('postgres',`drop database if exists ${db};`);}
}

// --- write analysis (heuristic, textual) -------------------------------------------------------------------
const stripSql=(s:string)=>s.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ');
const DML=/\b(insert\s+into|update\s+[\w."]+\s+(?:as\s+\w+\s+)?set|delete\s+from|truncate\b|merge\s+into|nextval\s*\()/i;
const key=(f:Fn)=>`${f.schema}.${f.name}(${f.args})`;
function analyse(fns:Fn[]){
 const bodies=new Map<string,string>(fns.map(f=>[key(f),stripSql(f.src)]));
 const direct=new Set<string>();
 for(const f of fns)if(f.lang==='sql'||f.lang==='plpgsql')if(DML.test(bodies.get(key(f))!))direct.add(key(f));
 const callees=new Map<string,string[]>();
 for(const f of fns){
  const body=bodies.get(key(f))!;
  callees.set(key(f),fns.filter(g=>g!==f&&!g.trigger&&new RegExp(`(?:\\b${g.schema}\\.)?\\b${g.name}\\s*\\(`,'i').test(body)&&(g.schema===f.schema?true:new RegExp(`\\b${g.schema}\\.${g.name}\\s*\\(`,'i').test(body))).map(key));
 }
 const via=new Set<string>(direct);
 for(let changed=true;changed;){changed=false;for(const [k,cs] of callees)if(!via.has(k)&&cs.some(c=>via.has(c))){via.add(k);changed=true;}}
 return {direct,via,callees};
}

// --- rendering -----------------------------------------------------------------------------------------------
const esc=(s:string)=>s.replaceAll('|','\\|').replaceAll('\n',' ');
const short=(s:string,n=140)=>{const t=s.replace(/\s+/g,' ').trim();return t.length>n?`${t.slice(0,n-3)}...`:t;};
function callers(f:Fn){
 const out:string[]=[];
 if(f.publicExec)out.push('PUBLIC');
 for(const r of ROLES){if(f.exec[r]&&!(f.publicExec&&r!=='postgres'&&r!=='authenticator'))out.push(r);}
 return out;
}
/** Roles that can call a function through the Data API: EXECUTE and USAGE on the schema (public is the exposed schema). */
const direct=(f:Fn)=>DATA_API.filter(r=>f.exec[r]&&f.usage[r]);

function render(label:string,m:Mode,hash:string,files:string[],other?:Mode){
 const out:string[]=[];
 const {direct:dw,via:vw}=analyse(m.fns);
 const callable=m.fns.filter(f=>!f.trigger);
 const writer=(f:Fn)=>dw.has(key(f))?'writes':vw.has(key(f))?'writes (via callee)':'reads/none';
 out.push(`# T1 privilege inventory (GENERATED, do not edit)`,'',
  `Generator: \`scripts/isolation-inventory/inventory.mts\`. Baseline: **${label}**. ${m.version}, disposable local database replayed from empty.`,
  `Migrations replayed: ${files.length} files, combined SHA-256 \`${hash.slice(0,16)}\`. Output is deterministic (no timestamps); a diff means the schema, grants or generator changed.`,'',
  label==='supabase-model'
   ?'**This is a model.** Roles and schemas are reconstructed from documented Supabase behaviour; the default privileges are calibrated to the read-only hosted audit of 2026-10-22 (`docs/HOSTED_PRIVILEGE_AUDIT_2026-10-22.md`) as they stood BEFORE migration 20261022090000_privilege_hardening, which this replay then applies (`scripts/isolation-inventory/bootstrap-supabase-model.sql`). The audit did not cover exposed schemas, Storage/auth objects or supabase_admin objects; re-run the same queries on the hosted project before relying on any row beyond it.'
   :'**Bare baseline.** The three-role bootstrap the existing PostgreSQL tests use: no default privileges. Shown only to quantify how much exposure comes from the hosted default-privilege model.','',
  'Scope: functions and relations in schemas `public` and `private` (the only schemas the migrations create or own), policies on those schemas plus `storage.objects`. Extension and Supabase-internal objects are excluded.','');
 out.push('## Roles and schemas','','| Role | superuser | login | inherit | bypassrls | member of |','| --- | --- | --- | --- | --- | --- |');
 for(const r of m.roleAttrs)out.push(`| ${r.name} | ${r.super} | ${r.login} | ${r.inherit} | ${r.bypassrls} | ${r.memberOf||'-'} |`);
 out.push('',`Custom roles created by the migrations or the bootstrap beyond the list above: ${m.customRoles.length?m.customRoles.join(', '):'none'}.`,'');
 out.push('| Schema | owner | USAGE: '+ROLES.join(' / ')+' | CREATE: '+ROLES.join(' / ')+' |','| --- | --- | --- | --- |');
 for(const s of m.schemas)out.push(`| ${s.name} | ${s.owner} | ${ROLES.map(r=>s.usage[r]?'Y':'-').join(' ')} | ${ROLES.map(r=>s.create[r]?'Y':'-').join(' ')} |`);
 out.push('','`authenticator` is `NOINHERIT` and holds `anon`, `authenticated`, `service_role`: PostgREST connects as it and switches role per request, so only the three Data API roles matter for HTTP callers.','');
 out.push('## Default privileges (pg_default_acl)','');
 if(!m.defaults.length)out.push('None. New objects get only the PostgreSQL defaults (owner full, functions executable by PUBLIC).','');
 else{out.push('| Created by | Schema | Object type | ACL granted to new objects |','| --- | --- | --- | --- |');for(const d of m.defaults)out.push(`| ${d.owner} | ${d.schema} | ${d.type} | \`${d.acl}\` |`);out.push('');}
 out.push('PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function unless a default privilege revokes it. `PUBLIC` is therefore listed separately below.','');

 out.push('## Assumption A13 probe (re-grant risk for new, replaced and recreated functions)','','Executed in the disposable database after the inventory was read:','');
 for(const l of m.probe.lines)out.push(`- ${l}`);
 out.push('');

 // Functions
 const exposed=callable.filter(f=>direct(f).length>0||f.publicExec&&m.schemas.some(s=>s.name===f.schema&&(s.usage.anon||s.usage.authenticated||s.usage.service_role)));
 out.push('## Functions','',`${m.fns.length} functions (${callable.length} callable, ${m.fns.length-callable.length} trigger functions). Writes column is a **textual heuristic** over the function body and its named callees (insert/update/delete/truncate/merge/nextval); it can miss dynamic SQL and can over-report.`,'');
 out.push('| Function | Kind | Security | Owner | Volatility | Config (search_path) | EXECUTE held by | Data API callers (EXECUTE + schema USAGE) | Writes |','| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
 for(const f of m.fns){
  out.push(`| \`${esc(f.schema)}.${esc(f.name)}(${esc(short(f.args,90))})\`${f.trigger?' (trigger)':''} | ${f.kind==='p'?'procedure':'function'} | ${f.security} | ${f.owner} | ${f.volatility} | ${esc(f.config)||'-'} | ${callers(f).join(', ')||'-'} | ${f.trigger?'n/a':direct(f).join(', ')||'-'} | ${writer(f)} |`);
 }
 out.push('');

 // Flags
 out.push('## Flags','');
 const w=callable.filter(f=>vw.has(key(f))&&direct(f).length);
 out.push(`### Functions that write and can be called directly through the Data API (${w.length})`,'','Direct = `EXECUTE` and schema `USAGE` for at least one of anon / authenticated / service_role. Each of these is a direct-write surface that a gateway must close (ISOLATION_DESIGN 6.3).','');
 out.push('| Function | Callable by | Security | Write type |','| --- | --- | --- | --- |');
 for(const f of w)out.push(`| \`${f.schema}.${f.name}(${esc(short(f.args,90))})\` | ${direct(f).join(', ')} | ${f.security} | ${dw.has(key(f))?'direct DML':'via callee'} |`);
 out.push('');
 const publicW=callable.filter(f=>vw.has(key(f))&&f.publicExec);
 out.push(`### Writing functions with EXECUTE held by PUBLIC (${publicW.length})`,'','PUBLIC covers every role including any future one (and `anon`, subject to schema `USAGE`).','');
 for(const f of publicW)out.push(`- \`${f.schema}.${f.name}(${esc(short(f.args,90))})\``);
 if(!publicW.length)out.push('- none');
 out.push('');
 const unsafe=callable.filter(f=>f.security==='definer'&&!/search_path/.test(f.config));
 out.push(`### SECURITY DEFINER functions without a fixed search_path (${unsafe.length})`,'');
 for(const f of unsafe)out.push(`- \`${f.schema}.${f.name}(${esc(short(f.args,90))})\``);
 if(!unsafe.length)out.push('- none');
 out.push('');
 const privateExec=callable.filter(f=>f.schema==='private'&&DATA_API.some(r=>f.exec[r]&&f.usage[r]));
 out.push(`### \`private\` functions callable by a Data API role (${privateExec.length})`,'','`private` is not an exposed PostgREST schema (hosted exposure is assumption A3), so these are reachable only from SQL, policies and other functions, but the role privileges below are what a SQL-level caller would have.','');
 for(const f of privateExec)out.push(`- \`${f.schema}.${f.name}(${esc(short(f.args,90))})\`: ${direct(f).join(', ')} (${writer(f)})`);
 if(!privateExec.length)out.push('- none');
 out.push('');
 void exposed;

 // Relations
 const privCol=(r:Rel,role:string)=>r.privs[role].map(p=>p==='SELECT'?'r':p==='INSERT'?'a':p==='UPDATE'?'w':p==='DELETE'?'d':p==='TRUNCATE'?'D':p==='REFERENCES'?'x':p==='TRIGGER'?'t':p==='MAINTAIN'?'m':p==='USAGE'?'U':p).join('')||'-';
 out.push('## Tables, views and sequences','','Privilege letters: r=SELECT a=INSERT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER m=MAINTAIN; sequences: U=USAGE r=SELECT w=UPDATE. Effective privileges (including PUBLIC and role membership) from `has_table_privilege` / `has_sequence_privilege`.','');
 const kindName:Record<string,string>={r:'table',p:'partitioned table',v:'view',m:'materialized view',S:'sequence',f:'foreign table'};
 out.push('| Relation | Kind | Owner | RLS | Forced | Options | '+ROLES.join(' | ')+' |','| --- | --- | --- | --- | --- | --- | '+ROLES.map(()=>'---').join(' | ')+' |');
 for(const r of m.rels)out.push(`| \`${r.schema}.${r.name}\` | ${kindName[r.kind]} | ${r.owner} | ${['S','v','m'].includes(r.kind)?'n/a':r.rls?'yes':'NO'} | ${['S','v','m'].includes(r.kind)?'n/a':r.forceRls?'yes':'no'} | ${r.options||'-'} | ${ROLES.map(role=>privCol(r,role)).join(' | ')} |`);
 out.push('');
 const rlsOff=m.rels.filter(r=>['r','p'].includes(r.kind)&&!r.rls);
 const dataWrite=m.rels.filter(r=>['r','p'].includes(r.kind)&&DATA_API.some(role=>r.privs[role].some(p=>['INSERT','UPDATE','DELETE','TRUNCATE'].includes(p))));
 out.push(`### Tables with RLS disabled (${rlsOff.length})`,'');
 for(const r of rlsOff)out.push(`- \`${r.schema}.${r.name}\`: ${DATA_API.map(role=>`${role}=${privCol(r,role)}`).join(' ')}`);
 if(!rlsOff.length)out.push('- none');
 out.push('',`### Tables where a Data API role holds a mutating table privilege (${dataWrite.length})`,'','With RLS enabled these still need a permissive policy; with RLS disabled they are directly writable.','');
 for(const r of dataWrite)out.push(`- \`${r.schema}.${r.name}\` (RLS ${r.rls?'on':'OFF'}): ${DATA_API.filter(role=>r.privs[role].some(p=>['INSERT','UPDATE','DELETE','TRUNCATE'].includes(p))).map(role=>`${role}=${privCol(r,role)}`).join(' ')}`);
 if(!dataWrite.length)out.push('- none');
 out.push('');
 if(m.colAcl.length){out.push('### Column-level privileges','');for(const c of m.colAcl)out.push(`- \`${c.table}.${c.column}\`: \`${c.acl}\``);out.push('');}
 else out.push('Column-level privileges: none.','');

 out.push('## RLS policies','',`${m.policies.length} policies.`,'','| Table | Policy | Command | Roles | Permissive | USING | WITH CHECK |','| --- | --- | --- | --- | --- | --- | --- |');
 for(const p of m.policies)out.push(`| \`${p.table}\` | ${esc(p.name)} | ${p.cmd} | ${p.roles} | ${p.permissive?'yes':'no'} | ${esc(short(p.using,160))||'-'} | ${esc(short(p.check,160))||'-'} |`);
 out.push('');

 if(other){
  const diff:string[]=[];
  const o=new Map(other.fns.map(f=>[key(f),f]));
  for(const f of m.fns){const g=o.get(key(f));if(!g)continue;const a=direct(f).join(','),b=direct(g).join(',');if(a!==b)diff.push(`| \`${f.schema}.${f.name}(${esc(short(f.args,70))})\` | ${a||'-'} | ${b||'-'} |`);}
  out.push('## Effect of the hosted default-privilege model','',`Functions whose Data API callers differ between this baseline and the bare test bootstrap: **${diff.length}** of ${m.fns.length}.`,'');
  if(diff.length){out.push('| Function | '+label+' | bare |','| --- | --- | --- |',...diff,'');}
 }
 return out.join('\n')+'\n';
}

/** The model as committed in docs/generated/isolation-t1-inventory.json (function bodies dropped). */
export const stable=(m:Mode)=>({...m,fns:m.fns.map(({src,...rest})=>{void src;return rest;})});

function main(){
const files=readdirSync(join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
const hash=createHash('sha256').update(files.map(f=>readFileSync(join(root,'supabase/migrations',f))).join('\n--\n')).digest('hex');
const model=run('supabase-model');
const bare=run('bare');
const md=render('supabase-model',model,hash,files,bare);
const bareMd=render('bare',bare,hash,files);
const jsonOut=JSON.stringify({generator:'scripts/isolation-inventory/inventory.mts',migrations:files,migrationsSha256:hash,'supabase-model':stable(model),bare:stable(bare)},null,1)+'\n';

const outDir=join(root,'docs/generated');
const targets:[string,string][]=[['isolation-t1-inventory.md',md],['isolation-t1-inventory-bare.md',bareMd],['isolation-t1-inventory.json',jsonOut]];
// Policy (policy.mts) runs on the hosted-calibrated model in every mode: regenerating the files never makes a breach acceptable.
const violations=evaluatePolicy(model);
let bad=false;
if(process.argv.includes('--check')){
 for(const [name,body] of targets){const p=join(outDir,name);if(!existsSync(p)||readFileSync(p,'utf8')!==body){console.error(`STALE: docs/generated/${name} differs from the migrations in this tree. Run: npm run grants:regenerate (then review the diff).`);bad=true;}}
 if(!bad)console.log('docs/generated is up to date');
}else{
 mkdirSync(outDir,{recursive:true});
 for(const [name,body] of targets)writeFileSync(join(outDir,name),body);
 console.log(`wrote ${targets.map(t=>t[0]).join(', ')}; ${model.fns.length} functions, ${model.rels.length} relations, ${model.policies.length} policies`);
}
for(const v of violations){console.error(`POLICY: ${v}`);bad=true;}
if(!violations.length)console.log('privilege policy: no violations');
if(bad)process.exit(1);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
