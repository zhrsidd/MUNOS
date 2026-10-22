import {resolve} from 'node:path';
import {freshDatabase} from './database';
import {realDatabase} from './postgres';
import {PsqlRunner,pgliteRunner,type Runner} from '../../scripts/cleanup/engine';
// One interface over the two engines the cleanup is proven on: embedded PGlite, and a real PostgreSQL 17 server (TEST_POSTGRES_URL,
// loopback only, via psql). Every test body runs unchanged on both.
export const sqlDir=resolve('scripts/cleanup');
export interface Backend{
 name:string;
 /** Run trusted setup SQL (must succeed). */
 exec(sql:string):Promise<void>;
 /** Rows of a SELECT, as objects. */
 rows<T=Record<string,unknown>>(select:string):Promise<T[]>;
 /** The cleanup runner (same engine, separate session on PostgreSQL). */
 runner:Runner;
 /** A postgres URL for the wrapper (PostgreSQL only). */
 url?:string;
 close():Promise<void>;
}
const storageSchema=`create schema if not exists storage;
 create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);`;
const wrap=(select:string)=>`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text as j from (${select}) t;`;
export async function pgliteBackend():Promise<Backend>{
 const d=await freshDatabase({storage:true});
 return {name:'PGlite',
  async exec(sql){await d.db.exec(sql);},
  async rows<T>(select:string){return JSON.parse((await d.db.query<{j:string}>(wrap(select))).rows[0].j) as T[];},
  runner:pgliteRunner(d.db),
  async close(){await d.db.close();}};
}
export async function postgresBackend(baseUrl:string):Promise<Backend>{
 const db=await realDatabase(baseUrl);
 await db.owner.query(storageSchema);
 const url=new URL(baseUrl);url.pathname=`/${db.name}`;
 return {name:'PostgreSQL 17',url:url.toString(),
  async exec(sql){await db.owner.query(`${sql.trim()};`);},
  async rows<T>(select:string){return JSON.parse(await db.owner.query(wrap(select))) as T[];},
  runner:new PsqlRunner(url.toString()),
  async close(){await db.close();}};
}
export const backends:[string,()=>Promise<Backend>,boolean][]=[
 ['PGlite',pgliteBackend,false],
 ['PostgreSQL 17',()=>postgresBackend(process.env.TEST_POSTGRES_URL!),!process.env.TEST_POSTGRES_URL],
];

export interface TableSnapshot{n:number;h:string}
const fp=(table:string,where='true')=>`select count(*)::int n, coalesce(md5(string_agg(md5(t::text),',' order by md5(t::text))),'') h from ${table} t where ${where}`;
/** Every base table in public and private, as a count and content hash of the rows belonging to one conference. Independent of the cleanup rules: scoped by the catalog's own conference_id columns. */
export async function snapshot(b:Backend,conference:string):Promise<Record<string,TableSnapshot>>{
 const tables=await b.rows<{tbl:string;has:boolean}>(`select format('%I.%I',n.nspname,c.relname) tbl, exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='conference_id' and not a.attisdropped) has from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private') order by 1`);
 const out:Record<string,TableSnapshot>={};
 for(const {tbl:t,has} of tables){
  let where:string;
  if(has)where=`t.conference_id='${conference}'`;
  else if(t==='public.conferences')where=`t.id='${conference}'`;
  else if(t==='private.access_grant_sources')where=`t.user_access_id in(select id from public.user_access where conference_id='${conference}')`;
  else if(t==='private.amendment_submissions')where=`t.link_id in(select id from public.amendment_links where conference_id='${conference}')`;
  else throw Error(`snapshot has no scope for ${t}`);
  out[t]=(await b.rows<TableSnapshot>(fp(t,where)))[0];
 }
 return out;
}
/** Rows outside the conference-scoped tables that the cleanup must never touch. */
export async function globalSnapshot(b:Backend){
 return {authUsers:(await b.rows<TableSnapshot>(fp('auth.users')))[0],storage:(await b.rows<TableSnapshot>(fp('storage.objects')))[0],buckets:(await b.rows<TableSnapshot>(fp('storage.buckets')))[0]};
}
