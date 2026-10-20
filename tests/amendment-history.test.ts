import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {freshDatabase} from './helpers/database';
import {fingerprint} from '../lib/sync/repository';
import type {Command} from '../lib/commands';
import type {ConferenceData,Delegate,Resolution} from '../lib/domain';
import type {Amendment} from '../lib/batch/types';
import {PASSED_HISTORY_PAGE,amendmentCopyText,groupByResolution,loadPassedPage,mergePassed} from '../lib/amendments/history';

const amendment=(id:string,over:Partial<Amendment>={}):Amendment=>({id,committeeId:'ga1',resolutionId:'r1',sessionId:'s1',submitterId:'d1',type:'Add',clause:'Clause 1',wording:'Exact wording',status:'Closed',outcome:'Passed',createdAt:'2026-11-05T09:00:00.000Z',revision:3,...over});
const resolution=(id:string,code:string):Resolution=>({id,committeeId:'ga1',sessionId:'s1',code,title:`${code} title`,submitterId:'d1',status:'Closed',versionIds:[],copies:1,comments:[]});

test('merge keeps only this committee\'s passed amendments, once each, newest revision winning',()=>{
 const current=[amendment('a',{revision:2,wording:'old'}),amendment('b',{status:'In Debate',outcome:null}),amendment('c',{outcome:'Failed'}),amendment('x',{committeeId:'sc'})];
 const fetched=[amendment('a',{revision:3,wording:'new'}),amendment('d',{createdAt:'2026-11-05T10:00:00.000Z'})];
 const merged=mergePassed('ga1',current,fetched);
 assert.deepEqual(merged.map(a=>a.id),['d','a'],'newest first; Failed, open and other-committee amendments excluded');
 assert.equal(merged.find(a=>a.id==='a')!.wording,'new');
});

test('grouped by original resolution, most recently amended first, amendments in submission order; unknown resolution kept',()=>{
 const list=[amendment('1',{resolutionId:'r1',createdAt:'2026-11-05T09:00:00.000Z'}),amendment('2',{resolutionId:'r2',createdAt:'2026-11-05T11:00:00.000Z'}),amendment('3',{resolutionId:'r1',createdAt:'2026-11-05T10:00:00.000Z'}),amendment('4',{resolutionId:'gone'})];
 const groups=groupByResolution(list,[resolution('r1','GA1 / 01'),resolution('r2','GA1 / 02')]);
 assert.deepEqual(groups.map(g=>g.resolutionId),['r2','r1','gone']);
 assert.deepEqual(groups[1].amendments.map(a=>a.id),['1','3']);
 assert.equal(groups[1].resolution?.code,'GA1 / 01');assert.equal(groups[2].resolution,null);
});

test('copy text carries the type, clause, delegation and the wording unchanged',()=>{
 const wording='Strike "all"\nand insert:\n  (a) “quoted” text';
 const delegate={id:'d1',committeeId:'ga1',schoolId:'s',country:'France',flag:'🇫🇷',name:'n',email:'e'} as Delegate;
 assert.equal(amendmentCopyText(amendment('a',{type:'Replace',clause:'Operative 3',wording}),delegate),`Replace · Operative 3 · France\n${wording}`);
 assert.equal(amendmentCopyText(amendment('a',{wording}),undefined),`Add · Clause 1\n${wording}`);
});

test('history page query: scoped, passed only, newest first, bounded, keyset cursor quoted',async()=>{
 const calls:[string,unknown[]][]=[];
 const rows=Array.from({length:PASSED_HISTORY_PAGE},(_,i)=>({id:`id${String(i).padStart(3,'0')}`,committee_id:'ga1',resolutionId:'r1',sessionId:'s1',submitterId:'d1',type:'Add',clause:'c',wording:'w',status:'Closed',outcome:'Passed',createdAt:`2026-11-05T09:${String(59-i).padStart(2,'0')}:00+00:00`,revision:1}));
 const builder:Record<string,unknown>={};
 for(const m of ['select','eq','order','limit','or'])builder[m]=(...args:unknown[])=>{calls.push([m,args]);return builder;};
 builder.then=(resolve:(v:unknown)=>void)=>resolve({data:rows,error:null});
 const client={from:(table:string)=>{calls.push(['from',[table]]);return builder;}} as unknown as SupabaseClient;
 const first=await loadPassedPage(client,'conf','ga1',null);
 assert.deepEqual(calls.filter(c=>c[0]==='eq').map(c=>c[1]),[['conference_id','conf'],['committee_id','ga1'],['status','Closed'],['outcome','Passed']]);
 assert.deepEqual(calls.filter(c=>c[0]==='limit').map(c=>c[1]),[[PASSED_HISTORY_PAGE]]);
 assert.ok(!calls.some(c=>c[0]==='or'),'first page has no cursor');
 assert.deepEqual(first.next,{createdAt:rows.at(-1)!.createdAt,id:rows.at(-1)!.id},'a full page offers an older page');
 calls.length=0;await loadPassedPage(client,'conf','ga1',first.next);
 assert.deepEqual(calls.find(c=>c[0]==='or')![1],[`createdAt.lt."${first.next!.createdAt}",and(createdAt.eq."${first.next!.createdAt}",id.lt.${first.next!.id})`]);
 builder.then=(resolve:(v:unknown)=>void)=>resolve({data:rows.slice(0,3),error:null});
 assert.equal((await loadPassedPage(client,'conf','ga1',null)).next,null,'a short page is the last');
 builder.then=(resolve:(v:unknown)=>void)=>resolve({data:null,error:{code:'42501'}});
 await assert.rejects(()=>loadPassedPage(client,'conf','ga1',null),'errors surface instead of an empty history');
});

const admin='76000000-0000-4000-8000-000000000001',chair='76000000-0000-4000-8000-000000000002',other='76000000-0000-4000-8000-000000000003';
test('PostgreSQL: a passed amendment stays readable by its committee Chair and the Executive after the resolution closes; never by another committee',async()=>{
 const f=await freshDatabase();try{
  await f.grant(admin,'admin');await f.grant(chair,'chair',f.ids.ga1);await f.grant(other,'chair',f.ids.sc);
  const snapshot=async()=>(await f.query<{s:ConferenceData}>('select public.conference_state_snapshot($1) s',[f.ids.conference]))[0].s;
  const mutate=async(c:Command,role:string)=>f.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[f.ids.conference,crypto.randomUUID(),c,role,fingerprint(await snapshot(),c),new Date().toISOString()]);
  await f.as(admin);const data=await snapshot();const session=data.sessions.find(s=>s.committeeId===f.ids.ga1)!;const delegate=data.delegates.find(d=>d.committeeId===f.ids.ga1)!;
  const doc=data.documents.find(d=>d.committeeId===f.ids.ga1&&d.status==='In Debate')!;
  await f.asOwner();await f.query(`update public.documents set status='In Debate',"sessionId"=$2 where id=$1`,[doc.id,session.id]);await f.query('update public.committees set "currentSessionId"=$2 where id=$1',[f.ids.ga1,session.id]);
  await f.as(admin);const token='history_token_12345678901234567890';await mutate({type:'amendmentLink',action:'create',committeeId:f.ids.ga1,token},'admin');
  await f.asServer();const id=crypto.randomUUID();
  await f.query('select public.submit_amendment($1,$2,$3,$4,$5,$6,$7)',[token,id,delegate.id,doc.id,'Replace','Operative 2','Exact passed wording']);
  await f.as(chair);for(const status of ['Accepted for Debate','In Debate'])await mutate({type:'amendmentStatus',id,status} as Command,'chair');
  await mutate({type:'amendmentStatus',id,status:'Closed',outcome:'Passed'},'chair');
  await f.asOwner();await f.query(`update public.documents set status='Closed',outcome='Passed' where id=$1`,[doc.id]);
  // The same filter, order and bound as loadPassedPage.
  const history=`select id,"resolutionId",type,clause,wording from public.amendments where conference_id=$1 and committee_id=$2 and status='Closed' and outcome='Passed' order by "createdAt" desc,id desc limit ${PASSED_HISTORY_PAGE}`;
  await f.as(chair);assert.deepEqual((await snapshot()).amendments,[],'the snapshot no longer carries it once the resolution closed');
  assert.deepEqual(await f.query(history,[f.ids.conference,f.ids.ga1]),[{id,resolutionId:doc.id,type:'Replace',clause:'Operative 2',wording:'Exact passed wording'}],'history still has it, exactly');
  await f.as(admin);assert.equal((await f.query(history,[f.ids.conference,f.ids.ga1])).length,1,'Executive');
  await f.as(other);assert.equal((await f.query(history,[f.ids.conference,f.ids.ga1])).length,0,'another committee\'s Chair sees nothing');
 }finally{await f.db.close();}
});
