// PROTOTYPE, NOT SHIPPING, NOT WIRED INTO `npm test` (that glob is tests/*.test.ts).
// Checks the hard boundaries of docs/ISOLATION_DESIGN.md on a disposable local PostgreSQL 17 database:
//   TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54417/postgres npx tsx --test prototypes/isolation/isolation.proto.test.ts
// Everything here is LOCAL evidence. It cannot show hosted Auth, PostgREST, Vault, jwt_expiry or Realtime behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyRevocation,hexBytea,literal,mint,newKey,protoDatabase,type Identity,type Key,type Outcome,type ProtoDb} from './harness';

const url=process.env.TEST_POSTGRES_URL;
const AUD='proto-ref-0123456789ab';
const q=(v:string|null)=>v===null?'null':literal(v);
const notes:string[]=[];
const note=(s:string)=>{notes.push(s);console.log(`# NOTE ${s}`);};
const codeOf=(o:Outcome)=>o.ok?'ok':o.code;

interface Family{wrapper:string;fn:string;names:string[];typ:'user'|'server';sub?:string;single?:boolean;returns:boolean}
const FAM={
 mutation:{wrapper:'gw_apply_conference_mutation',fn:'apply_conference_mutation',names:['conf','mutation','command','requested_role','expected','client_time'],typ:'user',returns:false},
 operations:{wrapper:'gw_apply_operations_mutation',fn:'apply_operations_mutation',names:['conf','mutation','command','requested_role','expected','client_time'],typ:'user',returns:false},
 redeem:{wrapper:'gw_redeem_access_code',fn:'redeem_access_code',names:['conf','code'],typ:'user',returns:true},
 rotate:{wrapper:'gw_rotate_access_code',fn:'rotate_access_code',names:['conf','requested_role','committee','expires_at'],typ:'user',single:true,returns:true},
 revoke:{wrapper:'gw_revoke_access_code',fn:'revoke_access_code',names:['conf','credential','revoke_devices'],typ:'user',single:true,returns:false},
 submission:{wrapper:'gw_submit_resolution',fn:'submit_resolution',names:['link_token','submission','submitter','title','google_doc_id','file_name','storage_key','file_sha256','file_size'],typ:'server',sub:'route:submissions',returns:true},
 amendment:{wrapper:'gw_submit_amendment',fn:'submit_amendment',names:['link_token','submission','submitter','resolution','amendment_type','clause','wording'],typ:'server',sub:'route:amendments',returns:true},
} satisfies Record<string,Family>;
type FamName=keyof typeof FAM;

test('isolation feasibility prototype on PostgreSQL 17',{skip:!url,timeout:900000},async t=>{
 const db:ProtoDb=await protoDatabase(url!);
 const {ids}=db;
 const exec=randomUUID(),chair=randomUUID(),device=randomUUID(),outsider=randomUUID(),otherChair=randomUUID();
 const sid=(u:string)=>`session-${u.slice(0,8)}`;
 const user=(u:string,extra:Partial<Identity>={}):Identity=>({role:'authenticated',sub:u,sid:sid(u),...extra});
 let key:Key=newKey('test');
 const state=async()=>JSON.parse(await db.sql(`select to_json(s) from (select phase,epoch,token_floor,register_seq,real_data_attested from lifecycle.project_state) s`)) as {phase:string;epoch:number;token_floor:number;register_seq:number;real_data_attested:boolean};
 const op=(sql:string,rows=false)=>db.as({role:'lifecycle_operator'},sql,rows);
 const fingerprint=()=>db.sql(`select (select count(*) from private.mutation_receipts)||'/'||(select count(*) from private.resolution_submissions)||'/'||(select count(*) from private.amendment_submissions)||'/'||(select count(*) from private.access_credentials)||'/'||(select count(*) from public.user_access)||'/'||(select count(*) from private.access_redemption_attempts)||'/'||(select count(*) from lifecycle.proof_uses)||'/'||(select count(*) from public.attendance)`);

 /** Reference gateway: mint a proof for the exact values, then call the wrapper as PostgREST would (named arguments, role, claims). */
 const gw=async(id:Identity,fam:FamName,values:(string|null)[],o:{key?:Key;epoch?:number;proof?:object|null;sub?:string;sid?:string;jti?:string;iat?:number;exp?:number;send?:(string|null)[];override?:Record<string,string>;conn?:Parameters<ProtoDb['as']>[3]}={})=>{
  const f:Family=FAM[fam];
  const epoch=o.epoch??(await state()).epoch;
  const proof=o.proof!==undefined?o.proof:mint({key:o.key??key,typ:f.typ,aud:AUD,epoch,sub:o.sub??(f.typ==='user'?id.sub:f.sub),sid:f.typ==='user'?(o.sid??id.sid):undefined,jti:o.jti??(f.single?randomUUID():undefined),fn:f.fn,args:values,iat:o.iat,exp:o.exp,override:o.override});
  const sent=o.send??values;
  const call=`select public.${f.wrapper}(${f.names.map((n,i)=>`${n}=>${q(sent[i])}`).join(',')},proof=>${proof===null?'null':`${literal(JSON.stringify(proof))}::jsonb`})${f.returns?' as r':''}`;
  return db.as(id,call,f.returns,o.conn);
 };
 const direct=(id:Identity,fam:FamName,values:(string|null)[])=>{
  const f:Family=FAM[fam];
  return db.as(id,`select public.${f.fn}(${f.names.map((n,i)=>`${n}=>${q(values[i])}`).join(',')})${f.returns?' as r':''}`,f.returns);
 };
 const rev=async(delegate:string)=>db.sql(`select coalesce((select revision from public.attendance where "sessionId"='${ids.session}' and "delegateId"='${delegate}'),0)::text`);
 const attendance=(delegate:string,status:string)=>JSON.stringify({type:'attendance',sessionId:ids.session,delegateId:delegate,status});
 // The outbox keeps createdAt, so a retry re-sends the same client_time. The payload stored in the receipt includes it.
 const clock=new Map<string,string>();
 const stamp=(m:string)=>{if(!clock.has(m))clock.set(m,new Date().toISOString());return clock.get(m)!;};
 const mutationValues=(m:string,delegate:string,status:string,expected:string|null)=>[ids.conference,m,attendance(delegate,status),'chair',expected,stamp(m)];
 const receipts=(m:string)=>db.sql(`select count(*) from private.mutation_receipts where id='${m}'`);

 try{
  // ---- setup --------------------------------------------------------------------------------------------------------
  await db.sql(`select lifecycle.init(${literal(AUD)});`);
  await db.sql(`insert into auth.users values('${exec}'),('${chair}'),('${device}'),('${outsider}'),('${otherChair}');
   insert into public.user_access(conference_id,user_id,role,expires_at) values('${ids.conference}','${exec}','admin',now()+interval '1 day');
   insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values('${ids.conference}','${chair}','chair','${ids.ga1}',now()+interval '1 day');
   insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values('${ids.conference}','${otherChair}','chair','${ids.who}',now()+interval '1 day');`);
  assert.deepEqual((await op(`select lifecycle.add_key(${literal(key.kid)},'test',${hexBytea(key)})`)).ok,true);
  assert.equal((await state()).phase,'preproduction');

  // ---- (a) lifecycle schema hard boundary ---------------------------------------------------------------------------
  await t.test('(a) lifecycle schema is unreachable for every non-operator role; marker and log refuse direct change',async()=>{
   for(const role of ['anon','authenticated','service_role','authenticator','proto_agent','proto_nobody']){
    for(const sql of ['select * from lifecycle.project_state','select * from lifecycle.gateway_keys','select * from lifecycle.transitions','select * from lifecycle.proof_uses',
     `select lifecycle.transition('synthetic_locked',1,1,'x')`,`select lifecycle.verify_chain()`,`select lifecycle.add_key('k','test','\\x00')`,`insert into lifecycle.proof_uses(jti,fn,exp) values('a','b',now())`,
     `update lifecycle.project_state set phase='production'`,`select lifecycle.args_digest('f',array['a'])`]){
     const r=await db.as({role},sql,sql.startsWith('select'));
     assert.equal(codeOf(r),'42501',`${role}: ${sql} -> ${JSON.stringify(r)}`);
    }
   }
   const privs=await db.sql(`select count(*) from (select r.rolname,c.relname from pg_roles r,pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='lifecycle' and c.relkind in ('r','S')
     and r.rolname in ('anon','authenticated','service_role','authenticator','proto_agent','proto_nobody') and (has_table_privilege(r.oid,c.oid,'select') or has_table_privilege(r.oid,c.oid,'insert') or has_table_privilege(r.oid,c.oid,'update') or has_table_privilege(r.oid,c.oid,'delete'))) x`);
   assert.equal(privs,'0');
   // The operator can call the lifecycle functions but still cannot touch the tables directly.
   assert.equal(codeOf(await op('select * from lifecycle.project_state',true)),'42501');
   assert.equal(codeOf(await op('update lifecycle.project_state set phase=\'production\'')),'42501');
   // Even the table owner (and a superuser) cannot UPDATE the marker outside the lifecycle functions, nor change the log.
   assert.equal(codeOf(await db.as({role:'lifecycle_owner'},`update lifecycle.project_state set phase='production'`)),'GW091');
   assert.equal(codeOf(await db.as({role:'postgres'},`update lifecycle.project_state set phase='production'`)),'GW091');
   assert.equal(codeOf(await db.as({role:'postgres'},`delete from lifecycle.project_state`)),'GW091');
   assert.equal(codeOf(await db.as({role:'postgres'},`truncate lifecycle.project_state`)),'GW090');
   for(const sql of [`update lifecycle.transitions set operator='x'`,`delete from lifecycle.transitions`,`truncate lifecycle.transitions`])assert.equal(codeOf(await db.as({role:'postgres'},sql)),'GW090',sql);
   assert.equal(await db.sql('select lifecycle.verify_chain()'),'t');
   // Tamper detection (not prevention): a superuser who disables the trigger and edits the log breaks the hash chain.
   assert.equal(await db.sql(`begin; alter table lifecycle.transitions disable trigger transitions_append_only; update lifecycle.transitions set operator='intruder' where seq=1; select lifecycle.verify_chain(); rollback;`),'f');
   assert.equal(await db.sql('select lifecycle.verify_chain()'),'t');
  });

  // ---- (b) caller identity through SECURITY DEFINER vs INVOKER ------------------------------------------------------
  await t.test('(b) caller identity survives a SECURITY DEFINER wrapper; INVOKER cannot satisfy both requirements',async()=>{
   const asChair=user(chair);
   const inv=(await db.as(asChair,'select proto_probe.who() w',true)).rows![0].w as Record<string,string>;
   const def=(await db.as(asChair,'select proto_probe.gw_who() w',true)).rows![0].w as Record<string,string>;
   note(`identity seen inside an INVOKER function: ${JSON.stringify(inv)}`);
   note(`identity seen inside a DEFINER (gw_owner) wrapper: ${JSON.stringify(def)}`);
   assert.equal(def.uid,chair);assert.equal(def.claims_sub,chair);assert.equal(def.claims_session,sid(chair));
   assert.equal(inv.current_user,'authenticated');assert.equal(def.current_user,'gw_owner');
   assert.equal(def.role_guc,'authenticated','the role GUC is unchanged inside a definer function; only current_user changes');
   // Pass-through pair with the callee still executable by authenticated: both work and both record the real actor.
   const a=randomUUID(),b=randomUUID();
   const pass=async(name:string,m:string)=>db.as(asChair,`select proto_probe.${name}('${ids.conference}','${m}',${literal(attendance(ids.japan,'Present'))}::jsonb,'chair',${q(await rev(ids.japan))},now())`);
   const r1=await pass('invoker_pass',a),r2=await pass('definer_pass',b);
   assert.ok(r1.ok,JSON.stringify(r1));assert.ok(r2.ok,JSON.stringify(r2));
   assert.equal(await db.sql(`select count(*) from private.mutation_receipts where id in ('${a}','${b}') and actor_id='${chair}'`),'2','receipt actor is the real user in both variants');
   // The INVOKER proof wrapper cannot even run: it would need USAGE on the lifecycle schema for authenticated.
   const proofArgs=mutationValues(randomUUID(),ids.france,'Present & Voting',null);
   const invokerProof=mint({key,typ:'user',aud:AUD,epoch:1,sub:chair,sid:sid(chair),fn:'apply_conference_mutation',args:proofArgs});
   const named=['conf','mutation','command','requested_role','expected','client_time'].map((n,i)=>`${n}=>${q(proofArgs[i])}`).join(',');
   const inw=await db.as(asChair,`select public.gw_invoker_apply_conference_mutation(${named},proof=>${literal(JSON.stringify(invokerProof))}::jsonb)`);
   note(`INVOKER proof wrapper, callee still executable: ${JSON.stringify(inw)}`);
   assert.equal(inw.code,'42501');assert.match(inw.msg!,/schema lifecycle/);
  });

  // ---- (g) idempotency / PT409 parity (direct versus wrapper), BEFORE direct execute is revoked ---------------------
  const scenario=async(send:(m:string,delegate:string,status:string,expected:string|null)=>Promise<Outcome>,delegate:string)=>{
   const [u1,u2,u3]=[randomUUID(),randomUUID(),randomUUID()];
   const e0=await rev(delegate);
   const r1=await send(u1,delegate,'Present & Voting',e0);
   const e1=await rev(delegate);
   const r2=await send(u1,delegate,'Present & Voting',e0);
   const r3=await send(u1,delegate,'Absent',e0);
   const r4=await send(u2,delegate,'Present',e1);
   const r5=await send(u3,delegate,'Absent',e1);
   const r6=await send(u3,delegate,'Absent',await rev(delegate));
   const e2=Number(await rev(delegate)),n=[Number(e0),Number(e1),e2];
   return {codes:[r1,r2,r3,r4,r5,r6].map(codeOf),msgs:[r1,r2,r3,r4,r5,r6].map(r=>r.ok?null:r.msg),receipts:[await receipts(u1),await receipts(u2),await receipts(u3)],revisionSteps:[n[1]-n[0],n[2]-n[1]]};
  };
  await t.test('(g) mutation UUID idempotency, replay and PT409 stale-write behave identically through the wrapper',async()=>{
   const id=user(chair);
   const viaDirect=await scenario((m,d,s,e)=>direct(id,'mutation',mutationValues(m,d,s,e)),ids.japan);
   const viaWrapper=await scenario((m,d,s,e)=>gw(id,'mutation',mutationValues(m,d,s,e)),ids.france);
   note(`direct   : ${JSON.stringify(viaDirect)}`);
   note(`wrapper  : ${JSON.stringify(viaWrapper)}`);
   assert.deepEqual(viaWrapper,viaDirect,'identical codes, messages, receipt counts and revision progression');
   assert.deepEqual(viaWrapper.codes,['ok','ok','22023','ok','PT409','ok']);
   assert.deepEqual(viaWrapper.receipts,['1','1','1']);
   // Replay with a FRESH proof (a retry after a lost response) returns the stored result and adds nothing.
   const m=randomUUID(),e=await rev(ids.france);
   assert.ok((await gw(id,'mutation',mutationValues(m,ids.france,'Present',e))).ok);
   const before=await fingerprint();
   await new Promise(r=>setTimeout(r,1100));
   const retry=await gw(id,'mutation',mutationValues(m,ids.france,'Present',e),{iat:Math.floor(Date.now()/1000)});
   assert.ok(retry.ok);assert.equal(await fingerprint(),before,'no new receipt, attendance revision or proof use');
   // Concurrent duplicate sends of the same mutation UUID (two sessions, two different proofs): exactly one effect.
   const m2=randomUUID(),e2=await rev(ids.france);
   const c1=db.connect('dup1'),c2=db.connect('dup2');
   const ep=(await state()).epoch;
   const [x,y]=await Promise.all([gw(id,'mutation',mutationValues(m2,ids.france,'Absent',e2),{conn:c1,epoch:ep}),gw(id,'mutation',mutationValues(m2,ids.france,'Absent',e2),{conn:c2,epoch:ep})]);
   assert.deepEqual([x.ok,y.ok],[true,true]);assert.equal(await receipts(m2),'1');
  });

  // ---- direct versus wrapper for the public submissions, before revocation ---------------------------------------------
  const linkToken='ProtoLinkToken_'+'a'.repeat(12),docId=(n:string)=>('ProtoDoc'+n).padEnd(30,'x');
  await db.sql(`insert into public.submission_links(conference_id,committee_id,token) values('${ids.conference}','${ids.ga1}','${linkToken}')`);
  const subValues=(submission:string,doc:string,over:Partial<Record<number,string|null>>={})=>{
   const v:(string|null)[]=[linkToken,submission,ids.france,'Proto resolution',doc,null,null,null,null];
   for(const [i,x] of Object.entries(over))v[Number(i)]=x as string|null;return v;
  };
  const server:Identity={role:'service_role'};
  await t.test('(c) public submissions: wrapper outcomes equal direct service_role outcomes; no user session involved',async()=>{
   const run=async(send:(v:(string|null)[])=>Promise<Outcome>,tag:string)=>{
    const s1=randomUUID(),d1=docId(tag),out:string[]=[];
    const created=await send(subValues(s1,d1));out.push(codeOf(created));
    const replay=await send(subValues(s1,d1));out.push(codeOf(replay));
    const conflict=await send(subValues(s1,d1,{3:'Different title'}));out.push(`${codeOf(conflict)}:${conflict.msg}`);
    const dup=await send(subValues(randomUUID(),d1));out.push(codeOf(dup));
    const bad=await send(subValues(randomUUID(),docId(tag+'z'),{0:'z'.repeat(22)}));out.push(`${codeOf(bad)}:${bad.msg}`);
    const status=(o:Outcome)=>o.ok?(o.rows![0].r as {status:string}).status:'-';
    return {out,statuses:[status(created),status(replay),status(dup)]};
   };
   const viaDirect=await run(v=>direct(server,'submission',v),'direct');
   const viaWrapper=await run(v=>gw(server,'submission',v),'wrapper');
   note(`submissions direct=${JSON.stringify(viaDirect)} wrapper=${JSON.stringify(viaWrapper)}`);
   assert.deepEqual(viaWrapper,viaDirect);
   assert.deepEqual(viaWrapper.statuses,['created','replayed','duplicate']);
   assert.equal(await db.sql(`select count(*) from auth.users where id not in ('${exec}','${chair}','${device}','${outsider}','${otherChair}')`),'0','no auth identity created');
  });

  // ---- apply the second migration: revoke direct EXECUTE -------------------------------------------------------------
  const guarded:{sig:string;fam?:FamName}[]=[
   {sig:'public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',fam:'mutation'},
   {sig:'public.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',fam:'operations'},
   {sig:'public.redeem_access_code(uuid,text)',fam:'redeem'},{sig:'public.rotate_access_code(uuid,public.conference_role,uuid,timestamptz)',fam:'rotate'},
   {sig:'public.revoke_access_code(uuid,uuid,boolean)',fam:'revoke'},{sig:'public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)',fam:'submission'},
   {sig:'public.submit_amendment(text,uuid,uuid,uuid,text,text,text)',fam:'amendment'},
   {sig:'private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'},{sig:'private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'},
   {sig:'private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'},{sig:'private.apply_staff_batch(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'},
  ];
  const ROLES=['anon','authenticated','service_role','authenticator','proto_agent','proto_nobody','postgres'];
  const execMatrix=async()=>JSON.parse(await db.sql(`select coalesce(json_object_agg(sig,json_build_object(${ROLES.map(r=>`'${r}',has_function_privilege('${r}',sig::regprocedure,'EXECUTE')`).join(',')},'PUBLIC',exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=sig::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'))),'{}') from (values ${guarded.map(g=>`('${g.sig}')`).join(',')}) v(sig)`)) as Record<string,Record<string,boolean>>;

  await t.test('(e) before the revocation migration every guarded function is directly executable (the exposure being closed)',async()=>{
   const before=await execMatrix();
   const exposed=Object.entries(before).filter(([,r])=>r.anon||r.authenticated||r.service_role||r.PUBLIC).map(([s])=>s);
   note(`directly executable before revocation (by anon/authenticated/service_role/PUBLIC): ${exposed.length} of ${guarded.length}`);
   assert.equal(exposed.length,guarded.length);
   assert.ok(before['public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'].service_role,'service_role holds EXECUTE through default privileges, not through the migrations');
   assert.ok(before['public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'].proto_agent,'a custom role that inherits authenticated is exposed too');
   assert.ok(!before['public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'].proto_nobody);
  });
  applyRevocation(db);

  await t.test('(e) after revocation no role, including PUBLIC and a custom role, can call any guarded function directly; the wrapper still can',async()=>{
   const after=await execMatrix();
   for(const [sig,roles] of Object.entries(after))for(const r of ['anon','authenticated','service_role','authenticator','proto_agent','proto_nobody','PUBLIC'])assert.equal(roles[r],false,`${sig} still executable by ${r}`);
   // Same valid chair session and a leaked service key: every direct attempt is refused, none changes a row.
   const frozen=await fingerprint();
   const valid:Record<string,(string|null)[]>={
    mutation:mutationValues(randomUUID(),ids.france,'Present',null),operations:[ids.conference,randomUUID(),JSON.stringify({type:'submissionLink',action:'shareWith',committeeId:ids.ga1,shareWith:'x'}),'admin',null,new Date().toISOString()],
    redeem:[ids.conference,'x'],rotate:[ids.conference,'chair',ids.ga1,new Date(Date.now()+864e5).toISOString()],revoke:[ids.conference,randomUUID(),'true'],
    submission:subValues(randomUUID(),docId('denied')),amendment:['t'.repeat(30),randomUUID(),ids.france,ids.resolution,'Add','c','w'],
   };
   for(const role of ['anon','authenticated','service_role','authenticator','proto_agent','proto_nobody'])
    for(const [fam,values] of Object.entries(valid)){
     const r=await direct({role,sub:chair,sid:sid(chair)},fam as FamName,values);
     assert.equal(codeOf(r),'42501',`${role} -> ${fam}: ${JSON.stringify(r)}`);
    }
   // The private implementations are not reachable either (matters if the private schema were ever exposed, assumption A3).
   for(const g of guarded.filter(g=>g.sig.startsWith('private.')))
    assert.equal(codeOf(await db.as(user(chair),`select ${g.sig.replace(/\(.*$/,'')}('${ids.conference}','${randomUUID()}','{}'::jsonb,'chair',null,now())`)),'42501',g.sig);
   assert.equal(await fingerprint(),frozen);
   // Positive control: the same chair, same session, through the wrapper.
   assert.ok((await gw(user(chair),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)))).ok);
   // Reads are deliberately untouched (decision D8).
   assert.ok((await db.as(user(chair),`select public.conference_snapshot('${ids.conference}')::text is not null as ok`,true)).ok);
  });

  await t.test('(e) the invoker/definer finding holds after revocation: only a DEFINER pass-through still reaches the callee',async()=>{
   const id=user(chair);
   const call=async(name:string)=>db.as(id,`select proto_probe.${name}('${ids.conference}','${randomUUID()}',${literal(attendance(ids.japan,'Present'))}::jsonb,'chair',${q(await rev(ids.japan))},now())`);
   const inv=await call('invoker_pass'),def=await call('definer_pass');
   note(`after revocation: invoker pass-through ${JSON.stringify(inv)}; definer pass-through ${JSON.stringify(def)}`);
   assert.equal(inv.code,'42501');assert.ok(def.ok,JSON.stringify(def));
  });

  await t.test('(e) a leaked service_role key still writes TABLES directly after the function revocation; revoking its table DML closes that',async()=>{
   const dml=(r:string)=>db.as({role:r},`update public.committees set room=room where id='${ids.ga1}'`);
   assert.equal(codeOf(await dml('anon')),'42501');assert.equal(codeOf(await dml('authenticated')),'42501');
   const open=await dml('service_role');
   note(`service_role UPDATE on public.committees after the function revocation: ${JSON.stringify(open)}`);
   assert.ok(open.ok,'service_role keeps table DML through default privileges and bypasses RLS');
   const priv=JSON.parse(await db.sql(`select to_json(array(select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE')))`)) as string[];
   note(`public tables on which service_role can write: ${priv.length}`);
   assert.ok(priv.length>30);
   // Candidate extra migration: revoke the mutating privileges; the SECURITY DEFINER wrappers and functions do not need them.
   await db.sql(`revoke insert,update,delete,truncate on all tables in schema public from service_role`);
   assert.equal(codeOf(await dml('service_role')),'42501');
   assert.ok((await gw(server,'submission',subValues(randomUUID(),docId('after-dml-revoke')))).ok,'server-route submissions still work through the wrapper');
   assert.ok((await gw(user(chair),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)))).ok);
   // A table created by a LATER migration would be writable again through the default privileges.
   await db.sql(`create table public.proto_later_table(id int)`);
   assert.equal(await db.sql(`select has_table_privilege('service_role','public.proto_later_table','INSERT')`),'t');
   await db.sql(`drop table public.proto_later_table`);
  });

  await t.test('(e) default privileges: CREATE OR REPLACE keeps the revocation; DROP + CREATE and new overloads re-expose; ALTER DEFAULT PRIVILEGES closes it',async()=>{
   const sig='public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)';
   const callable=async(r:string)=>(await db.sql(`select has_function_privilege('${r}','${sig}'::regprocedure,'EXECUTE')`))==='t';
   // 0. A DEFINER function with no private callee (submit_amendment): DROP + CREATE reopens it to service_role directly.
   const amendSig='public.submit_amendment(text,uuid,uuid,uuid,text,text,text)';
   const defHex=(sg:string)=>db.sql(`select encode(convert_to(pg_get_functiondef('${sg}'::regprocedure),'UTF8'),'hex')`);
   const recreate=(hex:string)=>db.sql(`do $r$begin execute convert_from(decode('${hex}','hex'),'UTF8'); end $r$`);
   const amendDef=await defHex(amendSig);
   const amendArgs=['z'.repeat(30),randomUUID(),ids.france,ids.resolution,'Add','c','w'];
   assert.equal(codeOf(await direct(server,'amendment',amendArgs)),'42501');
   await db.sql(`drop function ${amendSig}`);await recreate(amendDef);
   const reopened=await direct(server,'amendment',amendArgs);
   note(`service_role direct call to a DROP+CREATEd definer write function: ${JSON.stringify(reopened)}`);
   assert.match(String(reopened.msg),/invalid_link/,'reached the function body: the direct path is open again');
   applyRevocation(db);
   assert.equal(codeOf(await direct(server,'amendment',amendArgs)),'42501');
   assert.equal(codeOf(await gw(server,'amendment',amendArgs)),'42501','and the wrapper lost its grant with the DROP: gw_owner must be re-granted');
   await db.sql(`grant execute on function ${amendSig} to gw_owner`);
   assert.match(String((await gw(server,'amendment',amendArgs)).msg),/invalid_link/);
   const def=await defHex(sig);
   // 1. a later migration that redefines the body with CREATE OR REPLACE (pg_get_functiondef already emits that form)
   await recreate(def);
   assert.equal(await callable('authenticated'),false);assert.equal(await callable('service_role'),false);
   // 2. a later migration that DROPs and recreates it: default privileges (and PUBLIC) grant it again, and gw_owner's grant is gone
   await db.sql(`drop function ${sig}`);await recreate(def);
   const reexposed=[await callable('authenticated'),await callable('service_role'),await callable('anon'),await callable('proto_nobody')];
   note(`after DROP+CREATE of a revoked function, direct EXECUTE by authenticated/service_role/anon/PUBLIC: ${reexposed.join('/')}`);
   assert.deepEqual(reexposed,[true,true,true,true]);
   const direct2=await db.as(user(chair),`select public.apply_conference_mutation('${ids.conference}','${randomUUID()}',${literal(attendance(ids.japan,'Present'))}::jsonb,'chair',${q(await rev(ids.japan))},now())`);
   note(`direct call to the re-exposed INVOKER public.apply_conference_mutation: ${JSON.stringify(direct2)}`);
   assert.equal(direct2.code,'42501');assert.match(direct2.msg!,/apply_mutation/,'the revoked private.apply_mutation still stops it: the second ring holds');
   // 3. re-running the revocation also removes gw_owner's execute (it only had it through PUBLIC): the wrapper now breaks until re-granted
   applyRevocation(db);
   const broken=await gw(user(chair),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)));
   note(`wrapper after re-revoking a recreated callee without re-granting gw_owner: ${JSON.stringify(broken)}`);
   assert.equal(broken.code,'42501');
   await db.sql(`grant execute on function ${sig} to gw_owner`);
   assert.ok((await gw(user(chair),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)))).ok);
   // 4. a new overload is exposed by default
   await db.sql(`create function public.apply_conference_mutation(conf uuid) returns void language sql as $$select 1$$`);
   assert.equal(await db.sql(`select has_function_privilege('authenticated','public.apply_conference_mutation(uuid)'::regprocedure,'EXECUTE')`),'t');
   await db.sql(`drop function public.apply_conference_mutation(uuid)`);
   // 5. the mitigation: default privileges revoked for the migration owner, then DROP + CREATE stays closed
   await db.sql(`alter default privileges for role postgres in schema public revoke execute on functions from anon,authenticated,service_role;
    alter default privileges for role postgres revoke execute on functions from public;`);
   await db.sql(`drop function ${sig}`);await recreate(def);
   const closed=[await callable('authenticated'),await callable('service_role'),await callable('anon'),await callable('proto_nobody')];
   note(`after ALTER DEFAULT PRIVILEGES ... REVOKE, DROP+CREATE leaves direct EXECUTE by authenticated/service_role/anon/PUBLIC: ${closed.join('/')}`);
   assert.deepEqual(closed,[false,false,false,false]);
   await db.sql(`grant execute on function ${sig} to gw_owner`);
   assert.ok((await gw(user(chair),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)))).ok);
   // Consequence: a LATER migration that adds a legitimate read RPC now needs its own explicit GRANT, or authenticated cannot call it.
   await db.sql(`create function public.proto_new_read() returns int language sql stable as $$select 1$$`);
   assert.equal(codeOf(await db.as(user(chair),'select public.proto_new_read() r',true)),'42501');
   await db.sql(`drop function public.proto_new_read()`);
  });

  // ---- (f) argument binding ----------------------------------------------------------------------------------------------
  const sample:Record<FamName,{id:Identity;values:()=>(string|null)[]}>={
   mutation:{id:user(chair),values:()=>mutationValues(randomUUID(),ids.france,'Present',null)},
   operations:{id:user(exec),values:()=>[ids.conference,randomUUID(),JSON.stringify({type:'submissionLink',action:'shareWith',committeeId:ids.ga1,shareWith:'bound'}),'admin',null,new Date().toISOString()]},
   redeem:{id:user(device),values:()=>[ids.conference,'not-a-real-code']},
   rotate:{id:user(exec),values:()=>[ids.conference,'chair',ids.ga1,new Date(Date.now()+864e5).toISOString()]},
   revoke:{id:user(exec),values:()=>[ids.conference,randomUUID(),'true']},
   submission:{id:server,values:()=>subValues(randomUUID(),docId('bind'))},
   amendment:{id:server,values:()=>[linkToken,randomUUID(),ids.france,ids.resolution,'Add','Clause 1','Bound wording']},
  };
  await t.test('(f) altering ANY single argument after the proof was minted is refused with no effect (every argument of every wrapper)',async()=>{
   let cases=0;
   for(const fam of Object.keys(FAM) as FamName[]){
    const {id,values}=sample[fam];
    for(let i=0;i<FAM[fam].names.length;i++){
     const v=values();
     const base=v[i];
     const variants:(string|null)[]=[base===null?'tampered':base+'x',base===null?'':null,base===null?'0':base.toUpperCase()===base?base.toLowerCase():base.toUpperCase(),base===null?' ':` ${base}`];
     for(const alt of variants.filter(a=>a!==base)){
      const before=await fingerprint();
      const sent=[...v];sent[i]=alt;
      const r=await gw(id,fam,v,{send:sent});
      assert.equal(r.code,'GW034',`${fam}.${FAM[fam].names[i]} -> ${JSON.stringify(alt)}: ${JSON.stringify(r)}`);
      assert.equal(await fingerprint(),before,`${fam}.${FAM[fam].names[i]} changed state`);
      cases++;
     }
    }
   }
   note(`argument-binding negatives executed: ${cases}`);
   // JSON whitespace is NOT normalised: a semantically identical command re-serialised differently is refused (digest covers exact bytes).
   const v=sample.mutation.values();const re=JSON.stringify(JSON.parse(v[2]!),null,1);
   assert.equal((await gw(user(chair),'mutation',v,{send:[v[0],v[1],re,v[3],v[4],v[5]]})).code,'GW034');
   // Other bindings: another function, another actor, another session, another project, another epoch, wrong type.
   const base=sample.mutation.values(),idc=user(chair);
   assert.equal((await gw(idc,'mutation',base,{override:{fn:'apply_operations_mutation',ad:mint({key,typ:'user',aud:AUD,epoch:1,fn:'apply_operations_mutation',args:base}).ad}})).code,'GW033');
   assert.equal((await gw(idc,'mutation',base,{sub:otherChair})).code,'GW050');
   assert.equal((await gw(idc,'mutation',base,{sid:'another-session'})).code,'GW051');
   assert.equal((await gw(idc,'mutation',base,{override:{aud:'another-project'}})).code,'GW031');
   assert.equal((await gw(idc,'mutation',base,{epoch:99})).code,'GW032');
   assert.equal((await gw(idc,'mutation',base,{proof:{...mint({key,typ:'user',aud:AUD,epoch:1,sub:chair,sid:sid(chair),fn:'apply_conference_mutation',args:base}),mac:'0'.repeat(64)}})).code,'GW030');
   assert.equal((await gw(idc,'mutation',base,{proof:null})).code,'GW010');
   assert.equal((await gw(idc,'mutation',base,{override:{kid:'no-such-key'}})).code,'GW020');
   assert.equal((await gw(idc,'mutation',base,{iat:Math.floor(Date.now()/1000)-120,exp:Math.floor(Date.now()/1000)-60})).code,'GW001');
   assert.equal((await gw(idc,'mutation',base,{iat:Math.floor(Date.now()/1000)+600,exp:Math.floor(Date.now()/1000)+660})).code,'GW001');
   assert.equal((await gw(idc,'mutation',base,{iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).code,'GW001','a proof longer than 60 s is refused');
   // A user proof cannot drive a server wrapper and vice versa; server proofs name their route.
   const sv=sample.submission.values();
   assert.equal((await gw(server,'submission',sv,{proof:mint({key,typ:'user',aud:AUD,epoch:1,sub:chair,sid:sid(chair),fn:'submit_resolution',args:sv})})).code,'GW035');
   assert.equal((await gw(server,'submission',sv,{sub:'route:amendments'})).code,'GW060');
   assert.equal((await gw(server,'submission',sv,{proof:mint({key,typ:'server',aud:AUD,epoch:1,sub:'route:submissions',sid:'a-session',fn:'submit_resolution',args:sv})})).code,'GW060','a server proof may not carry a user session');
  });
  await t.test('(f) static coverage: every gw_* wrapper binds every argument of the function it wraps, in signature order (T28 style)',async()=>{
   const rows=JSON.parse(await db.sql(`select coalesce(jsonb_agg(x order by x.name),'[]') from (select w.proname "name",
     (select array_agg(n order by o) from unnest(w.proargnames) with ordinality a(n,o) where n<>'proof') "wrapperArgs",
     o.proargnames "origArgs",
     substring(w.prosrc from 'array\\[([^\\]]*)\\]') "digestList"
    from pg_proc w join pg_namespace s on s.oid=w.pronamespace join pg_proc o on o.pronamespace=s.oid and o.proname=substring(w.proname from 4)
    where s.nspname='public' and w.proname like 'gw\\_%' and w.proname<>'gw_invoker_apply_conference_mutation') x`)) as {name:string;wrapperArgs:string[];origArgs:string[];digestList:string}[];
   assert.equal(rows.length,Object.keys(FAM).length);
   for(const r of rows){
    assert.deepEqual(r.wrapperArgs,r.origArgs,`${r.name}: wrapper arguments equal the wrapped function's`);
    assert.deepEqual(r.digestList.split(',').map(s=>s.trim()),r.origArgs,`${r.name}: digest covers every argument in order`);
   }
  });

  // ---- (d) access codes ------------------------------------------------------------------------------------------------
  await t.test('(d) access codes through the gateway: redeem, rotate, revoke, single-use proof (jti) replay, rate limit, non-executive',async()=>{
   const exp=new Date(Date.now()+864e5).toISOString();
   const chairCode=[ids.conference,'chair',ids.ga1,exp];
   // A non-Executive cannot rotate; the failed call must not burn the jti (the whole call rolled back).
   const jti=randomUUID();
   const denied=await gw(user(chair),'rotate',chairCode,{jti});
   assert.equal(codeOf(denied),'42501',JSON.stringify(denied));
   assert.equal(await db.sql(`select count(*) from lifecycle.proof_uses where jti='${jti}'`),'0','a refused call does not consume the proof');
   // The Executive rotates.
   const rot=await gw(user(exec),'rotate',chairCode);
   assert.ok(rot.ok,JSON.stringify(rot));
   const issued=rot.rows![0].r as {id:string;code:string};
   assert.ok(issued.code&&issued.id);
   // Replay of the SAME rotate proof is refused and creates nothing.
   const j2=randomUUID(),mintOnce=mint({key,typ:'user',aud:AUD,epoch:1,sub:exec,sid:sid(exec),jti:j2,fn:'rotate_access_code',args:chairCode});
   const first=await gw(user(exec),'rotate',chairCode,{proof:mintOnce});
   assert.ok(first.ok);
   const credentialsBefore=await db.sql(`select count(*) from private.access_credentials`);
   const replay=await gw(user(exec),'rotate',chairCode,{proof:mintOnce});
   assert.equal(replay.code,'GW040');
   assert.equal(await db.sql(`select count(*) from private.access_credentials`),credentialsBefore);
   assert.equal(await db.sql(`select count(*) from lifecycle.proof_uses where jti='${j2}'`),'1');
   // Concurrent duplicate of one single-use proof from two sessions: exactly one wins.
   const j3=randomUUID(),p3=mint({key,typ:'user',aud:AUD,epoch:1,sub:exec,sid:sid(exec),jti:j3,fn:'rotate_access_code',args:chairCode});
   const ep3=(await state()).epoch;
   const [r1,r2]=await Promise.all([gw(user(exec),'rotate',chairCode,{proof:p3,epoch:ep3,conn:db.connect('jti1')}),gw(user(exec),'rotate',chairCode,{proof:p3,epoch:ep3,conn:db.connect('jti2')})]);
   assert.deepEqual([r1.ok,r2.ok].sort(),[false,true]);
   assert.equal([r1,r2].find(r=>!r.ok)!.code,'GW040','the loser sees the proof-reuse code, not a raw unique_violation (23505 would be classed as a conflict by the client)');
   // Latest code: the device redeems it (user session only; the code is the authority) and the new grant works through the gateway.
   const current=(await gw(user(exec),'rotate',chairCode)).rows![0].r as {id:string;code:string};
   assert.equal(await db.sql(`select count(*) from public.user_access where user_id='${device}'`),'0');
   const redeemed=await gw(user(device),'redeem',[ids.conference,current.code]);
   assert.equal((redeemed.rows![0].r as {status:string}).status,'ok');
   assert.equal(await db.sql(`select count(*) from public.user_access where user_id='${device}' and revoked_at is null`),'1');
   assert.ok((await gw(user(device),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)))).ok,'grant created by the redeemed code is usable through the gateway');
   // Redeem repeats are effect-idempotent (existing behaviour) and need no jti.
   assert.equal((((await gw(user(device),'redeem',[ids.conference,current.code])).rows![0].r) as {status:string}).status,'ok');
   // Wrong codes: rate limit of 8 failures per actor still applies and is itself written through the wrapper.
   const statuses:string[]=[];
   for(let i=0;i<9;i++)statuses.push((((await gw(user(outsider),'redeem',[ids.conference,`wrong-${i}`])).rows![0].r) as {status:string}).status);
   note(`redeem wrong-code statuses through wrapper: ${statuses.join(',')}`);
   assert.equal(statuses[0],'invalid');assert.equal(statuses[8],'rate_limited');
   // Revoke (with devices) through the gateway; replay refused.
   const revokeArgs=[ids.conference,current.id,'true'];const j4=randomUUID();
   const p4=mint({key,typ:'user',aud:AUD,epoch:1,sub:exec,sid:sid(exec),jti:j4,fn:'revoke_access_code',args:revokeArgs});
   assert.ok((await gw(user(exec),'revoke',revokeArgs,{proof:p4})).ok);
   assert.equal(await db.sql(`select count(*) from public.user_access where user_id='${device}' and revoked_at is null`),'0');
   assert.equal((await gw(user(exec),'revoke',revokeArgs,{proof:p4})).code,'GW040');
   // Revocation is immediate for the already-signed-in device: valid token, valid proof, no grant -> the EXISTING check refuses.
   const afterRevoke=await gw(user(device),'mutation',mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france)));
   assert.equal(afterRevoke.code,'42501');
  });

  // ---- (c) negatives and amendments ---------------------------------------------------------------------------------------
  await t.test('(c) public submissions and amendments: no proof, wrong principal, wrong route all refused; amendments behave as direct',async()=>{
   const before=await fingerprint();
   const v=subValues(randomUUID(),docId('neg'));
   assert.equal((await gw(server,'submission',v,{proof:null})).code,'GW010');
   // Calling the wrapper as anon or authenticated is a permission error (EXECUTE is service_role only).
   for(const role of ['anon','authenticated','proto_nobody'])assert.equal(codeOf(await gw({role,sub:chair,sid:sid(chair)},'submission',v)),'42501',role);
   // The old behaviour: service_role without the wrapper cannot write either (covered in (e)).
   assert.equal(await fingerprint(),before);
   // Amendment link + open resolution (same minimal fixture the repository's own tests use).
   const amendToken='protoamendment_1234567890_abcd';
   await db.sql(`insert into public.amendment_links(conference_id,committee_id,token) values('${ids.conference}','${ids.ga1}','${amendToken}');
    update public.committees set "currentSessionId"=(select "sessionId" from public.documents where id='${ids.resolution}') where id='${ids.ga1}'`);
   const submission=randomUUID();
   const a=[amendToken,submission,ids.france,ids.resolution,'Add','Clause 1','Exact passed wording'];
   const created=await gw(server,'amendment',a);assert.ok(created.ok,JSON.stringify(created));
   assert.deepEqual(created.rows![0].r,{status:'created',id:submission});
   assert.deepEqual((await gw(server,'amendment',a)).rows![0].r,{status:'replayed',id:submission});
   const different=[...a];different[6]='Other wording';
   assert.match((await gw(server,'amendment',different)).msg!,/idempotency_conflict/);
   assert.equal(((await gw(server,'amendment',[a[0],randomUUID(),...a.slice(2)])).rows![0].r as {status:string}).status,'duplicate');
   assert.match(String((await gw(server,'amendment',['z'.repeat(30),randomUUID(),...a.slice(2)])).msg),/invalid_link/);
   assert.equal(await db.sql(`select count(*) from public.amendments where id='${submission}'`),'1');
   // A user principal cannot use the server wrapper: no user session is needed, and one does not help.
   assert.equal(codeOf(await gw({role:'service_role',sub:chair,sid:sid(chair)},'amendment',a,{proof:mint({key,typ:'user',aud:AUD,epoch:1,sub:chair,sid:sid(chair),fn:'submit_amendment',args:a})})),'GW035');
  });

  // ---- (i) revocation and token floor with simulated claims (preproduction) -----------------------------------------------
  await t.test('(i) token floor: below-floor token refused, floor is raise-only, missing iat/session refused; grant revocation is immediate',async()=>{
   const now=Math.floor(Date.now()/1000);
   const m=async()=>mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france));
   assert.ok((await gw(user(chair,{iat:now-86400}),'mutation',await m())).ok,'floor 0: an old token is accepted');
   assert.ok((await op(`select lifecycle.raise_token_floor(${now-60})`)).ok);
   const old=await gw(user(chair,{iat:now-3600}),'mutation',await m());
   assert.equal(old.code,'GW052');
   assert.ok((await gw(user(chair,{iat:now-30}),'mutation',await m())).ok,'a token issued after the floor is accepted');
   assert.equal(codeOf(await op(`select lifecycle.raise_token_floor(${now-120})`)),'GW012','the floor never goes down');
   assert.equal(codeOf(await op(`select lifecycle.raise_token_floor(${now-60})`)),'GW012');
   // Claims without iat or session_id cannot satisfy a floor / the session binding.
   assert.equal((await gw(user(chair,{iat:null}),'mutation',await m())).code,'GW052','no iat claim cannot satisfy a floor');
   assert.equal((await gw(user(chair,{iat:now,sid:undefined}),'mutation',await m())).code,'GW051','no session_id claim cannot satisfy the session binding');
   // Grant revocation and expiry are immediate and need no token floor: a valid token and a valid proof still fail.
   assert.equal((await gw(user(otherChair,{iat:now}),'mutation',await m())).code,'42501','a chair of another committee is refused by the unchanged scoping check');
   await db.sql(`update public.user_access set revoked_at=now() where user_id='${chair}'`);
   assert.equal((await gw(user(chair,{iat:now}),'mutation',await m())).code,'42501');
   await db.sql(`update public.user_access set revoked_at=null where user_id='${chair}'`);
   await db.sql(`update public.user_access set expires_at=now()-interval '1 minute' where user_id='${chair}'`);
   assert.equal((await gw(user(chair,{iat:now}),'mutation',await m())).code,'42501');
   await db.sql(`update public.user_access set expires_at=now()+interval '1 day' where user_id='${chair}'`);
   assert.ok((await gw(user(chair,{iat:now}),'mutation',await m())).ok);
  });

  // ---- (h) key classes and lifecycle transitions ------------------------------------------------------------------------
  await t.test('(h) key classes by phase, allowed transitions, no way back from production, barrier B, token floor at promotion',async()=>{
   const nowS=()=>Math.floor(Date.now()/1000);
   const m=async()=>mutationValues(randomUUID(),ids.france,'Present',await rev(ids.france));
   // preproduction: only a test key is addable; evidence and production keys are refused.
   const ev=newKey('evidence'),prod=newKey('production');
   assert.equal(codeOf(await op(`select lifecycle.add_key('${ev.kid}','evidence',${hexBytea(ev)})`)),'GW011');
   assert.equal(codeOf(await op(`select lifecycle.add_key('${prod.kid}','production',${hexBytea(prod)})`)),'GW011');
   // Operator-only, stale epoch, skipped phase.
   for(const role of ['anon','authenticated','service_role','proto_agent','proto_nobody'])assert.equal(codeOf(await db.as({role},`select lifecycle.transition('synthetic_locked',1,10,'x')`)),'42501',role);
   assert.equal(codeOf(await op(`select lifecycle.transition('synthetic_locked',99,10,'x')`)),'GW013');
   assert.equal(codeOf(await op(`select lifecycle.transition('production',${(await state()).epoch},10,'x',now()-interval '1 day','15 minutes','10 minutes')`)),'GW014','preproduction cannot jump to production');
   const e0=(await state()).epoch;
   // preproduction -> synthetic_locked revokes the test key; a test-key proof is then refused.
   const entered=await op(`select lifecycle.transition('synthetic_locked',${e0},10,'evidence-1') as epoch`,true);
   assert.ok(entered.ok,JSON.stringify(entered));
   assert.equal((await state()).phase,'synthetic_locked');
   assert.equal((await gw(user(chair,{iat:nowS()}),'mutation',await m())).code,'GW021','test key revoked on entering synthetic_locked');
   // Defence in depth: even if a superuser re-activated the test key, its CLASS is not accepted in synthetic_locked.
   await db.sql(`update lifecycle.gateway_keys set status='active' where kid='${key.kid}'`);
   assert.equal((await gw(user(chair,{iat:nowS()}),'mutation',await m())).code,'GW022');
   await db.sql(`update lifecycle.gateway_keys set status='revoked' where kid='${key.kid}'`);
   // Evidence key: accepted in synthetic_locked (production-classified synthetic positive control, T22).
   assert.ok((await op(`select lifecycle.add_key('${ev.kid}','evidence',${hexBytea(ev)})`)).ok);
   assert.equal(codeOf(await op(`select lifecycle.add_key('x','test','\\x00')`)),'GW011','no new test keys once synthetic_locked');
   assert.ok((await gw(user(chair,{iat:nowS()}),'mutation',await m(),{key:ev})).ok);
   // A proof minted by the old (test) key with the old class is refused; production key is only staged: refused.
   assert.ok((await op(`select lifecycle.add_key('${prod.kid}','production',${hexBytea(prod)})`)).ok);
   assert.equal((await gw(user(chair,{iat:nowS()}),'mutation',await m(),{key:prod})).code,'GW021','a staged production key is not active');
   // Demotion is possible only before real data is attested, and revokes evidence/production keys.
   assert.ok((await op(`select lifecycle.set_real_data_attested(true)`)).ok);
   assert.equal(codeOf(await op(`select lifecycle.transition('preproduction',${(await state()).epoch},11,'x')`)),'GW014');
   assert.ok((await op(`select lifecycle.set_real_data_attested(false)`)).ok);
   const demoted=await op(`select lifecycle.transition('preproduction',${(await state()).epoch},11,'demote') as epoch`,true);
   assert.ok(demoted.ok,JSON.stringify(demoted));
   assert.equal(await db.sql(`select count(*) from lifecycle.gateway_keys where status<>'revoked'`),'0');
   // Register seq must rise on every transition.
   const key2=newKey('test2'),ev2=newKey('evidence2'),prod2=newKey('production2');
   assert.ok((await op(`select lifecycle.add_key('${key2.kid}','test',${hexBytea(key2)})`)).ok);
   assert.ok((await gw(user(chair,{iat:nowS()}),'mutation',await m(),{key:key2})).ok,'back in preproduction a fresh test key works');
   assert.equal(codeOf(await op(`select lifecycle.transition('synthetic_locked',${(await state()).epoch},11,'x')`)),'GW015');
   assert.ok((await op(`select lifecycle.transition('synthetic_locked',${(await state()).epoch},12,'evidence-2')`)).ok);
   assert.ok((await op(`select lifecycle.add_key('${ev2.kid}','evidence',${hexBytea(ev2)})`)).ok);
   // Promotion preconditions: exactly one staged production key, barrier B reached.
   assert.equal(codeOf(await op(`select lifecycle.transition('production',${(await state()).epoch},13,'x',now()-interval '1 day','15 minutes','10 minutes')`)),'GW018','no staged production key');
   assert.ok((await op(`select lifecycle.add_key('${prod2.kid}','production',${hexBytea(prod2)})`)).ok);
   const early=await op(`select lifecycle.transition('production',${(await state()).epoch},13,'early',now(),'15 minutes','10 minutes')`);
   note(`early promotion refused: ${JSON.stringify(early)}`);
   assert.equal(early.code,'GW017');
   assert.equal(codeOf(await op(`select lifecycle.transition('production',${(await state()).epoch},13,'early',now()-interval '24 minutes','15 minutes','10 minutes')`)),'GW017','one minute short of B');
   assert.equal(codeOf(await op(`select lifecycle.transition('production',${(await state()).epoch},13,'early',null,null,null)`)),'GW016','barrier inputs are mandatory');
   assert.equal((await state()).phase,'synthetic_locked');
   // Promote. Floor = ceil(now): a token issued before promotion is refused even though everything else is valid.
   const issuedBefore=nowS()-1;
   const promoted=await op(`select lifecycle.transition('production',${(await state()).epoch},13,'promotion',now()-interval '26 minutes','15 minutes','10 minutes') as epoch`,true);
   assert.ok(promoted.ok,JSON.stringify(promoted));
   const st=await state();
   assert.equal(st.phase,'production');assert.ok(st.token_floor>=issuedBefore+1);
   assert.equal((await gw(user(chair,{iat:issuedBefore}),'mutation',await m(),{key:prod2})).code,'GW052','pre-promotion session token refused by the floor');
   assert.equal((await gw(user(chair,{iat:st.token_floor-1}),'mutation',await m(),{key:prod2})).code,'GW052');
   assert.ok((await gw(user(chair,{iat:st.token_floor}),'mutation',await m(),{key:prod2})).ok,'a token issued at or after the floor works');
   // Every earlier class is refused.
   for(const k of [ev2,key2])assert.equal((await gw(user(chair,{iat:st.token_floor}),'mutation',await m(),{key:k})).code,'GW021');
   // Public submissions need the production key too, and the old pre-lock secret key still cannot write directly.
   const sv=subValues(randomUUID(),docId('prod'));
   assert.equal((await gw(server,'submission',sv,{key:ev2})).code,'GW021');
   assert.ok((await gw(server,'submission',sv,{key:prod2})).ok);
   assert.equal(codeOf(await direct(server,'submission',subValues(randomUUID(),docId('prod2')))),'42501');
   // No way back from production, no new keys, no demotion by the operator.
   for(const to of ['preproduction','synthetic_locked','production'])assert.equal(codeOf(await op(`select lifecycle.transition('${to}',${st.epoch},99,'x')`)),'GW014',to);
   assert.equal(codeOf(await op(`select lifecycle.add_key('late','test','\\x00')`)),'GW011');
   assert.equal(codeOf(await op(`select lifecycle.add_key('late','evidence','\\x00')`)),'GW011');
   // Marker and log: consistent hash chain, one row per event, append-only.
   assert.equal(await db.sql('select lifecycle.verify_chain()'),'t');
   const log=await db.sql(`select string_agg(kind||':'||coalesce(from_phase,'-')||'>'||to_phase||'@'||epoch,' ' order by seq) from lifecycle.transitions where kind in ('init','transition')`);
   note(`transition log: ${log}`);
   assert.equal(log,'init:->preproduction@1 transition:preproduction>synthetic_locked@2 transition:synthetic_locked>preproduction@3 transition:preproduction>synthetic_locked@4 transition:synthetic_locked>production@5');
   // Idempotency still behaves identically at production through the wrapper.
   const m3=randomUUID(),e3=await rev(ids.france),id3=user(chair,{iat:st.token_floor});
   assert.ok((await gw(id3,'mutation',mutationValues(m3,ids.france,'Absent',e3),{key:prod2})).ok);
   assert.ok((await gw(id3,'mutation',mutationValues(m3,ids.france,'Absent',e3),{key:prod2})).ok);
   assert.equal(await receipts(m3),'1');
   assert.equal((await gw(id3,'mutation',mutationValues(randomUUID(),ids.france,'Present',e3),{key:prod2})).code,'PT409');
  });

  console.log(`PROTO-NOTES ${JSON.stringify(notes)}`);
 }finally{await db.close();}
});
