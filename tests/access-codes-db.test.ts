import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

const admin='76000000-0000-4000-8000-000000000001';
const deviceA='76000000-0000-4000-8000-000000000002';
const deviceB='76000000-0000-4000-8000-000000000003';
const deviceC='76000000-0000-4000-8000-000000000004';
const outsider='76000000-0000-4000-8000-000000000005';
const expiry=()=>new Date(Date.now()+2*86400000).toISOString();

type Rotation={id:string;role:string;committeeId:string|null;expiresAt:string;code:string};
type Redemption={status:'ok'|'invalid'|'rate_limited';role?:string;committeeId?:string|null;expiresAt?:string};

test('access code redeems into normal committee-scoped user_access and can be reused by a second device',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(admin,'admin');
  await asOwner();
  for(const user of [deviceA,deviceB])await query('insert into auth.users(id) values($1)',[user]);

  await as(admin);
  const rotated=(await query<{r:Rotation}>(
   'select public.rotate_access_code($1,$2,$3,$4) r',
   [ids.conference,'chair',ids.ga1,expiry()]
  ))[0].r;
  assert.equal(rotated.role,'chair');
  assert.equal(rotated.committeeId,ids.ga1);
  assert.match(rotated.code,/^[0-9A-F]{4}(?:-[0-9A-F]{4}){5}$/);

  await asOwner();
  const stored=(await query<{credential_hash:string}>(
   'select credential_hash from private.access_credentials where id=$1',[rotated.id]
  ))[0];
  assert.match(stored.credential_hash,/^[0-9a-f]{64}$/);
  assert.ok(!stored.credential_hash.includes(rotated.code.replaceAll('-','')),'raw code is not stored');

  for(const user of [deviceA,deviceB]){
   await as(user);
   await assert.rejects(()=>query('select public.conference_snapshot($1)',[ids.conference]),/access has not been granted/i);
   const redeemed=(await query<{r:Redemption}>(
    'select public.redeem_access_code($1,$2) r',[ids.conference,rotated.code]
   ))[0].r;
   assert.equal(redeemed.status,'ok');
   assert.equal(redeemed.role,'chair');
   assert.equal(redeemed.committeeId,ids.ga1);
   const snapshot=(await query<{s:{committees:unknown[]}}>(
    'select public.conference_snapshot($1) s',[ids.conference]
   ))[0].s;
   assert.equal(snapshot.committees.length,1,'RLS remains committee-scoped after redemption');
  }

  await asOwner();
  const grants=await query<{user_id:string;role:string;committee_id:string}>(
   'select user_id,role,committee_id from public.user_access where user_id=any($1::uuid[]) order by user_id',
   [[deviceA,deviceB]]
  );
  assert.equal(grants.length,2);
  assert.ok(grants.every(g=>g.role==='chair'&&g.committee_id===ids.ga1));
 }finally{await db.close();}
});

test('rotation invalidates the old code, optional device revocation is explicit, and raw secrets stay out of status/audit',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(admin,'admin');
  await asOwner();
  for(const user of [deviceA,deviceB,deviceC])await query('insert into auth.users(id) values($1)',[user]);

  await as(admin);
  const first=(await query<{r:Rotation}>('select public.rotate_access_code($1,$2,$3,$4) r',[ids.conference,'chair',ids.ga1,expiry()]))[0].r;
  await as(deviceA);
  assert.equal((await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,first.code]))[0].r.status,'ok');

  await as(admin);
  const second=(await query<{r:Rotation}>('select public.rotate_access_code($1,$2,$3,$4) r',[ids.conference,'chair',ids.ga1,expiry()]))[0].r;
  assert.notEqual(second.code,first.code);

  await as(deviceB);
  assert.equal((await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,first.code]))[0].r.status,'invalid','rotated code cannot grant a new device');

  await as(deviceA);
  assert.ok((await query<{s:unknown}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s,'routine rotation leaves prepared devices active');

  await as(deviceC);
  assert.equal((await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,second.code]))[0].r.status,'ok');

  await as(admin);
  const status=(await query<{r:unknown}>('select public.access_code_status($1) r',[ids.conference]))[0].r;
  const statusText=JSON.stringify(status);
  assert.ok(!statusText.includes(first.code)&&!statusText.includes(second.code));
  assert.ok(!statusText.includes('credential_hash'));
  const revoked=(await query<{r:{revokedDevices:number}}>('select public.revoke_access_code($1,$2,$3) r',[ids.conference,second.id,true]))[0].r;
  assert.equal(revoked.revokedDevices,1);

  await as(deviceC);
  await assert.rejects(()=>query('select public.conference_snapshot($1)',[ids.conference]),/access has not been granted/i);

  await asOwner();
  const audit=JSON.stringify(await query('select action,details from public.audit_log where action like $1',['Access code%']));
  assert.ok(!audit.includes(first.code)&&!audit.includes(second.code),'audit never contains raw codes');
  assert.ok(!audit.includes('credential_hash'),'audit never contains digests');
 }finally{await db.close();}
});

test('redemption failures are generic and rate-limited; non-Executive users cannot manage codes',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(admin,'admin');
  await asOwner();
  for(const user of [outsider,deviceA])await query('insert into auth.users(id) values($1)',[user]);

  await as(admin);
  const approval=(await query<{r:Rotation}>('select public.rotate_access_code($1,$2,$3,$4) r',[ids.conference,'approval',null,expiry()]))[0].r;

  await as(outsider);
  for(let i=0;i<8;i++){
   const result=(await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,'FFFF-FFFF-FFFF-FFFF-FFFF-FFFF']))[0].r;
   assert.equal(result.status,'invalid');
  }
  const limited=(await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,approval.code]))[0].r;
  assert.equal(limited.status,'rate_limited','valid code is not tried after the failure threshold');

  await as(deviceA);
  const ok=(await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,approval.code]))[0].r;
  assert.equal(ok.status,'ok');
  assert.equal(ok.role,'approval');
  assert.equal(ok.committeeId,null);
  await assert.rejects(
   ()=>query('select public.rotate_access_code($1,$2,$3,$4)',[ids.conference,'chair',ids.ga1,expiry()]),
   /Executive access required/i
  );
  await assert.rejects(()=>query('select * from private.access_credentials'),/permission denied/i);
 }finally{await db.close();}
});
