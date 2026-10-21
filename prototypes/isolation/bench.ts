// PROTOTYPE, NOT SHIPPING. LOCAL-ONLY latency comparison: direct RPC versus gateway wrapper on a disposable PostgreSQL 17.
//   TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54417/postgres npx tsx prototypes/isolation/bench.ts
// Loopback TCP, one machine, no Supabase/PostgREST/Vercel/Auth in the path. These numbers measure ONLY the database-side
// cost of the proof check (digest + HMAC + key lookup + marker read) and are NOT a capacity or end-to-end estimate.
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hexBytea,literal,mint,newKey,protoDatabase,psqlFile} from './harness';

const url=process.env.TEST_POSTGRES_URL;
if(!url)throw new Error('Set TEST_POSTGRES_URL');
const seconds=Number(process.env.BENCH_SECONDS??12);

async function main(){
 const db=await protoDatabase(url!);
 const dir=mkdtempSync(join(tmpdir(),'munos-bench-'));
 try{
  psqlFile(url!,db.name,join(__dirname,'sql/90_bench.sql'));
  const AUD='bench-ref-0123456789';
  await db.sql(`select lifecycle.init('${AUD}')`);
  const key=newKey('bench');
  await db.as({role:'lifecycle_operator'},`select lifecycle.add_key('${key.kid}','test',${hexBytea(key)})`);
  const chair=randomUUID(),sid='bench-session';
  await db.sql(`insert into auth.users values('${chair}');insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values('${db.ids.conference}','${chair}','chair','${db.ids.ga1}',now()+interval '1 day')`);
  const claims=JSON.stringify({role:'authenticated',sub:chair,session_id:sid,iat:Math.floor(Date.now()/1000)});
  const cmd=JSON.stringify({type:'participation',delegateId:db.ids.france,sessionId:db.ids.session,resolutionId:db.ids.resolution,categoryId:'speech',points:1});
  const ct=new Date().toISOString();
  const common=`begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', :claims, true);\n`;
  const fresh=(call:string)=>`select quote_literal(md5(random()::text||clock_timestamp()::text)::uuid::text) as m \\gset\n${common}${call}\ncommit;\n`;
  const args=`array[:conf,:m,:cmd,'chair',null::text,:ct]`;
  const scripts:Record<string,string>={
   direct_fresh:fresh(`select public.apply_conference_mutation(:conf::uuid,:m::uuid,:cmd::jsonb,'chair',null,:ct::timestamptz);`),
   wrapper_fresh_incl_sql_mint:fresh(`select public.gw_apply_conference_mutation(conf=>:conf,mutation=>:m,command=>:cmd,requested_role=>'chair',expected=>null,client_time=>:ct,proof=>proto_bench.mint('apply_conference_mutation',${args},:sub,:sid));`),
   mint_only:fresh(`select proto_bench.mint('apply_conference_mutation',${args},:sub,:sid);`),
   direct_replay:`${common}select public.apply_conference_mutation(:conf::uuid,:m0::uuid,:cmd::jsonb,'chair',null,:ct::timestamptz);\ncommit;\n`,
   wrapper_replay_premade_proof:`${common}select public.gw_apply_conference_mutation(conf=>:conf,mutation=>:m0,command=>:cmd,requested_role=>'chair',expected=>null,client_time=>:ct,proof=>:proof::jsonb);\ncommit;\n`,
  };
  for(const [n,body] of Object.entries(scripts))writeFileSync(join(dir,`${n}.sql`),body);
  const u=new URL(url!);
  const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGDATABASE:db.name};
  const m0=randomUUID();
  // Apply the replay mutation once so the replay variants only hit the stored receipt.
  await db.as({role:'authenticated',sub:chair,sid,iat:Math.floor(Date.now()/1000)},`select public.apply_conference_mutation('${db.ids.conference}','${m0}',${literal(cmd)}::jsonb,'chair',null,'${ct}')`);
  const run=(name:string,clients:number)=>{
   const vars=['-D',`conf=${literal(db.ids.conference)}`,'-D',`claims=${literal(claims)}`,'-D',`cmd=${literal(cmd)}`,'-D',`ct=${literal(ct)}`,'-D',`sub=${literal(chair)}`,'-D',`sid=${literal(sid)}`,'-D',`m0=${literal(m0)}`];
   if(name==='wrapper_replay_premade_proof'){
    // Proof valid for 60 s: minted by the reference gateway code immediately before the run (seconds < 60).
    // exp - iat may not exceed 60 s, so mint with a normal window and keep the run shorter than it.
    const p2=mint({key,typ:'user',aud:AUD,epoch:1,sub:chair,sid,fn:'apply_conference_mutation',args:[db.ids.conference,m0,cmd,'chair',null,ct]});
    vars.push('-D',`proof=${literal(JSON.stringify(p2))}`);
   }
   const r=spawnSync('pgbench',['-n','-f',join(dir,`${name}.sql`),'-c',String(clients),'-j',String(Math.min(clients,4)),'-T',String(Math.min(seconds,45)),...vars,db.name],{env,encoding:'utf8'});
   if(r.status!==0)throw new Error(`pgbench ${name}: ${r.stderr}${r.stdout}`);
   const lat=/latency average = ([\d.]+) ms/.exec(r.stdout),tps=/tps = ([\d.]+)/.exec(r.stdout),ok=/number of transactions actually processed: (\d+)/.exec(r.stdout),failed=/number of failed transactions: (\d+)/.exec(r.stdout);
   return {name,clients,latencyMs:Number(lat?.[1]),tps:Number(tps?.[1]),transactions:Number(ok?.[1]),failed:Number(failed?.[1]??0)};
  };
  const results=[];
  for(const clients of [1,4]){
   run('direct_fresh',clients); // warm-up, discarded
   for(const n of Object.keys(scripts))results.push(run(n,clients));
  }
  // Application-side minting cost (what a Node gateway would pay per call), measured in-process.
  const iterations=20000,t0=process.hrtime.bigint();
  for(let i=0;i<iterations;i++)mint({key,typ:'user',aud:AUD,epoch:1,sub:chair,sid,fn:'apply_conference_mutation',args:[db.ids.conference,randomUUID(),cmd,'chair',null,ct]});
  const mintUs=Number(process.hrtime.bigint()-t0)/1000/iterations;
  console.log(JSON.stringify({environment:'LOCAL ONLY: PostgreSQL 17.5 on loopback, one host, no PostgREST/Auth/Vercel',seconds,results,nodeMintMicroseconds:Math.round(mintUs*10)/10},null,1));
 }finally{
  rmSync(dir,{recursive:true,force:true});
  await db.close();
 }
}
main().catch(e=>{console.error(e);process.exit(1);});
