import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{createElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {ConferenceProvider} from '../lib/context';
import {repository} from '../lib/repository';
import {grantAccess} from '../lib/access';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import type {ConferenceData,Role} from '../lib/domain';
import {createRequire} from 'node:module';
async function screens(){
 const require=createRequire(import.meta.url),previous=require.extensions['.css'];
 require.extensions['.css']=module=>{module.exports={};};
 try{return {...await import('../components/chair'),...await import('../components/admin')};}
 finally {if(previous)require.extensions['.css']=previous;else delete require.extensions['.css'];}
}

function render(t:test.TestContext,data:ConferenceData,role:Role,screen:ReactElement){
 t.mock.method(React,'useSyncExternalStore',((_s:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 t.mock.method(React,'useEffect',()=>{});
 t.mock.method(repository,'getSnapshot',()=>data);
 t.mock.method(repository,'getHealth',()=>({mode:'supabase',state:'saved',pending:1,conflicts:0,realtime:false,latency:null,message:'Waiting to send',detail:''}));
 t.mock.method(repository,'getAccess',()=>grantAccess([{role,committee_id:role==='chair'?'ga1':null,expires_at:new Date(Date.now()+3600000).toISOString()}],'actor-device'));
 const router={bfcacheId:'test',back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){}};
 return renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(PathnameContext.Provider,{value:`/${role}`},createElement(ConferenceProvider,null,screen))));
}
const recorderCells=(html:string)=>[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(match=>[...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(cell=>cell[1])).filter(cells=>cells.length===7).map(cells=>cells[4]);

test('participation recorder does not infer a name from a directory-id collision or a committee assignment',async t=>{
 const {ChairScreen}=await screens();
 const data=createSeed();
 const event=data.events[0];data.events=[{...event,chairId:'auth-actor',committeeId:'ga1'}];
 data.staff=[{id:'auth-actor',name:'Unrelated directory collision',role:'chair',committeeIds:['sc']},{id:'staff-a',name:'First assigned Chair',role:'chair',committeeIds:['ga1']},{id:'staff-b',name:'Second assigned Chair',role:'chair',committeeIds:['ga1']}];
 const html=render(t,data,'chair',createElement(ChairScreen,{section:'participation',committeeId:'ga1'}));
 assert.deepEqual(recorderCells(html),['Chair']);
 for(const name of ['Unrelated directory collision','First assigned Chair','Second assigned Chair'])assert.ok(!html.includes(name),name);
});

test('participation recorder remains truthful when the Chair cannot read the staff directory',async t=>{
 const {ChairScreen}=await screens();
 const data=createSeed();data.staff=[];data.events=[{...data.events[0],chairId:'unknown-auth-device',committeeId:'ga1'}];
 const html=render(t,data,'chair',createElement(ChairScreen,{section:'participation',committeeId:'ga1'}));
 assert.deepEqual(recorderCells(html),['Chair']);
 assert.doesNotMatch(html,/Head chair|Head Chair|Demo/);
});

test('activity wording includes a pending optimistic entry without claiming server acceptance',async t=>{
 const {AdminScreen}=await screens();
 const original=createSeed();original.audit=[];
 const data=applyCommand(original,{type:'participation',committeeId:'ga1',delegateId:'d0',resolutionId:null,categoryId:'speech',points:1},'chair',{id:'00000000-0000-4000-8000-000000000001',createdAt:new Date().toISOString(),actorId:'pending-auth-device'});
 assert.equal(data.audit[0].actorId,'pending-auth-device');
 const html=render(t,data,'admin',createElement(AdminScreen,{section:'audit'}));
 assert.match(html,/Recent conference activity\./);
 assert.match(html,/participation updated/);
 assert.match(html,/pending-auth-device/);
 assert.doesNotMatch(html,/Server-recorded|server-written|accepted by the server/i);
});
