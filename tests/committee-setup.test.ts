import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import type {Command} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {freshDatabase} from './helpers/database';

const row=(over:Record<string,string>={})=>({name:'Test Delegate',country:'Chile',email:'test.delegate@example.com',schoolId:'',committeeId:'ga1',...over});

test('committee setup (client): unique trimmed codes, sessions from the schedule, Executive only',()=>{
 const d=createSeed();
 d.sessionSlots=[
  {id:'slot-a',name:'Session 1',startsAt:'2026-11-05T04:00:00Z',endsAt:'2026-11-05T06:00:00Z',archived:false,revision:1},
  {id:'slot-b',name:'Session 2',startsAt:'2026-11-05T07:00:00Z',endsAt:null,archived:false,revision:1},
  {id:'slot-c',name:'Cancelled',startsAt:'2026-11-05T09:00:00Z',endsAt:null,archived:true,revision:2},
 ];
 assert.throws(()=>applyCommand(d,{type:'committee',code:'GA1',name:'Copy',room:'R'},'admin'),/unique committee code/);
 assert.throws(()=>applyCommand(d,{type:'committee',code:'  GA1 ',name:'Copy',room:'R'},'admin'),/unique committee code/);
 assert.throws(()=>applyCommand(d,{type:'committee',code:'   ',name:'Blank',room:'R'},'admin'),/unique committee code/);
 assert.throws(()=>applyCommand(d,{type:'committee',code:'NEW',name:'New',room:'R'},'chair'),/role boundary/);
 const after=applyCommand(d,{type:'committee',code:' NEW ',name:'New',room:'R'},'admin');
 const created=after.committees.find(c=>c.code==='NEW');
 assert.ok(created,'code is stored trimmed');
 assert.deepEqual(after.sessions.filter(s=>s.committeeId===created!.id).map(s=>[s.slotId,s.name,s.state]),[['slot-a','Session 1','scheduled'],['slot-b','Session 2','scheduled']],'one session per active schedule slot');
});

test('delegate import (client): all-or-nothing, case-insensitive duplicate emails, valid committee and school',()=>{
 const d=createSeed(),schoolId=d.schools[0].id,existing=d.delegates[0].email;
 const run=(rows:ReturnType<typeof row>[])=>applyCommand(d,{type:'import',rows} as Command,'admin');
 const ok=run([row({schoolId}),row({schoolId,email:'second@example.com',committeeId:'ecosoc'})]);
 assert.equal(ok.delegates.length,d.delegates.length+2);
 assert.equal(ok.delegates.at(-1)?.flag,'🇨🇱','flag derived from the country');
 for(const [label,rows] of [
  ['an invalid row rejects the whole import',[row({schoolId}),row({schoolId,email:'not-an-email'})]],
  ['a blank name',[row({schoolId,name:'  '})]],
  ['an existing email in another case',[row({schoolId,email:existing.toUpperCase()})]],
  ['a duplicate within the file',[row({schoolId}),row({schoolId,email:'TEST.DELEGATE@example.com'})]],
  ['an unknown committee',[row({schoolId,committeeId:'missing'})]],
  ['an unknown school',[row({schoolId:'missing'})]],
 ] as const){
  assert.throws(()=>run([...rows]),/invalid or duplicate|valid committee and school/,label);
 }
 assert.throws(()=>applyCommand(d,{type:'import',rows:[row({schoolId})]} as Command,'chair'),/role boundary/);
});

test('committee setup (PostgreSQL): unique codes, atomic import, case-insensitive emails, Executive only',async()=>{
 const {db,ids,query,as,asOwner,grant}=await freshDatabase();
 const exec='70000000-0000-4000-8000-0000000000b1',chair='70000000-0000-4000-8000-0000000000b2';
 try{
  await grant(exec,'admin');await grant(chair,'chair',ids.ga1);
  await asOwner();
  await db.query(`insert into public.conference_session_slots(conference_id,name,"startsAt","endsAt",archived) values($1,'Session 1','2026-11-05T04:00:00Z','2026-11-05T06:00:00Z',false),($1,'Session 2','2026-11-05T07:00:00Z',null,false),($1,'Cancelled','2026-11-05T09:00:00Z',null,true)`,[ids.conference]);
  const send=async(user:string,role:string,c:unknown,id:string=crypto.randomUUID())=>{await as(user);return db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[ids.conference,id,JSON.stringify(c),role,null,'2026-11-05T09:00:00Z']);};
  const count=async(sql:string,p:unknown[]=[])=>{await asOwner();return Number((await query<{n:number}>(sql,p))[0].n);};
  await assert.rejects(()=>send(exec,'admin',{type:'committee',code:' GA1 ',name:'Copy',room:'R'}),/duplicate key/,'duplicate trimmed code is refused');
  await assert.rejects(()=>send(chair,'chair',{type:'committee',code:'NEW',name:'New',room:'R'}),/not allowed|no access|permission/i,'a Chair cannot create committees');
  const mutation=crypto.randomUUID();
  await send(exec,'admin',{type:'committee',code:' NEW ',name:'New',room:'R'},mutation);
  const committeeId=mutation.slice(0,24)+'000000000001';
  assert.equal(await count('select count(*) n from public.committees where id=$1 and code=$2',[committeeId,'NEW']),1,'code is stored trimmed');
  await asOwner();
  assert.deepEqual((await query<{name:string}>('select s.name from public.sessions s join public.conference_session_slots t on t.id=s."slotId" where s.committee_id=$1 order by t."startsAt"',[committeeId])).map(r=>r.name),['Session 1','Session 2'],'one session per active schedule slot');

  await asOwner();const schoolId=(await query<{id:string}>('select id from public.schools where conference_id=$1 order by id limit 1',[ids.conference]))[0].id;
  const existing=(await query<{email:string}>('select email from public.delegates where conference_id=$1 order by id limit 1',[ids.conference]))[0].email;
  const delegates=()=>count('select count(*) n from public.delegates where conference_id=$1',[ids.conference]);
  const before=await delegates();
  const rows=(over:Record<string,string>[])=>({type:'import',rows:over.map(o=>row({schoolId,committeeId:ids.ga1,...o}))});
  for(const [label,over] of [
   ['an invalid row rejects the whole import',[{},{email:'not-an-email'}]],
   ['an existing email in another case',[{email:existing.toUpperCase()}]],
   ['a duplicate within the file',[{},{email:'TEST.DELEGATE@example.com'}]],
   ['an unknown committee',[{committeeId:'00000000-0000-4000-8000-00000000dead'}]],
   ['an unknown school',[{schoolId:'00000000-0000-4000-8000-00000000beef'}]],
  ] as const){
   await assert.rejects(()=>send(exec,'admin',rows([...over])),/Invalid imported delegate|duplicate key|foreign key/,label);
   assert.equal(await delegates(),before,`${label}: nothing imported`);
  }
  await assert.rejects(()=>send(chair,'chair',rows([{}])),/not allowed|no access|permission/i,'a Chair cannot import delegates');
  await send(exec,'admin',rows([{email:'Mixed.Case@Example.com'},{email:'second@example.com',committeeId}]));
  assert.equal(await delegates(),before+2);
  assert.equal(await count('select count(*) n from public.delegates where email=$1',['mixed.case@example.com']),1,'emails are stored lower-case');
 }finally{await db.close();}
});
