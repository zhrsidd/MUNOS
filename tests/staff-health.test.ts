import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {ConferenceProvider} from '../lib/context';
import {SystemHealth} from '../components/health';
import {repository} from '../lib/repository';
import {grantAccess,staffRoleForPath,staffRolePath} from '../lib/access';
import {createSeed} from '../lib/seed';
import {applyCommand} from '../lib/commands';
import type {Role} from '../lib/domain';
import {DurableRepository,ConflictError,type Transport} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';

const roles:Role[]=['chair','approval','logistics','admin'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));

test('each active staff role renders its own health route/navigation and rejects other role prefixes',async t=>{
 const require=createRequire(import.meta.url),cssLoader=require.extensions['.css'];
 // Node does not load CSS modules; styles do not participate in this rendering assertion.
 require.extensions['.css']=module=>{module.exports={};};
 const {default:Page,generateStaticParams}=await import('../app/[[...route]]/page');
 if(cssLoader)require.extensions['.css']=cssLoader;else delete require.extensions['.css'];
 const data=createSeed();let activeRole:Role='chair';
 const effects:(()=>void|(()=>void))[]=[],redirects:string[]=[];
 // SSR uses the same active repository snapshots as a hydrated prepared staff device.
 t.mock.method(React,'useSyncExternalStore',((_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 t.mock.method(React,'useEffect',(effect:()=>void|(()=>void))=>{effects.push(effect);});
 t.mock.method(repository,'getSnapshot',()=>data);
 t.mock.method(repository,'getAccess',()=>grantAccess([{role:activeRole,committee_id:activeRole==='chair'?'ga1':null,expires_at:new Date(Date.now()+3600000).toISOString()}],'staff-device'));
 const router={bfcacheId:"test",back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(path:string){redirects.push(path);},prefetch(){}};
 const render=async(path:string)=>{
  effects.length=0;redirects.length=0;
  const page=await Page({params:Promise.resolve({route:path.slice(1).split('/')})});
  const html=renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:router},createElement(PathnameContext.Provider,{value:path},createElement(ConferenceProvider,null,page))));
  effects[0](); // Existing provider's authorization redirect effect; no repository initialization.
  return html;
 };
 for(const role of roles){
  activeRole=role;const path=`/${role}/health`;
  assert.ok(generateStaticParams().some(p=>'/'+p.route.join('/')===path));
  assert.equal(staffRoleForPath(path),role);
  const html=await render(path);
  assert.match(html,/<h1>System health<\/h1>/);assert.match(html,/STAFF · SYSTEM HEALTH/);
  assert.match(html,new RegExp(`class="active" href="${path}"`));
  assert.match(html,/sync-status/,'compact sidebar status remains');
  assert.doesNotMatch(html,/class="session-selector"|class="status-strip/);
  if(role!=='admin')assert.doesNotMatch(html,/href="\/admin(?:\/|\")/,'no Executive navigation');
  assert.deepEqual(redirects,[]);
  for(const forbiddenRole of roles.filter(other=>other!==role)){
   const denied=await render(`/${forbiddenRole}/health`);
   assert.match(denied,/Opening your authorized workspace/);assert.doesNotMatch(denied,/<h1>System health/);
   assert.deepEqual(redirects,[staffRolePath(role)]);
  }
 }
});

test('Chair health requires export before conflict dismissal and retains/resumes later queued work',async t=>{
 const store=new DurableStore('health-recovery-'+crypto.randomUUID());let data=createSeed(),online=false;
 const sent:string[]=[];
 const transport:Transport={actorId:'chair-only',read:async()=>{if(!online)throw Error('Offline');return data;},send:async m=>{
  if(!online)throw Error('Offline');
  if(m.command.type==='attendance')throw new ConflictError('PT409: Another Chair updated attendance');
  data=applyCommand(data,m.command,m.role,m);sent.push(m.id);
 }};
 const repo=new DurableRepository('chair-device',()=>data,store,transport);await repo.ready();await tick();
 const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 try{
  await repo.execute({type:'attendance',sessionId:'s1',delegateId:'d0',status:'Absent'},'chair');
  await repo.execute({type:'participation',sessionId:'s1',delegateId:'d0',resolutionId:'r1',categoryId:'speech',points:2},'chair');
  await tick();online=true;await repo.flush();assert.equal(repo.getHealth().conflicts,1);
  const [conflict,later]=repo.getPending();assert.equal(later.state,'pending');assert.deepEqual(sent,[]);
  t.mock.method(repository,'getHealth',()=>repo.getHealth());t.mock.method(repository,'getPending',()=>repo.getPending());
  t.mock.method(repository,'exportRecovery',()=>repo.exportRecovery());
  const dismissed:string[]=[];t.mock.method(repository,'resolveConflict',(id:string)=>{dismissed.push(id);return repo.resolveConflict(id);});
  t.mock.method(React,'useSyncExternalStore',((_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
  t.mock.method(React,'useEffect',()=>{});
  // Drive the unchanged component's handlers with persistent hook state, without adding a DOM dependency.
  const states:unknown[]=[];let cursor=0;
  t.mock.method(React,'useState',((initial:unknown)=>{
   const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
   return[states[i],(next:unknown)=>{states[i]=typeof next==='function'?next(states[i]):next;}];
  }) as typeof React.useState);
  let downloaded:Blob|undefined,clicks=0;
  t.mock.method(URL,'createObjectURL',(blob:Blob)=>{downloaded=blob;return'blob:test-recovery';});t.mock.method(URL,'revokeObjectURL',()=>{});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({click(){clicks++;}})}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true,removeEventListener(){}}});
  type ButtonProps={children?:React.ReactNode;disabled?:boolean;onClick:()=>void};
  const buttons=(node:React.ReactNode):React.ReactElement<ButtonProps>[]=>{
   if(Array.isArray(node))return node.flatMap(buttons);
   if(!React.isValidElement<{children?:React.ReactNode}>(node))return[];
   return node.type==='button'?[node as React.ReactElement<ButtonProps>]:buttons(node.props.children);
  };
  const view=()=>{cursor=0;return buttons(SystemHealth());};
  const dismiss=()=>view().find(b=>String(b.props.children).includes('dismiss exported action'))!;
  assert.equal(dismiss().props.disabled,true);assert.deepEqual(dismissed,[]);
  view().find(b=>b.props.children==='Export device recovery file')!.props.onClick();await tick();
  assert.equal(clicks,1);assert.ok(downloaded);
  const recovery=JSON.parse(await downloaded.text());assert.deepEqual(recovery.pending.map((m:{id:string})=>m.id),[conflict.id,later.id]);
  assert.equal(dismiss().props.disabled,false);
  online=false;dismiss().props.onClick();await tick();
  assert.deepEqual(dismissed,[conflict.id]);assert.deepEqual(repo.getPending().map(m=>m.id),[later.id]);
  assert.deepEqual((await store.read('chair-device'))!.pending.map(m=>m.id),[later.id],'later work remains durable');
  online=true;await repo.flush();assert.deepEqual(sent,[later.id]);assert.equal(repo.getPending().length,0);
 }finally{
  if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else Reflect.deleteProperty(globalThis,'document');
  if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else Reflect.deleteProperty(globalThis,'window');
  repo.dispose();await store.close();
 }
});
