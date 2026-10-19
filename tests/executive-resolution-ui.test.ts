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
import {grantAccess} from '../lib/access';
import {createSeed} from '../lib/seed';
import type {ConferenceData,Role} from '../lib/domain';

async function render(t:test.TestContext,data:ConferenceData,role:Role='admin'){
 const require=createRequire(import.meta.url),previous=require.extensions['.css'];
 require.extensions['.css']=module=>{module.exports={};};
 const {default:Page}=await import('../app/[[...route]]/page');
 if(previous)require.extensions['.css']=previous;else delete require.extensions['.css'];
 t.mock.method(React,'useSyncExternalStore',((_s:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 t.mock.method(React,'useEffect',()=>{});
 t.mock.method(repository,'getSnapshot',()=>data);
 t.mock.method(repository,'getAccess',()=>grantAccess([{role,committee_id:role==='chair'?'ga1':null,expires_at:new Date(Date.now()+3600000).toISOString()}],'staff-device'));
 const router={bfcacheId:'test',back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){}};
 const page=await Page({params:Promise.resolve({route:['admin','resolution-status']})});
 return renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(PathnameContext.Provider,{value:'/admin/resolution-status'},createElement(ConferenceProvider,null,page))));
}

test('Executive route shows all committees, safe Doc links and full feedback with history disclosed; no mutation controls',async t=>{
 const data=createSeed();
 const doc=data.documents[0];
 doc.comments=[{id:'feedback',text:'Add a funding source and clarify clause 2. This full comment must be visible.',authorId:'reviewer',createdAt:'2026-10-19T06:00:00Z'}];
 data.resolutionLinks=[{documentId:doc.id,workingDocId:'a'.repeat(30),approvalCopyDocId:'b'.repeat(30),access:'problem',submittedAt:null,revision:1}];
 const html=await render(t,data);
 for(const c of data.committees)assert.ok(html.includes(c.name.replaceAll("&", "&amp;")),c.name);
 assert.match(html,/No resolutions recorded/);
 assert.ok(html.includes(doc.comments[0].text));
 assert.match(html,/<details><summary>Approval history<\/summary>/);
 assert.ok(html.includes(`https://docs.google.com/document/d/${'a'.repeat(30)}/edit`));
 assert.match(html,/Chair can&#x27;t access document/);
 assert.doesNotMatch(html,/Submit for review|Fix and resubmit|Mark printed|Link working document|Open debate/);
 assert.match(html,/Find a resolution/);
});

test('Chair-only grants cannot render the Executive resolution overview',async t=>{
 const html=await render(t,createSeed(),'chair');
 assert.match(html,/Opening your authorized workspace/);
 assert.doesNotMatch(html,/Find a resolution|Latest Approval Panel feedback|No resolutions recorded/);
});
