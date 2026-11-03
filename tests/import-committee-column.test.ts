import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDatabase} from './helpers/database';
import {applyCommand,type Command} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {matchCommittee,parseCSV,validateImport} from '../lib/import';
import {fingerprint} from '../lib/sync/repository';
import type {ConferenceData} from '../lib/domain';

const committees=[{id:'ga1',code:'GA1',name:'Disarmament & International Security'},{id:'sc',code:'SC',name:'Security Council'},{id:'old',code:'OLD',name:'Archived Committee',archived:true}];

test('committee cells match by code or name, ignoring case and spacing; archived committees never match',()=>{
 assert.equal(matchCommittee(' ga1 ',committees)?.id,'ga1');
 assert.equal(matchCommittee('security   council',committees)?.id,'sc');
 assert.equal(matchCommittee('OLD',committees),undefined);
 assert.equal(matchCommittee('',committees),undefined);
});

test('a committee column assigns each row; unknown or blank committees are row errors',()=>{
 const rows=parseCSV('Name,Country,Email,Committee\nA,Italy,a@x.org,GA1\nB,Japan,b@x.org,Security Council\nC,Peru,c@x.org,WHO\nD,Chile,d@x.org,\nE,Kenya,e@x.org,old');
 const checked=validateImport(rows.slice(1),{name:0,country:1,email:2,committee:3},[],{committees});
 assert.deepEqual(checked.map(r=>r.committeeId),['ga1','sc','','','']);
 assert.deepEqual(checked.map(r=>r.errors),[[],[],['Unknown committee "WHO"'],['Committee is required'],['Unknown committee "old"']]);
});

test('without a committee column every row gets the chosen committee, and email is still required',()=>{
 const checked=validateImport([['A','Italy','a@example.com'],['B','Japan','']],{name:0,country:1,email:2,committee:-1},[],{committees,committeeId:'sc'});
 assert.deepEqual(checked.map(r=>r.committeeId),['sc','sc']);
 assert.deepEqual(checked.map(r=>r.errors),[[],['Valid email required']]);
});

test('local import places delegates in their own committees with the selected school',()=>{
 let d=createSeed();
 const [c1,c2]=d.committees.filter(c=>!c.archived),school=d.schools[0];
 const rows=validateImport([['A','Italy','csv-a@example.com',c1.code],['B','Japan','csv-b@example.com',c2.name]],{name:0,country:1,email:2,committee:3},d.delegates.map(x=>x.email),{committees:d.committees});
 assert.deepEqual(rows.map(r=>r.errors),[[],[]]);
 d=applyCommand(d,{type:'import',rows:rows.map(r=>({name:r.name,country:r.country,flag:r.flag,email:r.email,committeeId:r.committeeId,schoolId:school.id}))},'admin');
 assert.deepEqual(d.delegates.slice(-2).map(x=>[x.name,x.committeeId,x.schoolId]),[['A',c1.id,school.id],['B',c2.id,school.id]]);
});

test('PostgreSQL: one import batch places rows in different committees',async()=>{
 const {db,ids,as,grant,query}=await freshDatabase();
 const executive='78000000-0000-4000-8000-000000000001';
 try{
  await grant(executive,'admin');await as(executive);
  const snap=async()=>(await query<{s:ConferenceData}>('select public.conference_state_snapshot($1) s',[ids.conference]))[0].s;
  const s=await snap(),school=s.schools[0];
  const rows=validateImport([['Mixed A','Italy','mixed-a@example.com','GA1'],['Mixed B','Japan','mixed-b@example.com','Security Council']],{name:0,country:1,email:2,committee:3},s.delegates.map(x=>x.email),{committees:s.committees});
  assert.deepEqual(rows.map(r=>r.errors),[[],[]]);
  const command:Command={type:'import',rows:rows.map(r=>({name:r.name,country:r.country,flag:r.flag,email:r.email,committeeId:r.committeeId,schoolId:school.id}))};
  await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,crypto.randomUUID(),JSON.stringify(command),'admin',fingerprint(s,command),new Date().toISOString()]);
  const after=(await snap()).delegates.filter(x=>x.name.startsWith('Mixed '));
  assert.deepEqual(after.map(x=>[x.name,x.committeeId,x.schoolId]).sort(),[['Mixed A',ids.ga1,school.id],['Mixed B',ids.sc,school.id]]);
 }finally{await db.close();}
});
