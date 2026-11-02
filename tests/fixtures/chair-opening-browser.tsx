// Local-only browser fixture: real provider, RepositoryController, DurableRepository and IndexedDB.
// The harness replaces only browserClient with the in-memory backend below. No hosted connections.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {ConferenceProvider} from '../../lib/context';
import {repository} from '../../lib/repository';
import {DurableStore} from '../../lib/sync/store';
import {createSeed} from '../../lib/seed';
import type {Health} from '../../lib/sync/repository';

const params=new URLSearchParams(location.search),scenario=params.get('scenario')??'fast';
const data=createSeed();data.conference.id='opening-test';data.conference.features['committeeLoadingScreen:ga1']=scenario!=='disabled';
const actor='fixture-chair',store=new DurableStore(),key=`supabase:opening-test:${actor}`;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let loggedIn=scenario!=='login';
let reads=0;
const future=new Date(Date.now()+3600000).toISOString();
const grants=scenario==='revoked'?[]:[{role:'chair',committee_id:'ga1',expires_at:scenario==='expired'?new Date(Date.now()-1).toISOString():future},...(scenario==='multi'?[{role:'chair',committee_id:'sc',expires_at:future}]:[])];
const channel={on(){return channel;},subscribe(){return channel;}};
Object.assign(window,{
 __openingClient:{
  auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},async getSession(){return {data:{session:loggedIn?{user:{id:actor}}:null},error:null};}},
  from(){const query={select(){return query;},eq(){return query;},then(resolve:(r:unknown)=>void){return Promise.resolve({data:grants,error:null}).then(resolve);}};return query;},
  async rpc(){if(scenario==='hung-read'&&++reads>1)return new Promise(()=>{});if(scenario==='slow')await delay(1500);if(scenario==='denied')return {data:null,error:{code:'42501'}};return {data:structuredClone(data),error:null};},
  realtime:{async setAuth(){}},channel(){return channel;},async removeChannel(){},
 },
 repository,
 async fixtureLogin(){loggedIn=true;await repository.retryAccess();},
 setHealth(patch:Partial<Health>){Reflect.set(repository,'health',{...repository.getHealth(),...patch});Reflect.get(repository,'emit').call(repository);},
});
if(scenario!=='uncached')await store.update(key,()=>({key,base:data,pending:[],savedAt:new Date().toISOString()}));
await store.savePreferences('context:opening-test',{committeeId:'ga1'});
if(scenario==='cache-late'||scenario==='hung-preferences'){
 const original=DurableStore.prototype.readPreferences;
 DurableStore.prototype.readPreferences=async function(key){if(key==='context:opening-test'){if(scenario==='hung-preferences')return new Promise(()=>{});await delay(350);}return original.call(this,key);};
}
function Fixture(){
 const [path,setPath]=useState(scenario==='recovery'?'/chair/health':'/chair');
 Object.assign(window,{go:setPath});
 const router={bfcacheId:'fixture',back(){},forward(){},refresh(){},hmrRefresh(){},push:setPath,replace:setPath,prefetch(){}};
 return <AppRouterContext.Provider value={router}><PathnameContext.Provider value={path}><ConferenceProvider><h1 data-workspace>Ready Chair workspace</h1><a href="#" onClick={()=>setPath('/chair/participation')}>Participation</a></ConferenceProvider></PathnameContext.Provider></AppRouterContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
