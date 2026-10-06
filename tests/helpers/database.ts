import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {operationsFingerprint} from '../../lib/operations/fingerprint';
import type {OperationsCommand} from '../../lib/operations/commands';
import type {ConferenceData} from '../../lib/domain';
// Fresh PostgreSQL with Supabase-like roles and EVERY committed migration applied in order.
export async function freshDatabase(options: { storage?: boolean } = {}){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; grant usage on schema public to anon, authenticated, service_role;`);
 if(options.storage)await db.exec(`create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated; grant select on storage.objects to authenticated;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
 await db.exec(await readFile('supabase/seed.sql','utf8'));
 const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8')) as Record<string,string>;
 const query=async<T=Record<string,unknown>>(sql:string,p:unknown[]=[])=>(await db.query<T>(sql,p)).rows;
 /** Run as an authenticated user (RLS applies). */
 const as=async(user:string)=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);};
 const asServer=async()=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); set role service_role;`);};
 const asOwner=async()=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);};
 const grant=async(user:string,role:string,committee:string|null=null)=>{await asOwner();await db.query(`insert into auth.users values ($1) on conflict do nothing`,[user]);await db.query(`insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values($1,$2,$3,$4,now()+interval '1 day')`,[ids.conference,user,role,committee]);};
 const operationsExpected=async(command:unknown)=>operationsFingerprint((await query<{s:ConferenceData}>('select public.operations_snapshot($1) s',[ids.conference]))[0].s,command as OperationsCommand);
 return {db,ids,query,as,asServer,asOwner,grant,operationsExpected};
}
