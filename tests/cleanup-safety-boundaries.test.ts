import test from 'node:test';
import assert from 'node:assert/strict';
import {backends,snapshot,sqlDir} from './helpers/cleanup-backend';
import {populateSql,fixtureIds,uid} from './helpers/cleanup-fixture';
import {buildScript,connectionEnvironment} from '../scripts/cleanup/engine';

test('cleanup connection ignores every ambient libpq override for hosted and local URLs',()=>{
 const ambient={...process.env,PATH:'/usr/bin',PGHOSTADDR:'192.0.2.1',PGSERVICE:'redirect',PGSERVICEFILE:'/tmp/service',PGSYSCONFDIR:'/tmp',PGOPTIONS:'-c role=other',PGPASSFILE:'/tmp/password',PGHOST:'wrong',PGPORT:'1',PGDATABASE:'wrong',PGUSER:'wrong',PGPASSWORD:'wrong'};
 for(const [url,host,ssl] of [['postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres','db.abcdefghijklmnopqrst.supabase.co','require'],['postgresql://tester@127.0.0.1:55483/munos_test_x','127.0.0.1','prefer']]){
  const env=connectionEnvironment(url,ambient);
  assert.equal(env.PATH,ambient.PATH);assert.equal(env.PGHOST,host);assert.equal(env.PGSSLMODE,ssl);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR','PGOPTIONS','PGPASSFILE'])assert.equal(env[key],undefined,key);
 }
 assert.throws(()=>connectionEnvironment('postgresql://tester@localhost/host%3Devil'),/plain identifier/);
});

for(const [name,open,skip] of backends){
 for(const mixed of ['grant-source','amendment-receipt','external-cascade'] as const){
  test(`${name}: cleanup refuses ${mixed} before deletion`,{skip,timeout:240000},async()=>{
   const b=await open();try{
    await b.exec(populateSql('syn',{name:'LOAD TEST · safety'})+populateSql('real',{name:'DCMUN 2026'}));
    const S=fixtureIds('syn').conference,R=fixtureIds('real').conference;
    if(mixed==='grant-source')await b.exec(`update private.access_grant_sources set credential_id='${uid('syn','cred')}' where user_access_id='${uid('real','ua-chair')}';`);
    else if(mixed==='amendment-receipt')await b.exec(`update private.amendment_submissions set amendment_id='${uid('syn','amend')}' where link_id='${uid('real','amdlink')}';`);
    else await b.exec('create schema external; create table external.audit(document_id uuid references public.documents(id) on delete cascade);'+`insert into external.audit values('${uid('syn','doc')}');`);
    const before=await snapshot(b,R);
    for(const mode of ['dry-run','execute'] as const){
     const script=await buildScript(sqlDir,{mode,label:'local',ids:[S],protectedIds:[R],token:mode==='execute'?'0'.repeat(64):undefined});
     await assert.rejects(b.runner.run(script),mixed==='external-cascade'?/unreviewed incoming foreign keys/:/spans selected and retained/);
    }
    assert.deepEqual(await snapshot(b,R),before);
    assert.equal((await b.rows(`select 1 from public.conferences where id='${S}'`)).length,1);
    if(mixed==='external-cascade')assert.equal((await b.rows('select 1 from external.audit')).length,1);
   }finally{await b.close();}
  });
 }
}
