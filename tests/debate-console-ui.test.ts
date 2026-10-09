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
import type {ConferenceData} from '../lib/domain';

// Renders the real /chair route (Workspace → Chair Debate) for a Chair of one committee.
async function renderChair(t:test.TestContext,data:ConferenceData,committee='ga1'){
 const require=createRequire(import.meta.url),cssLoader=require.extensions['.css'];
 require.extensions['.css']=module=>{module.exports={};};
 const {default:Page}=await import('../app/[[...route]]/page');
 if(cssLoader)require.extensions['.css']=cssLoader;else delete require.extensions['.css'];
 t.mock.method(React,'useSyncExternalStore',((_s:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 t.mock.method(React,'useEffect',()=>{});
 t.mock.method(repository,'getSnapshot',()=>data);
 t.mock.method(repository,'getAccess',()=>grantAccess([{role:'chair',committee_id:committee,expires_at:new Date(Date.now()+3600000).toISOString()}],'staff-device'));
 const router={bfcacheId:'test',back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){}};
 const page=await Page({params:Promise.resolve({route:['chair']})});
 return renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(PathnameContext.Provider,{value:'/chair'},createElement(ConferenceProvider,null,page))));
}
const seed=()=>{const d=createSeed();d.committees.find(c=>c.id==='ga1')!.currentSessionId='s1';return d;};
const text=(html:string)=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/\s+/g,' ');
function photoSlot(d:ConferenceData,startsInMinutes:number){
 d.photoSlots=[{id:'ph1',schoolId:'school0',startsAt:new Date(Date.now()+startsInMinutes*60000).toISOString(),endsAt:null,location:'Main Courtyard',note:'',warnMinutes:10,enabled:true,revision:1} as NonNullable<ConferenceData['photoSlots']>[number]];
 d.photoAcks=[];return d;
}

test('Chair Debate: prominent group-photo alert only for committees with that school’s delegates',async t=>{
 const html=text(await renderChair(t,photoSlot(createSeed(),8)));
 assert.match(html,/GROUP PHOTO IN 8 MINUTES/);
 for(const s of ['Main Courtyard','France','Kenya','Acknowledge'])assert.ok(html.includes(s),s);
 assert.ok((await renderChair(t,photoSlot(createSeed(),8))).includes('photo-banner prominent'),'Debate uses the prominent alert');
 const now=text(await renderChair(t,photoSlot(createSeed(),-1)));
 assert.match(now,/GROUP PHOTO NOW/);assert.match(now,/Delegates sent/);
 const sc=text(await renderChair(t,photoSlot(createSeed(),8),'sc'));
 assert.doesNotMatch(sc,/GROUP PHOTO/,'SC has no delegates from this school');
});

test('Chair Debate: one Next speaker action, configured speech values, no per-row Recognize',async t=>{
 const d=seed();d.scoring=[{id:'speech',label:'Speech',values:[2,4]},{id:'poi',label:'POI',values:[1,3]}];
 const raw=await renderChair(t,d),html=text(raw);
 assert.match(html,/RESOLUTION IN DEBATE/);
 assert.match(html,/Next speaker · France/,'position 1 of the open queue');
 assert.doesNotMatch(raw,/>Recognize[^<]*<\/button>/,'no per-row Recognize buttons');
 assert.equal((raw.match(/Next speaker ·/g)??[]).length,1,'exactly one Next speaker action');
 const active=seed();active.scoring=d.scoring;
 active.speeches=[{id:'sp1',sessionId:'s1',delegateId:'d1',resolutionId:'r1',amendmentId:null,classification:'Other',yieldedFrom:null,state:'pois',poiLimit:null,poiCount:0,revision:2,createdAt:'2026-10-05T06:00:00.000Z'}];
 active.poiQueue=[{id:'p1',speechId:'sp1',delegateId:'d2',position:0,recognizedAt:null},{id:'p2',speechId:'sp1',delegateId:'d3',position:1,recognizedAt:null}];
 const speaking=await renderChair(t,active);
 assert.match(speaking,/aria-label="Record Japan speech for 2 points"/);assert.match(speaking,/aria-label="Record Japan speech for 4 points"/);
 assert.doesNotMatch(speaking,/speech for 3 points/,'no hardcoded speech values');
 assert.match(text(speaking),/Next POI · Brazil/);
 active.poiQueue[0].recognizedAt='2026-10-05T06:01:00.000Z';
 const poi=await renderChair(t,active);
 assert.match(text(poi),/POI · Brazil has the floor/);
 assert.match(poi,/aria-label="Record Brazil POI for 3 points"/);assert.doesNotMatch(poi,/POI for 2 points/);
 assert.doesNotMatch(text(poi),/Next POI/,'next POI blocked while one is active');
});

test('Chair Debate: amendment in debate takes over the console; passed reminder afterwards',async t=>{
 const d=seed();
 d.amendments=[{id:'am1',committeeId:'ga1',resolutionId:'r1',sessionId:'s1',submitterId:'d3',type:'Replace',clause:'Operative clause 2',wording:'Replace “working group” with “expert panel”.',status:'In Debate',outcome:null,createdAt:'2026-10-05T06:00:00.000Z',revision:3}];
 const html=text(await renderChair(t,d));
 for(const s of ['AMENDMENT IN DEBATE','Resolution debate paused · amendment has priority','GA1 / 01','Safeguarding civilians in autonomous warfare','Kenya','Replace','Operative clause 2','expert panel','Pass amendment','Fail amendment','Withdraw','Rule out'])assert.ok(html.includes(s),s);
 assert.doesNotMatch(html,/Invite Main Submitter/);
 assert.doesNotMatch(await renderChair(t,d),/<button[^>]*disabled[^>]*>Pass amendment/,'floor with the Chair: closing is available');
 d.speeches=[{id:'sp1',sessionId:'s1',delegateId:'d1',resolutionId:'r1',amendmentId:'am1',classification:'For',yieldedFrom:null,state:'pois',poiLimit:1,poiCount:0,revision:2,createdAt:'2026-10-05T06:00:00.000Z'}];
 const held=await renderChair(t,d);
 for(const label of ['Pass amendment','Fail amendment','Withdraw'])assert.match(held,new RegExp(`<button[^>]*disabled[^>]*>${label}<`),label);
 assert.match(text(held),/Finish the current speech and return the floor to the Chair first\./);
 d.speeches[0]={...d.speeches[0],state:'finished'};
 d.amendments[0]={...d.amendments[0],status:'Closed',outcome:'Passed',revision:4};
 const after=text(await renderChair(t,d));
 assert.match(after,/RESOLUTION IN DEBATE/);assert.doesNotMatch(after,/AMENDMENT IN DEBATE/);
 assert.match(after,/Apply the passed amendment to the working Google Doc\./);
 assert.doesNotMatch(after,/docs\.google\.com\/.*edit/,'no automatic Google Doc editing');
});
