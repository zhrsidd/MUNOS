import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';

test('amendment receipts retain RLS, no browser privileges and an explicit deny policy',async()=>{
 const f=await freshDatabase();try{
  assert.equal((await f.query<{enabled:boolean}>("select relrowsecurity enabled from pg_class where oid='private.amendment_submissions'::regclass"))[0].enabled,true);
  const policies=await f.query<{policyname:string;roles:string[];cmd:string;qual:string;with_check:string}>("select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='private' and tablename='amendment_submissions'");
  assert.equal(policies.length,1);
  assert.deepEqual({...policies[0],roles:policies[0].roles.sort()},{policyname:'no_browser_access',roles:['anon','authenticated'],cmd:'ALL',qual:'false',with_check:'false'});
  for(const role of ['anon','authenticated']){
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']){
    assert.equal((await f.query<{allowed:boolean}>("select has_table_privilege($1,'private.amendment_submissions',$2) allowed",[role,privilege]))[0].allowed,false,`${role} ${privilege}`);
   }
   await f.db.exec(`set role ${role}`);
   await assert.rejects(()=>f.query('select * from private.amendment_submissions'),/permission denied/);
   await f.asOwner();
  }
 }finally{await f.db.close();}
});

test('all eight reported foreign keys have valid full indexes with matching leading key order',async()=>{
 const f=await freshDatabase();try{
  const expected:[string,string[]][]=[
   ['private.access_credentials',['created_by']],
   ['private.access_redemption_attempts',['conference_id']],
   ['public.amendment_links',['committee_id','conference_id']],
   ['public.amendments',['committee_id','conference_id']],
   ['public.amendments',['resolutionId','conference_id','committee_id']],
   ['public.amendments',['sessionId','conference_id','committee_id']],
   ['public.amendments',['submitterId','conference_id','committee_id']],
   ['public.sessions',['slotId','conference_id']],
  ];
  for(const [table,columns] of expected){
   const foreignKeys=await f.query<{columns:string[]}>(`select array(
    select a.attname::text from unnest(c.conkey) with ordinality k(attnum,position)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.position
   ) columns from pg_constraint c where c.conrelid=$1::regclass and c.contype='f'`,[table]);
   assert.ok(foreignKeys.some(fk=>JSON.stringify(fk.columns)===JSON.stringify(columns)),`Expected FK: ${table} (${columns})`);
   // Resolve real key attributes in catalog order, excluding INCLUDE attributes.
   // Names alone cannot prove coverage, validity, or absence of a partial predicate.
   const indexes=await f.query<{valid:boolean;ready:boolean;full:boolean;method:string;columns:string[]}>(`select
    i.indisvalid valid,i.indisready ready,i.indpred is null full,am.amname method,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,position)
     left join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
     where k.position<=i.indnkeyatts order by k.position) columns
    from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indrelid=$1::regclass`,[table]);
   assert.ok(indexes.some(i=>i.valid&&i.ready&&i.full&&i.method==='btree'&&columns.every((c,n)=>i.columns[n]===c)),`Missing valid FK coverage: ${table} (${columns})`);
  }
 }finally{await f.db.close();}
});

test('server-only amendment submission still creates one receipt and replays after deny-policy hardening',async()=>{
 const f=await freshDatabase();try{
  const token='hardening_amendment_1234567890',submission=crypto.randomUUID();
  // Minimal owner fixture; exercise the unchanged public RPC as the server role.
  await f.query('insert into public.amendment_links(conference_id,committee_id,token) values($1,$2,$3)',[f.ids.conference,f.ids.ga1,token]);
  await f.query('update public.committees set "currentSessionId"=(select "sessionId" from public.documents where id=$2) where id=$1',[f.ids.ga1,f.ids.resolution]);
  const submit=async()=>(await f.query<{r:{status:string;id:string}}>('select public.submit_amendment($1,$2,$3,$4,$5,$6,$7) r',[token,submission,f.ids.france,f.ids.resolution,'Add','Clause 1','Preserved server submission']))[0].r;
  for(const role of ['anon','authenticated']){
   await f.db.exec(`set role ${role}`);await assert.rejects(submit,/permission denied/);await f.asOwner();
  }
  await f.asServer();assert.deepEqual(await submit(),{status:'created',id:submission});assert.deepEqual(await submit(),{status:'replayed',id:submission});
  await f.asOwner();
  assert.equal((await f.query<{n:number}>('select count(*)::int n from public.amendments where id=$1',[submission]))[0].n,1);
  assert.deepEqual(await f.query('select id,amendment_id from private.amendment_submissions where id=$1',[submission]),[{id:submission,amendment_id:submission}]);
  assert.equal((await f.query<{n:number}>('select count(*)::int n from auth.users'))[0].n,0,'Delegate submission creates no Auth identity');
 }finally{await f.db.close();}
});
