import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {freshDatabase} from './helpers/database';

// Exercises the operator script exactly as committed (docs/FIRST_EXECUTIVE_BOOTSTRAP.md) against every migration.
const PLACEHOLDER='00000000-0000-0000-0000-000000000000';
const firstExecutive='77000000-0000-4000-8000-000000000001';
const otherDevice='77000000-0000-4000-8000-000000000002';
type Redemption={status:string;role?:string;committeeId?:string|null};

async function script(conference:string,validity='2 hours'){
 const sql=await readFile('scripts/bootstrap-first-executive.sql','utf8');
 assert.equal(sql.split(PLACEHOLDER).length,2,'one conference placeholder');
 assert.equal(sql.split("'2 hours',").length,2,'one validity placeholder');
 return sql.replace(PLACEHOLDER,conference).replace("'2 hours',",`'${validity}',`);
}

test('first-Executive bootstrap stores only a digest, redeems normally and is retired by the first rotation',async()=>{
 const {db,ids,query,as,asOwner}=await freshDatabase();
 try{
  await asOwner();
  const auditBefore=(await query<{n:number}>('select count(*)::int n from public.audit_log'))[0].n;
  const results=await db.exec(await script(ids.conference));
  const shown=results.at(-1)!.rows[0] as {executive_bootstrap_code_shown_once:string;credential_id:string};
  const code=shown.executive_bootstrap_code_shown_once;
  assert.match(code,/^[0-9A-F]{4}(?:-[0-9A-F]{4}){5}$/);

  const row=(await query<{role:string;committee_id:string|null;created_by:string|null;credential_hash:string;revoked_at:string|null;ttl:number}>(
   "select role,committee_id,created_by,credential_hash,revoked_at,extract(epoch from expires_at-now())::int ttl from private.access_credentials where id=$1",[shown.credential_id]))[0];
  assert.deepEqual({role:row.role,committee:row.committee_id,createdBy:row.created_by,revoked:row.revoked_at},{role:'admin',committee:null,createdBy:null,revoked:null});
  assert.ok(row.ttl>7000&&row.ttl<=7200,'explicit 2-hour validity');
  assert.equal(row.credential_hash,createHash('sha256').update(code.replaceAll('-','')).digest('hex'),'only the SHA-256 digest of the normalised code is stored');
  assert.equal((await query<{n:number}>('select count(*)::int n from public.audit_log'))[0].n,auditBefore,'no audit row');
  assert.equal((await query<{n:number}>("select count(*)::int n from public.audit_log where details::text ilike $1 or details::text like $2",[`%${code.replaceAll('-','')}%`,`%${row.credential_hash}%`]))[0].n,0);
  assert.equal((await query<{v:string|null}>("select current_setting('munos.bootstrap_code',true) v"))[0].v||null,null,'raw code does not outlive the transaction');

  // Never replaces: a second run, an out-of-range validity and an unknown conference are refused without inserting.
  await assert.rejects(async()=>db.exec(await script(ids.conference)),/unrevoked Executive credential already exists/);
  await assert.rejects(async()=>db.exec(await script(ids.conference,'48 hours')),/Validity .* refused/);
  await assert.rejects(async()=>db.exec(await script(PLACEHOLDER)),/does not exist in this project/);
  await asOwner();
  assert.equal((await query<{n:number}>("select count(*)::int n from private.access_credentials where conference_id=$1 and role='admin'",[ids.conference]))[0].n,1);

  // The first Executive redeems through the normal RPC on a fresh device identity.
  for(const user of [firstExecutive,otherDevice])await query('insert into auth.users(id) values($1)',[user]);
  await as(firstExecutive);
  const redeemed=(await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,code.toLowerCase()]))[0].r;
  assert.deepEqual({status:redeemed.status,role:redeemed.role,committee:redeemed.committeeId},{status:'ok',role:'admin',committee:null});

  // ...and immediately issues the normal Executive code, which retires the bootstrap credential.
  const rotated=(await query<{r:{id:string;code:string}}>('select public.rotate_access_code($1,$2,$3,$4) r',[ids.conference,'admin',null,new Date(Date.now()+86400000).toISOString()]))[0].r;
  assert.match(rotated.code,/^[0-9A-F]{4}(?:-[0-9A-F]{4}){5}$/);
  await asOwner();
  const after=(await query<{id:string;revoked:boolean;created_by:string|null}>("select id,revoked_at is not null revoked,created_by from private.access_credentials where conference_id=$1 and role='admin' order by created_at,id",[ids.conference]));
  assert.deepEqual(after.find(c=>c.id===shown.credential_id),{id:shown.credential_id,revoked:true,created_by:null});
  assert.deepEqual(after.find(c=>c.id===rotated.id),{id:rotated.id,revoked:false,created_by:firstExecutive});

  // The bootstrap code can no longer authorize another device; the prepared Executive device keeps its grant.
  await as(otherDevice);
  assert.equal((await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,code]))[0].r.status,'invalid');
  await asOwner();
  assert.equal((await query<{n:number}>('select count(*)::int n from public.user_access where user_id=$1',[otherDevice]))[0].n,0);
  assert.equal((await query<{n:number}>("select count(*)::int n from public.user_access where user_id=$1 and role='admin' and revoked_at is null and expires_at>now()",[firstExecutive]))[0].n,1);
  await as(firstExecutive);
  assert.ok(Array.isArray((await query<{s:unknown}>('select public.access_code_status($1) s',[ids.conference]))[0].s),'still an Executive');
 }finally{await db.close();}
});
