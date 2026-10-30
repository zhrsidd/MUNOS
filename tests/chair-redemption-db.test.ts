import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

// Chair access-code edge cases beyond access-codes-db.test.ts: code formatting, expiry, repeat redemption on one
// device, the committee boundary after redemption, and the grant lapsing with the code.
const executive='77000000-0000-4000-8000-000000000001';
const chair='77000000-0000-4000-8000-000000000002';
const late='77000000-0000-4000-8000-000000000003';
const whoDelegate='ffe91baa-66a7-4ab8-ac21-474e9478d15c';
type Redemption={status:string;role?:string;committeeId?:string|null;expiresAt?:string};

test('Chair code redemption: formatting, expiry, repeat redemption, committee boundary and grant lapse',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 try{
  await grant(executive,'admin');
  await asOwner();for(const user of [chair,late])await query('insert into auth.users(id) values($1)',[user]);
  const expiresAt=new Date(Date.now()+86400000).toISOString();
  await as(executive);
  const {code,id:credential}=(await query<{r:{code:string;id:string}}>('select public.rotate_access_code($1,$2,$3,$4) r',[ids.conference,'chair',ids.ga1,expiresAt]))[0].r;
  const redeem=async(user:string,value:string)=>{await as(user);return (await query<{r:Redemption}>('select public.redeem_access_code($1,$2) r',[ids.conference,value]))[0].r;};
  const grants=async(user:string)=>{await asOwner();return query<{committee_id:string;expires_at:Date}>('select committee_id,expires_at from public.user_access where user_id=$1 and revoked_at is null',[user]);};

  // Typed in lower case with spaces instead of hyphens: the same code.
  const loose=code.toLowerCase().replaceAll('-',' ');
  const first=await redeem(chair,`  ${loose} `);
  assert.equal(first.status,'ok');assert.equal(first.committeeId,ids.ga1);
  assert.equal(new Date(first.expiresAt!).getTime(),new Date(expiresAt).getTime(),'the grant expires with the code');

  // Redeeming again on the same device refreshes one grant rather than adding another.
  assert.equal((await redeem(chair,code)).status,'ok');
  assert.equal((await grants(chair)).length,1);

  // The redeemed Chair works inside GA1 only.
  const send=async(c:unknown,expected:string)=>{await as(chair);return db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(c),'chair',expected,'2026-11-05T09:00:00Z']);};
  const rollCall=async(committeeId:string)=>{await asOwner();const ds=await query<{id:string}>('select id from public.delegates where committee_id=$1',[committeeId]);
   return {type:'rollCallCommit',committeeId,rollCallId:crypto.randomUUID(),revision:1,observedAt:'2026-11-05T08:59:00Z',committedAt:'2026-11-05T09:00:00Z',rows:ds.map(d=>({delegateId:d.id,status:d.id===ids.japan?'Absent':'Present'}))};};
  const own=await rollCall(ids.ga1);
  await send(own,'0');
  await asOwner();assert.equal((await query<{status:string}>('select status from public.roll_call_row where roll_call_id=$1 and delegate_id=$2',[own.rollCallId,ids.japan]))[0].status,'Absent');
  const whoCommittee=(await query<{c:string}>('select committee_id c from public.delegates where id=$1',[whoDelegate]))[0].c;
  const foreign=await rollCall(whoCommittee);
  await assert.rejects(async()=>send(foreign,'0'),/no access to this role or committee/,'another committee is refused');
  await as(chair);
  const snapshot=(await query<{s:{committees:{id:string}[];delegates:{committeeId:string}[]}}>('select public.conference_snapshot($1) s',[ids.conference]))[0].s;
  assert.deepEqual(snapshot.committees.map(c=>c.id),[ids.ga1]);
  assert.ok(snapshot.delegates.every(d=>d.committeeId===ids.ga1),'no other committee’s delegates are visible');

  // An expired code is refused like a wrong one and grants nothing.
  await asOwner();await query(`update private.access_credentials set expires_at=now()-interval '1 minute' where id=$1`,[credential]);
  assert.deepEqual(await redeem(late,code),{status:'invalid'});
  assert.equal((await grants(late)).length,0);

  // Once the grant lapses, the redeemed device loses access.
  await asOwner();await query(`update public.user_access set expires_at=now()-interval '1 minute' where user_id=$1`,[chair]);
  await as(chair);
  await assert.rejects(()=>query('select public.conference_snapshot($1)',[ids.conference]),/access has not been granted/i);
 }finally{await db.close();}
});
