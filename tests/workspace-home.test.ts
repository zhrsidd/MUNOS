import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {ConferenceProvider} from '../lib/context';
import {repository} from '../lib/repository';
import type {StaffAccess} from '../lib/access';
import {createSeed} from '../lib/seed';

async function render(t:test.TestContext,access:StaffAccess){
 const require=createRequire(import.meta.url),previous=require.extensions['.css'];
 require.extensions['.css']=module=>{module.exports={};};
 const {default:Page}=await import('../app/[[...route]]/page');
 if(previous)require.extensions['.css']=previous;else delete require.extensions['.css'];
 t.mock.method(React,'useSyncExternalStore',((_s:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 t.mock.method(React,'useEffect',()=>{});
 t.mock.method(repository,'getSnapshot',()=>createSeed());
 t.mock.method(repository,'getAccess',()=>access);
 const router={bfcacheId:'test',back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){}};
 const page=await Page({params:Promise.resolve({route:[]})});
 return renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(PathnameContext.Provider,{value:'/'},createElement(ConferenceProvider,null,page))));
}
const roleLinks=(html:string)=>[...html.matchAll(/<a[^>]+href="\/(chair|approval|logistics|admin)"/g)].map(m=>m[1]);

test('home demo presents four distinct whole-card destinations, an explicit demo label and one seal',async t=>{
 const html=await render(t,{status:'demo',roles:[],committeeIds:[]});
 assert.deepEqual(roleLinks(html),['chair','approval','logistics','admin']);
 for(const name of ['Chair Console','Approval Panel','Admins','Executive','Choose your workspace.','Interactive demo','Demo data'])assert.ok(html.includes(name),name);
 assert.equal((html.match(/class="brand-logo"/g)||[]).length,1);
 assert.match(html,/aria-label="Choose a workspace"/);
 assert.doesNotMatch(html,/A calmer|Development edition|All changes synced|conference is live|<button|data-testid/i);
});
test('multi-role staff see only granted workspaces and no demo or invented live-state copy',async t=>{
 const html=await render(t,{status:'active',roles:['admin','approval'],committeeIds:[],actorId:'staff'});
 assert.deepEqual(roleLinks(html),['approval','admin']);
 assert.match(html,/Only your assigned workspaces are shown/);
 assert.doesNotMatch(html,/Interactive demo|Demo data|Development edition|All changes synced/);
});
test('sole-workspace staff keep direct entry; loading access never flashes the chooser',async t=>{
 for(const access of [{status:'active',roles:['chair'],committeeIds:['ga1'],actorId:'staff'},{status:'loading',roles:[],committeeIds:[]}] as StaffAccess[]){
  const html=await render(t,access);
  assert.match(html,/Opening your workspace/);
  assert.doesNotMatch(html,/Choose your workspace|Choose a workspace/);
  assert.deepEqual(roleLinks(html),[]);
 }
});
test('signed-out and no-access states retain the access gate, without workspace choices',async t=>{
 for(const status of ['signedOut','noAccess'] as const){
  const html=await render(t,{status,roles:[],committeeIds:[]});
  assert.match(html,/Staff access code/);
  assert.deepEqual(roleLinks(html),[]);
 }
});
