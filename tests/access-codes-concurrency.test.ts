import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {asUser,literal,realDatabase,waitForLock} from './helpers/postgres';

const localUrl=process.env.TEST_POSTGRES_URL;
type Credential={id:string;code:string};
type Redemption={status:'ok'|'invalid'};

// PGlite tests cover policy/validation. These tests require real independent server transactions.
// CI always supplies a disposable PostgreSQL 17 service; local runs may opt in with a loopback URL.
test('PostgreSQL 17 credential concurrency', {skip:!localUrl,timeout:60000},async t=>{
 const db=await realDatabase(localUrl!);
 const {owner,ids,connect,name}=db;
 const admin=randomUUID();
 const conf=literal(ids.conference);
 const rotate=(role:string,committee:string|null)=>`select public.rotate_access_code(${conf},${literal(role)},${committee?literal(committee):'null'},now()+interval '1 day');`;
 const redeem=(code:string)=>`select public.redeem_access_code(${conf},${literal(code)});`;
 const revoke=(credential:string)=>`select public.revoke_access_code(${conf},${literal(credential)},true);`;
 const adminConnection=async(label:string)=>{const c=connect(label);await asUser(c,admin);return c;};
 const deviceConnection=async(label:string)=>{
  const id=randomUUID();await owner.query(`insert into auth.users values(${literal(id)});`);
  const connection=connect(label);await asUser(connection,id);return {id,connection};
 };
 const activeGrants=(id:string)=>owner.query(`select count(*) from public.user_access where user_id=${literal(id)} and revoked_at is null;`);
 try{
  await owner.query(`insert into auth.users values(${literal(admin)});
   insert into public.user_access(conference_id,user_id,role,expires_at) values(${conf},${literal(admin)},'admin',now()+interval '1 day');`);

  await t.test('concurrent first rotations serialize and leave one NULL-scoped active credential',async()=>{
   const first=await adminConnection('rotate_first');const second=await adminConnection('rotate_second');
   await first.query('begin;');
   const old=await first.json<Credential>(rotate('approval',null));
   const waiting=second.json<Credential>(rotate('approval',null));
   await waitForLock(owner,`${name}_rotate_second`);
   await first.query('commit;');const current=await waiting;
   assert.notEqual(current.id,old.id);
   assert.equal(await owner.query(`select count(*) from private.access_credentials where conference_id=${conf} and role='approval' and committee_id is null and revoked_at is null;`),'1');
   const device=await deviceConnection('rotated_device');
   assert.equal((await device.connection.json<Redemption>(redeem(old.code))).status,'invalid');
   assert.equal((await device.connection.json<Redemption>(redeem(current.code))).status,'ok');
  });

  await t.test('direct inserts cannot bypass active credential uniqueness with NULL committee',async()=>{
   const result=await owner.query(`do $$begin
    begin
     insert into private.access_credentials(conference_id,role,credential_hash,expires_at)
     values(${conf},'approval',repeat('b',64),now()+interval '1 day');
     raise exception 'duplicate active NULL scope was accepted';
    exception when unique_violation then null; end;
   end$$;select 'unique';`);
   assert.equal(result,'unique');
  });

  await t.test('different Chair committee scopes do not block each other',async()=>{
   const ga1=await adminConnection('chair_ga1');const who=await adminConnection('chair_who');
   await ga1.query('begin;');
   await ga1.json<Credential>(rotate('chair',ids.ga1));
   await who.query("set statement_timeout='2s';");
   await who.json<Credential>(rotate('chair',ids.who));
   await ga1.query('commit;');
   assert.equal(await owner.query(`select count(*) from private.access_credentials where conference_id=${conf} and role='chair' and revoked_at is null;`),'2');
  });

  for(const winningAction of ['revoke','rotate'] as const){
   await t.test(`${winningAction} wins its credential lock: waiting old-code redemption fails`,async()=>{
    const executive=await adminConnection(`${winningAction}_wins`);
    const credential=await executive.json<Credential>(rotate('logistics',null));
    const device=await deviceConnection(`redeem_after_${winningAction}`);
    await executive.query('begin;');
    await executive.query(winningAction==='revoke'?revoke(credential.id):rotate('logistics',null));
    const waiting=device.connection.json<Redemption>(redeem(credential.code));
    await waitForLock(owner,`${name}_redeem_after_${winningAction}`);
    await executive.query('commit;');
    assert.equal((await waiting).status,'invalid');
    assert.equal(await activeGrants(device.id),'0');
   });
  }

  await t.test('redemption wins: revoke waits, observes its committed grant and revokes it',async()=>{
   const executive=await adminConnection('revoke_waits');
   const credential=await executive.json<Credential>(rotate('logistics',null));
   const device=await deviceConnection('redeem_wins');
   await device.connection.query('begin;');
   assert.equal((await device.connection.json<Redemption>(redeem(credential.code))).status,'ok');
   const waiting=executive.json<{revokedDevices:number}>(revoke(credential.id));
   await waitForLock(owner,`${name}_revoke_waits`);
   await device.connection.query('commit;');
   assert.equal((await waiting).revokedDevices,1);
   assert.equal(await activeGrants(device.id),'0');
   assert.equal((await executive.json<{revokedDevices:number}>(revoke(credential.id))).revokedDevices,0,'revoke is idempotent');
  });

  await t.test('redemption wins: rotation waits; existing device remains, old code cannot authorize another',async()=>{
   const executive=await adminConnection('rotate_waits');
   const credential=await executive.json<Credential>(rotate('logistics',null));
   const device=await deviceConnection('redeem_before_rotate');
   await device.connection.query('begin;');
   assert.equal((await device.connection.json<Redemption>(redeem(credential.code))).status,'ok');
   const waiting=executive.json<Credential>(rotate('logistics',null));
   await waitForLock(owner,`${name}_rotate_waits`);
   await device.connection.query('commit;');await waiting;
   assert.equal(await activeGrants(device.id),'1','routine rotation preserves already-authorized devices');
   const newcomer=await deviceConnection('after_rotate');
   assert.equal((await newcomer.connection.json<Redemption>(redeem(credential.code))).status,'invalid');
   assert.equal(await activeGrants(newcomer.id),'0');
  });
 }finally{await db.close();}
});
