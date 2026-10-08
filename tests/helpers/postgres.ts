import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';

/** Real, independent PostgreSQL connections. SQL is piped on stdin, never process arguments. */
export class PostgresConnection {
 private process;
 private output='';
 private errors='';
 private pending?:{marker:string;resolve:(value:string)=>void;reject:(reason:Error)=>void};
 constructor(url:string,name:string){
  const connection=new URL(url);
  this.process=spawn(process.env.PSQL_BIN??'psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGHOST:connection.hostname,PGPORT:connection.port||'5432',PGUSER:decodeURIComponent(connection.username),PGPASSWORD:decodeURIComponent(connection.password),PGDATABASE:connection.pathname.slice(1),PGAPPNAME:name,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000'},stdio:['pipe','pipe','pipe']});
  this.process.stdout.on('data',(data:Buffer)=>{this.output+=data.toString();this.receive();});
  this.process.stderr.on('data',(data:Buffer)=>{this.errors+=data.toString();});
  this.process.on('error',error=>{const pending=this.pending;this.pending=undefined;pending?.reject(error);});
  this.process.on('exit',code=>{const pending=this.pending;this.pending=undefined;pending?.reject(new Error(`Local test PostgreSQL connection exited (${code}): ${this.errors}`));});
 }
 private receive(){
  const pending=this.pending;
  if(!pending)return;
  const at=this.output.indexOf(pending.marker);
  if(at<0)return;
  const value=this.output.slice(0,at).trim();
  this.output=this.output.slice(at+pending.marker.length).replace(/^\r?\n/,'');
  this.pending=undefined;
  pending.resolve(value);
 }
 query(sql:string):Promise<string>{
  if(this.process.exitCode!==null)throw new Error(`Local test PostgreSQL exited: ${this.errors}`);
  if(this.pending)throw new Error('One query at a time per connection');
  return new Promise((resolve,reject)=>{
   const marker=`done_${randomUUID()}`;
   this.pending={marker,resolve,reject};
   this.process.stdin.write(`${sql}\n\\echo ${marker}\n`);
  });
 }
 async json<T>(sql:string):Promise<T>{return JSON.parse(await this.query(sql)) as T;}
 async close(){
  if(this.process.exitCode!==null||this.process.signalCode!==null)return;
  const ended=new Promise<void>(resolve=>this.process.once('exit',()=>resolve()));
  // A failed assertion may leave a transaction waiting; never strand psql children.
  const timeout=setTimeout(()=>this.process.kill('SIGKILL'),2000);
  this.process.stdin.end('rollback;\n\\q\n');
  try{await ended;}finally{clearTimeout(timeout);}
 }
}
export const literal=(value:string)=>`'${value.replaceAll("'","''")}'`;

/** Refuse remote hosts; create/drop only a uniquely named disposable test database. */
export async function realDatabase(baseUrl:string){
 const url=new URL(baseUrl);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Concurrency tests require a loopback PostgreSQL server; remote databases are forbidden');
 const name=`munos_test_${randomUUID().replaceAll('-','')}`;
 const maintenance=new PostgresConnection(url.toString(),`${name}_maintenance`);
 const connections:PostgresConnection[]=[];
 const target=new URL(url);target.pathname=`/${name}`;
 const connect=(suffix:string)=>{const c=new PostgresConnection(target.toString(),`${name}_${suffix}`);connections.push(c);return c;};
 const close=async()=>{
  await Promise.all(connections.map(c=>c.close()));
  await maintenance.query(`drop database if exists ${name};`);
  await maintenance.close();
 };
 try{
  const version=Number(await maintenance.query('show server_version_num;'));
  if(version<170000||version>=180000)throw new Error('Credential concurrency tests require PostgreSQL 17');
  await maintenance.query(`create database ${name};`);
  const owner=connect('owner');
  await owner.query(`do $$begin
   if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
   if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
   if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
  end$$;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  grant usage on schema public to anon,authenticated,service_role;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await owner.query(await readFile(`supabase/migrations/${file}`,'utf8'));
  await owner.query(await readFile('supabase/seed.sql','utf8'));
  const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8')) as Record<string,string>;
  return {owner,ids,connect,name,close};
 }catch(error){await close().catch(()=>undefined);throw error;}
}

export async function asUser(connection:PostgresConnection,id:string){
 await connection.query(`select set_config('request.jwt.claim.sub',${literal(id)},false); set role authenticated;`);
}
/** Wait for actual server lock contention, rather than assuming a sleep makes a race happen. */
export async function waitForLock(observer:PostgresConnection,applicationName:string){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  if(await observer.query(`select exists(select 1 from pg_stat_activity where application_name=${literal(applicationName)} and wait_event_type='Lock');`)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw new Error(`Expected independent PostgreSQL transaction ${applicationName} to block on a lock`);
}
