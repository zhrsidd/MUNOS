import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresConnection} from './helpers/postgres';

// Migration 20261022090000_privilege_hardening (HD1 + narrow HD2). The baseline is the hosted-calibrated model
// (scripts/isolation-inventory/bootstrap-supabase-model.sql), which reproduces the hosted audit of 2026-10-22
// (docs/HOSTED_PRIVILEGE_AUDIT_2026-10-22.md): service_role has TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on every public table
// and no DML; default ACLs for role postgres in public are tables {anon,authenticated,service_role=Dxtm}, sequences and
// functions nothing for the API roles. The same checks run on PGlite and, when TEST_POSTGRES_URL is a loopback
// PostgreSQL 17, on a real server.
const MIGRATION='20261022090000_privilege_hardening.sql';
const REVERT='supabase/prepared-reverts/20261022090000_privilege_hardening_revert.sql';
const ROLES=['anon','authenticated','service_role'] as const;
const FOUR=['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];

interface Engine{exec(sql:string):Promise<void>;json<T>(sql:string):Promise<T>;close():Promise<void>}
interface Fn{sig:string;priv:Record<string,boolean>}
interface Rel{name:string;kind:string;privs:Record<string,string[]>}
interface Snapshot{fns:Fn[];rels:Rel[];defaults:string[]}

async function pglite():Promise<Engine>{
 const db=new PGlite();
 return {
  exec:async sql=>{await db.exec(sql);},
  json:async<T,>(sql:string)=>(await db.query<{j:T}>(sql)).rows[0].j,
  close:()=>db.close(),
 };
}
/** psql needs the statement terminated before the helper's own \\echo marker. */
const terminate=(sql:string)=>sql.trimEnd().replace(/;?$/,';');
async function postgres(url:string):Promise<Engine>{
 const base=new URL(url);
 if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Privilege tests require a loopback PostgreSQL server');
 const name=`munos_priv_${randomUUID().replaceAll('-','')}`;
 const maintenance=new PostgresConnection(base.toString(),`${name}_m`);
 const version=Number(await maintenance.query('show server_version_num;'));
 if(version<170000||version>=180000){await maintenance.close();throw new Error('PostgreSQL 17 required');}
 await maintenance.query(`create database ${name};`);
 const target=new URL(base);target.pathname=`/${name}`;
 const conn=new PostgresConnection(target.toString(),name);
 return {
  exec:async sql=>{await conn.query(terminate(sql));},
  json:async<T,>(sql:string)=>JSON.parse(await conn.query(terminate(sql))) as T,
  close:async()=>{await conn.close();await maintenance.query(`drop database if exists ${name};`);await maintenance.close();},
 };
}

/** Roles are cluster-wide; creating them from parallel test files must not race. */
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

const migrationFiles=async()=>(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
const bootstrap=()=>readFile('scripts/isolation-inventory/bootstrap-supabase-model.sql','utf8');
const applyFiles=async(db:Engine,files:string[])=>{for(const f of files)await db.exec(await readFile(`supabase/migrations/${f}`,'utf8'));};

async function snapshot(db:Engine):Promise<Snapshot>{
 const maintain=Number(await db.json<number>(`select to_json(current_setting('server_version_num')::int) j;`))>=170000;
 const tablePrivs=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER',...(maintain?['MAINTAIN']:[])];
 const list=(a:string[])=>`array[${a.map(x=>`'${x}'`).join(',')}]`;
 const roles=['anon','authenticated','service_role'];
 const snap=await db.json<Snapshot>(`select json_build_object(
  'fns',(select coalesce(json_agg(x order by x.sig),'[]'::json) from (
    select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig,
     json_build_object('PUBLIC',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),
      ${roles.map(r=>`'${r}',has_function_privilege('${r}',p.oid,'EXECUTE')`).join(',')}) priv
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) x),
  'rels',(select coalesce(json_agg(x order by x.name),'[]'::json) from (
    select c.relname "name",c.relkind::text kind,json_build_object(${roles.map(r=>`'${r}',case when c.relkind='S'
      then array(select pr from unnest(${list(['USAGE','SELECT','UPDATE'])}) pr where has_sequence_privilege('${r}',c.oid,pr))
      else array(select pr from unnest(${list(tablePrivs)}) pr where has_table_privilege('${r}',c.oid,pr)) end`).join(',')}) privs
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f','S') and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype in ('e','i'))) x),
  'defaults',(select coalesce(json_agg(x order by x),'[]'::json) from (
    select pg_get_userbyid(d.defaclrole)||'|'||coalesce(n.nspname,'(global)')||'|'||d.defaclobjtype::text||'|'||(select string_agg(e,',' order by e) from unnest(d.defaclacl::text[]) e) x
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace) y)
 ) j;`);
 snap.defaults.sort();
 return snap;
}

/** Model baseline + every migration before the hardening. */
async function before(db:Engine){
 await db.exec(ensureRoles);
 await db.exec(await bootstrap());
 await applyFiles(db,(await migrationFiles()).filter(f=>f<MIGRATION));
}
const names=(s:Snapshot,role:string,schema:string)=>s.fns.filter(f=>f.priv[role]&&f.sig.startsWith(`${schema}.`)).map(f=>f.sig.slice(schema.length+1).split('(')[0]).sort();

// Hosted audit 2026-10-22: EXECUTE held by each role (names only; no function in either schema is overloaded).
const AUDIT={
 authenticatedPublic:['access_code_status','apply_conference_mutation','apply_operations_mutation','conference_snapshot','conference_state_snapshot','executive_snapshot','executive_state_snapshot','operations_snapshot','redeem_access_code','revoke_access_code','rotate_access_code','staff_batch_snapshot'],
 authenticatedPrivate:['access_grants','apply_mutation','apply_operations_mutation','apply_procedure','apply_staff_batch','decision_history','document_submitter_countries','has_access','permitted','photo_chairs','uuid_or_null'],
 serviceRolePublic:['amendment_link_info','submission_link_info','submit_amendment','submit_resolution'],
};
function assertAudit(s:Snapshot){
 assert.deepEqual(names(s,'authenticated','public'),AUDIT.authenticatedPublic);
 assert.deepEqual(names(s,'authenticated','private'),AUDIT.authenticatedPrivate);
 assert.deepEqual(names(s,'service_role','public'),AUDIT.serviceRolePublic);
 assert.deepEqual(names(s,'service_role','private'),[]);
 for(const schema of ['public','private']){assert.deepEqual(names(s,'anon',schema),[],`anon executes nothing in ${schema}`);assert.deepEqual(names(s,'PUBLIC',schema),[],`PUBLIC executes nothing in ${schema}`);}
 const tables=s.rels.filter(r=>['r','p'].includes(r.kind));
 assert.equal(tables.length,36);
 for(const t of tables){
  assert.deepEqual(t.privs.authenticated,['SELECT'],`authenticated SELECT only on ${t.name}`);
  assert.deepEqual(t.privs.anon,[],`anon nothing on ${t.name}`);
  assert.ok(!t.privs.service_role.some(p=>['SELECT','INSERT','UPDATE','DELETE'].includes(p)),`service_role has no DML on ${t.name}`);
 }
 for(const q of s.rels.filter(r=>r.kind==='S'))for(const r of ROLES)assert.deepEqual(q.privs[r],[],`no sequence privileges for ${r} on ${q.name}`);
}

/** Run a statement as a role and report the SQLSTATE of the failure ('' when it succeeded). The block never aborts the session. */
async function sqlstate(db:Engine,role:string,statement:string){
 await db.exec(`do $x$begin
  perform set_config('priv.state','',false);
  begin execute 'set local role ${role}'; execute $s$${statement}$s$; perform set_config('priv.state','ok',false);
  exception when others then perform set_config('priv.state',sqlstate||':'||sqlerrm,false); end;
 end$x$;`);
 return db.json<string>(`select to_json(current_setting('priv.state')) j;`);
}

async function suite(make:()=>Promise<Engine>,label:string,t:test.TestContext){
 await t.test(`${label}: before = audited baseline; after differs only by the four service_role table privileges`,async()=>{
  const db=await make();
  try{
   await before(db);
   const pre=await snapshot(db);
   assertAudit(pre);
   const maintain=pre.rels.find(r=>r.name==='conferences')!.privs.service_role.includes('MAINTAIN');
   const expectedFour=maintain?FOUR:FOUR.filter(p=>p!=='MAINTAIN');
   for(const r of pre.rels.filter(x=>['r','p','v'].includes(x.kind)))assert.deepEqual(r.privs.service_role.sort(),[...expectedFour].sort(),`model has the audited four on ${r.name}`);
   assert.deepEqual(pre.defaults,[
    'postgres|public|S|postgres=rwU/postgres',
    'postgres|public|f|postgres=X/postgres',
    'postgres|public|r|anon=Dxtm/postgres,authenticated=Dxtm/postgres,postgres=arwdDxtm/postgres,service_role=Dxtm/postgres'].sort());
   // Control: the pre-hardening defaults do re-expose a recreated function and a new table, so the later asserts are not vacuous.
   await db.exec(`create function public.priv_probe() returns int language sql as $$select 1$$; create table public.priv_probe_t(id int);`);
   const control=await snapshot(db);
   assert.equal(control.fns.find(f=>f.sig==='public.priv_probe()')!.priv.PUBLIC,true,'control: new function is PUBLIC-executable before the migration');
   assert.deepEqual(control.rels.find(r=>r.name==='priv_probe_t')!.privs.anon,expectedFour,'control: new table regains the four for anon');
   await db.exec(`drop function public.priv_probe(); drop table public.priv_probe_t;`);

   // service_role control: it can truncate a table today; the submit path answers with the domain error, not 42501.
   const leaf=await db.json<string>(`select to_json(min(c.relname)) j from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
    and not exists(select 1 from pg_constraint k where k.confrelid=c.oid)`);
   assert.equal(await sqlstate(db,'service_role',`truncate public.${leaf}`),'ok','control: service_role can TRUNCATE before the migration');
   const submit=`select public.submit_resolution('invalid-token-0000000000000000000000000000',gen_random_uuid(),gen_random_uuid(),'t','d','f','k',repeat('0',64),1)`;
   const submitBefore=await sqlstate(db,'service_role',submit);
   assert.ok(!submitBefore.startsWith('42501'),`submit_resolution is callable by service_role: ${submitBefore}`);

   await applyFiles(db,[MIGRATION]);
   const post=await snapshot(db);
   assertAudit(post);

   // (1) every function EXECUTE identical, for the three roles and PUBLIC.
   assert.deepEqual(post.fns,pre.fns,'function EXECUTE matrix unchanged');
   // authenticated / anon table and sequence privileges identical; service_role loses exactly the four.
   assert.equal(post.rels.length,pre.rels.length);
   for(const [i,r] of pre.rels.entries()){
    const p=post.rels[i];assert.equal(p.name,r.name);
    assert.deepEqual(p.privs.authenticated,r.privs.authenticated,`authenticated unchanged on ${r.name}`);
    assert.deepEqual(p.privs.anon,r.privs.anon,`anon unchanged on ${r.name}`);
    // (2) service_role keeps nothing: the four were its only table privileges.
    assert.deepEqual(r.privs.service_role.filter(x=>!expectedFour.includes(x)),[],`${r.name}: the four were service_role's only privileges (sequence rows are empty)`);
    assert.deepEqual(p.privs.service_role,[],`service_role holds nothing on ${r.name} afterwards`);
   }
   assert.equal(await sqlstate(db,'service_role',`truncate public.${leaf}`).then(s=>s.slice(0,5)),'42501','service_role TRUNCATE is refused');
   assert.equal((await sqlstate(db,'service_role',`select 1 from public.${leaf}`)).slice(0,5),'42501');
   // the service_role submission path is untouched.
   assert.equal(await sqlstate(db,'service_role',submit),submitBefore,'submit_resolution behaves identically for service_role');
   assert.equal((await sqlstate(db,'authenticated',submit)).slice(0,5),'42501','authenticated still cannot submit');
   assert.equal((await sqlstate(db,'anon',`select public.access_code_status(gen_random_uuid())`)).slice(0,5),'42501','anon still calls nothing');
   assert.equal((await sqlstate(db,'authenticated',`select count(*) from public.${leaf}`)),'ok','authenticated can still SELECT');

   // Default ACLs: tables carry only postgres; functions revoked for PUBLIC globally; sequences untouched.
   assert.deepEqual(post.defaults,[
    'postgres|(global)|f|postgres=X/postgres',
    'postgres|public|S|postgres=rwU/postgres',
    'postgres|public|f|postgres=X/postgres',
    'postgres|public|r|postgres=arwdDxtm/postgres'].sort());

   // (3) later migrations: recreate, overload, replace and new tables are not exposed.
   const exposed=async(sig:string)=>{const f=(await snapshot(db)).fns.find(x=>x.sig===sig);assert.ok(f,sig);return Object.entries(f.priv).filter(([,v])=>v).map(([k])=>k);};
   await db.exec(`create function public.priv_probe() returns int language sql as $$select 1$$;`);
   assert.deepEqual(await exposed('public.priv_probe()'),[],'new function');
   await db.exec(`create or replace function public.priv_probe() returns int language sql as $$select 2$$;`);
   assert.deepEqual(await exposed('public.priv_probe()'),[],'create or replace');
   await db.exec(`drop function public.priv_probe(); create function public.priv_probe() returns int language sql as $$select 3$$;`);
   assert.deepEqual(await exposed('public.priv_probe()'),[],'drop + create');
   await db.exec(`create function public.priv_probe(extra int) returns int language sql as $$select 4$$;`);
   assert.deepEqual(await exposed('public.priv_probe(extra integer)'),[],'new overload');
   await db.exec(`create function private.priv_probe() returns int language sql as $$select 5$$;`);
   assert.deepEqual(await exposed('private.priv_probe()'),[],'new private function');
   assert.equal((await sqlstate(db,'authenticated',`select public.priv_probe()`)).slice(0,5),'42501');
   // Convention: an explicit GRANT still works and is the only way in.
   await db.exec(`grant execute on function public.priv_probe() to authenticated;`);
   assert.deepEqual(await exposed('public.priv_probe()'),['authenticated']);
   assert.equal(await sqlstate(db,'authenticated',`select public.priv_probe()`),'ok');
   await db.exec(`create table public.priv_probe_t(id int primary key); create sequence public.priv_probe_s;`);
   const created=await snapshot(db);
   for(const n of ['priv_probe_t','priv_probe_s'])for(const r of ROLES)assert.deepEqual(created.rels.find(x=>x.name===n)!.privs[r],[],`new ${n} gives ${r} nothing`);

   // Idempotent: a second run changes nothing and does not fail.
   await db.exec(await readFile(`supabase/migrations/${MIGRATION}`,'utf8'));
   const again=await snapshot(db);
   assert.deepEqual(again.defaults,created.defaults);
   assert.deepEqual(again.fns,created.fns);
  }finally{await db.close();}
 });

 await t.test(`${label}: the prepared revert returns to the audited pre-hardening state`,async()=>{
  const db=await make();
  try{
   await before(db);
   const pre=await snapshot(db);
   await applyFiles(db,[MIGRATION]);
   await db.exec(`begin; set local munos_hardening_revert.global_public_execute='granted'; ${await readFile(REVERT,'utf8')} commit;`);
   const post=await snapshot(db);
   assert.deepEqual(post.rels,pre.rels);
   assert.deepEqual(post.fns,pre.fns);
   assert.deepEqual(post.defaults,pre.defaults);
  }finally{await db.close();}
 });

 await t.test(`${label}: inherited and PUBLIC privileges refuse hardening atomically`,async()=>{
  for(const inherited of [false,true]){
   const db=await make();const parent=`priv_parent_${randomUUID().replaceAll('-','')}`;
   try{
    await before(db);
    if(inherited)await db.exec(`create role ${parent}; grant truncate on public.conferences to ${parent}; grant ${parent} to service_role with inherit true;`);
    else await db.exec('grant truncate on public.conferences to public;');
    const pre=await snapshot(db);
    assert.match(await sqlstate(db,'postgres',await readFile(`supabase/migrations/${MIGRATION}`,'utf8')),/privilege hardening incomplete/);
    assert.deepEqual(await snapshot(db),pre,'refusal preserves the full baseline');
   }finally{
    if(inherited)await db.exec(`revoke ${parent} from service_role; drop owned by ${parent}; drop role ${parent};`).catch(()=>undefined);
    await db.close();
   }
  }
 });

 await t.test(`${label}: unexpected global function/table/sequence defaults refuse before mutation`,async()=>{
  for(const grant of ['execute on functions to authenticated','truncate on tables to anon','usage on sequences to service_role']){
   const db=await make();try{
    await before(db);await db.exec(`alter default privileges for role postgres grant ${grant};`);
    const pre=await snapshot(db);
    assert.match(await sqlstate(db,'postgres',await readFile(`supabase/migrations/${MIGRATION}`,'utf8')),/unsupported global API defaults/);
    assert.deepEqual(await snapshot(db),pre);
   }finally{await db.close();}
  }
 });

 await t.test(`${label}: revert requires captured selection and preserves an already-revoked global PUBLIC default`,async()=>{
  const db=await make();try{
   await before(db);await db.exec('alter default privileges for role postgres revoke execute on functions from public;');
   const pre=await snapshot(db);await applyFiles(db,[MIGRATION]);const hardened=await snapshot(db);
   const inverse=await readFile(REVERT,'utf8');
   assert.match(await sqlstate(db,'postgres',inverse),/revert refused/);
   assert.deepEqual(await snapshot(db),hardened);
   await db.exec(`begin; set local munos_hardening_revert.global_public_execute='revoked'; ${inverse} commit;`);
   assert.deepEqual(await snapshot(db),pre);
   await db.exec('create function public.revert_probe() returns int language sql as $$select 1$$;');
   assert.equal((await sqlstate(db,'anon','select public.revert_probe()')).slice(0,5),'42501');
  }finally{await db.close();}
 });
}

test('privilege hardening on PGlite',{timeout:240000},async t=>{await suite(pglite,'PGlite',t);});

test('privilege hardening on PostgreSQL 17',{skip:!process.env.TEST_POSTGRES_URL,timeout:240000},async t=>{
 await suite(()=>postgres(process.env.TEST_POSTGRES_URL!),'PostgreSQL 17',t);
});

test('privilege hardening: aborted-transaction dry run (single statement ending in RAISE EXCEPTION) leaves nothing behind',{timeout:240000},async()=>{
 const db=await pglite();
 try{
  await before(db);
  const pre=await snapshot(db);
  const text=await readFile(`supabase/migrations/${MIGRATION}`,'utf8');
  // Shape used for the hosted dry runs: migration text plus checks, in ONE execute, ending in RAISE EXCEPTION.
  const dry=`${text}\n do $dry$ declare n int; begin
   select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid=a.grantee where s.nspname='public' and r.rolname='service_role' and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');
   raise exception 'DRYRUN_OK removed_remaining=%',n;
  end $dry$;`;
  await assert.rejects(()=>db.exec(dry),/DRYRUN_OK removed_remaining=0/);
  assert.deepEqual(await snapshot(db),pre,'the aborted run changed nothing');
  // The final self-check block aborts when a removed privilege is still held (run alone against the pre-hardening state).
  await assert.rejects(()=>db.exec(text.slice(text.lastIndexOf('do $$'))),/privilege hardening incomplete: service_role (MAINTAIN|REFERENCES|TRIGGER|TRUNCATE) on public\./);
 }finally{await db.close();}
});
