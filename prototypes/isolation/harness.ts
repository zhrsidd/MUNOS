// PROTOTYPE, NOT SHIPPING. Disposable-database harness for the isolation feasibility checks.
// Loopback PostgreSQL 17 only. Reuses (does not modify) the repository's psql connection helper.
import {spawnSync} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {PostgresConnection,literal} from '../../tests/helpers/postgres';

// tsx runs these files as CommonJS (the package has no "type": "module"), so __dirname is available.
const here=__dirname;
export const repo=resolve(here,'../..');
export {literal};

export function psqlFile(baseUrl:string,db:string,file:string){
 const u=new URL(baseUrl);
 const r=spawnSync(process.env.PSQL_BIN??'psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-f',file],{encoding:'utf8',
  env:{...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:db}});
 if(r.status!==0)throw new Error(`psql ${file} failed: ${r.stderr}`);
 return r.stdout;
}

export interface Identity{role:'anon'|'authenticated'|'service_role'|string;sub?:string;sid?:string;iat?:number|null;extra?:Record<string,unknown>}
export interface Outcome{ok:boolean;code?:string;msg?:string;rows?:Record<string,unknown>[]}

export class ProtoDb{
 readonly ids:Record<string,string>=JSON.parse(readFileSync(join(repo,'supabase/fixture-ids.json'),'utf8'));
 private conns:PostgresConnection[]=[];
 readonly owner:PostgresConnection;
 constructor(readonly baseUrl:string,readonly name:string,private maintenance:PostgresConnection){
  this.owner=this.connect('owner');
 }
 url(){const u=new URL(this.baseUrl);u.pathname=`/${this.name}`;return u.toString();}
 connect(label:string){const c=new PostgresConnection(this.url(),`${this.name}_${label}`);this.conns.push(c);return c;}
 /** Owner (superuser) SQL; returns the last output line. A SQL error aborts the connection and fails the test loudly. */
 async sql(sql:string){const out=await this.owner.query(sql.trim().endsWith(';')?sql:`${sql};`);return out.split('\n').pop()??'';}
 async scalar(sql:string){return this.sql(sql);}
 /** One statement as a role with simulated JWT claims. `rows` wraps it as a select and returns the rows. */
 async as(id:Identity,q:string,rows=false,conn:PostgresConnection=this.owner):Promise<Outcome>{
  const claims=id.sub||id.sid||id.iat?JSON.stringify({role:id.role,sub:id.sub,session_id:id.sid,iat:id.iat===null?undefined:(id.iat??Math.floor(Date.now()/1000)),...id.extra}):'{}';
  const out=await conn.query(`select proto_h.run(${literal(id.role)},${literal(claims)},${literal(q)},${rows});`);
  return JSON.parse(out.split('\n').pop()!) as Outcome;
 }
 async close(){
  await Promise.all(this.conns.map(c=>c.close()));
  await this.maintenance.query(`drop database if exists ${this.name};`);
  await this.maintenance.close();
 }
}

/** Create a uniquely named database, bootstrap the modelled Supabase baseline, replay every migration, seed, add the prototype. */
export async function protoDatabase(baseUrl:string,options:{prototype?:boolean}={}):Promise<ProtoDb>{
 const u=new URL(baseUrl);
 if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('Isolation prototype refuses a non-loopback PostgreSQL server');
 const name=`munos_proto_${randomUUID().replaceAll('-','')}`;
 const maintenance=new PostgresConnection(baseUrl,`${name}_maintenance`);
 const version=Number(await maintenance.query('show server_version_num;'));
 if(version<170000||version>=180000)throw new Error('Prototype checks require PostgreSQL 17');
 await maintenance.query(`create database ${name};`);
 const run=(file:string)=>psqlFile(baseUrl,name,file);
 run(join(repo,'scripts/isolation-inventory/bootstrap-supabase-model.sql'));
 const dir=join(repo,'supabase/migrations');
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())run(join(dir,f));
 run(join(repo,'supabase/seed.sql'));
 if(options.prototype!==false){
  run(join(here,'sql/05_harness.sql'));
  run(join(here,'sql/10_lifecycle.sql'));
  run(join(here,'sql/20_wrappers.sql'));
 }
 return new ProtoDb(baseUrl,name,maintenance);
}
export const applyRevocation=(db:ProtoDb)=>psqlFile(db.baseUrl,db.name,join(here,'sql/30_revoke_direct.sql'));

// ---- reference proof minter: what the Production gateway route would do ------------------------------------------------
export interface Key{kid:string;secret:Buffer}
export const newKey=(prefix:string):Key=>({kid:`${prefix}-${randomBytes(4).toString('hex')}`,secret:randomBytes(32)});
const enc=(a:string|null)=>a===null?'N':`S${Buffer.byteLength(a,'utf8')}:${a}`;
/** Must stay byte-identical to lifecycle.args_digest in sql/10_lifecycle.sql. */
export function argsDigest(fn:string,args:(string|null)[]){
 const s=`F${Buffer.byteLength(fn,'utf8')}:${fn}|A${args.length}${args.map(a=>`|${enc(a)}`).join('')}`;
 return createHash('sha256').update(s,'utf8').digest('hex');
}
export interface ProofInput{key:Key;typ:'user'|'server';aud:string;epoch:number;sub?:string;sid?:string;jti?:string;fn:string;args:(string|null)[];iat?:number;exp?:number;
 override?:Partial<Record<'v'|'typ'|'kid'|'aud'|'epoch'|'sub'|'sid'|'jti'|'fn'|'ad'|'iat'|'exp',string>>}
export function mint(i:ProofInput){
 const iat=i.iat??Math.floor(Date.now()/1000),exp=i.exp??iat+60;
 const f={v:'1',typ:i.typ,kid:i.key.kid,aud:i.aud,epoch:String(i.epoch),sub:i.sub??'',sid:i.sid??'',jti:i.jti??'',fn:i.fn,ad:argsDigest(i.fn,i.args),iat:String(iat),exp:String(exp),...i.override};
 const canon=[f.v,f.typ,f.kid,f.aud,f.epoch,f.sub,f.sid,f.jti,f.fn,f.ad,f.iat,f.exp].join('\n');
 const mac=createHmac('sha256',i.key.secret).update(canon,'utf8').digest('hex');
 return {v:f.v,typ:f.typ,kid:f.kid,aud:f.aud,epoch:Number(f.epoch),...(f.sub?{sub:f.sub}:{}),...(f.sid?{sid:f.sid}:{}),...(f.jti?{jti:f.jti}:{}),fn:f.fn,ad:f.ad,iat:Number(f.iat),exp:Number(f.exp),mac};
}
export const hexBytea=(k:Key)=>`'\\x${k.secret.toString('hex')}'::bytea`;
