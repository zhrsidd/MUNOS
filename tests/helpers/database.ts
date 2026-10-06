import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
// Fresh PostgreSQL with Supabase-like roles and EVERY committed migration applied in order.
export async function freshDatabase(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; grant usage on schema public to anon, authenticated, service_role;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
 await db.exec(await readFile('supabase/seed.sql','utf8'));
 const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8')) as Record<string,string>;
 const query=async<T=Record<string,unknown>>(sql:string,p:unknown[]=[])=>(await db.query<T>(sql,p)).rows;
 /** Run as an authenticated user (RLS applies). */
 const as=async(user:string)=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);};
 const asServer=async()=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); set role service_role;`);};
 const asOwner=async()=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);};
 const grant=async(user:string,role:string,committee:string|null=null)=>{await asOwner();await db.query(`insert into auth.users values ($1) on conflict do nothing`,[user]);await db.query(`insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values($1,$2,$3,$4,now()+interval '1 day')`,[ids.conference,user,role,committee]);};
 return {db,ids,query,as,asServer,asOwner,grant};
}
