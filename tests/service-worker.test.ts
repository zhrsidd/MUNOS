import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const healthPaths=['/chair/health','/approval/health','/logistics/health','/admin/health'];
const origin='https://conference.example';
type WorkerEvent={request?:{url:string;method:string;mode:string};waitUntil?:(promise:Promise<void>)=>void;respondWith?:(promise:Promise<Response>)=>void};

async function worker(){
 const handlers=new Map<string,(event:WorkerEvent)=>void>();
 const buckets=new Map<string,Map<string,Response>>(),fetched:string[]=[];
 const replies=new Map<string,{status:number;body:string}>();
 let online=true;
 const key=(request:string|{url:string})=>new URL(typeof request==='string'?request:request.url,origin).href;
 const caches={
  open:async(name:string)=>{
   if(!buckets.has(name))buckets.set(name,new Map());
   const bucket=buckets.get(name)!;
   return{put:async(request:string|{url:string},response:Response)=>{bucket.set(key(request),response.clone());},match:async(request:string|{url:string})=>bucket.get(key(request))?.clone()};
  },
  keys:async()=>[...buckets.keys()],
  delete:async(name:string)=>buckets.delete(name),
 };
 runInNewContext(await readFile('public/sw.js','utf8'),{
  URL,Response,caches,
  self:{location:{origin},clients:{claim:async()=>{}},addEventListener:(name:string,handler:(event:WorkerEvent)=>void)=>handlers.set(name,handler)},
  fetch:async(request:string|{url:string})=>{
   if(!online)throw Error('Offline');
   const url=key(request);fetched.push(url);
   const reply=replies.get(new URL(url).pathname);
   if(reply)return new Response(reply.body,{status:reply.status,headers:{'content-type':'text/html'}});
   return new Response(`<h1>Prepared ${new URL(url).pathname}</h1>`,{headers:{'content-type':'text/html'}});
  },
 });
 const lifecycle=async(name:string)=>{
  let completion:Promise<void>|undefined;
  handlers.get(name)!({waitUntil:promise=>{completion=promise;}});
  assert.ok(completion);await completion;
 };
 const navigate=(path:string,method='GET',mode='navigate')=>{
  let response:Promise<Response>|undefined;
  handlers.get('fetch')!({request:{url:key(path),method,mode},respondWith:promise=>{response=promise;}});
  return response;
 };
 const cached=async(path:string)=>(await (await caches.open('conference-os-0.2.4')).match(path))?.text();
 return{caches,fetched,lifecycle,navigate,cached,offline:()=>{online=false;},reply:(path:string,status:number,body:string)=>replies.set(path,{status,body})};
}

test('offline shell installs all staff health routes without API, Supabase or Auth URLs',async()=>{
 const w=await worker();await w.lifecycle('install');
 const paths=w.fetched.map(url=>new URL(url).pathname);
 for(const path of healthPaths)assert.ok(paths.includes(path),`${path} must be prepared by installation`);
 for(const url of w.fetched){
  const parsed=new URL(url);assert.equal(parsed.origin,origin);
  assert.doesNotMatch(parsed.pathname,/^\/(?:api|auth|rest|storage|realtime)(?:\/|$)|supabase/i);
 }
});

test('prepared staff health routes directly reload offline and activation replaces the previous cache',async()=>{
 const w=await worker();await w.caches.open('conference-os-0.2.2');await w.caches.open('unrelated-cache');
 await w.lifecycle('install');await w.lifecycle('activate');
 assert.deepEqual(await w.caches.keys(),['unrelated-cache','conference-os-0.2.4']);
 w.offline();
 for(const path of healthPaths){
  const response=await w.navigate(path);assert.ok(response,`${path} navigation must be intercepted`);
  assert.equal(response.status,200);assert.equal(await response.text(),`<h1>Prepared ${path}</h1>`);
 }
});

test('service worker still ignores APIs, authentication, Supabase and non-GET requests',async()=>{
 const w=await worker();await w.lifecycle('install');w.offline();
 for(const path of ['/api/health','/api/submissions','/api/amendments','/auth/v1/token','/rest/v1/documents','https://example.supabase.co/auth/v1/token','https://example.supabase.co/rest/v1/documents']){
  assert.equal(w.navigate(path),undefined,`${path} must bypass the shell cache`);
 }
 assert.equal(w.navigate('/chair/health','POST'),undefined);
 assert.equal(w.navigate('/chair/health','GET','cors'),undefined,'only document navigation uses the health shell');
});

test('staff shell navigation: 200 is served from the network and refreshes the cached copy',async()=>{
 const w=await worker();await w.lifecycle('install');
 w.reply('/chair',200,'<h1>Newer chair</h1>');
 const response=await w.navigate('/chair');assert.ok(response);
 assert.equal(response.status,200);assert.equal(await response.text(),'<h1>Newer chair</h1>');
 assert.equal(await w.cached('/chair'),'<h1>Newer chair</h1>','successful navigation updates the offline copy');
});

test('staff shell navigation: a 5xx with a cached copy serves the last good page; without one, the real error',async()=>{
 const w=await worker();await w.lifecycle('install');
 for(const status of [500,502,503,504]){
  w.reply('/chair/health',status,'<h1>Server error</h1>');
  const response=await w.navigate('/chair/health');assert.ok(response);
  assert.equal(response.status,200,`${status} falls back to the prepared page`);assert.equal(await response.text(),'<h1>Prepared /chair/health</h1>');
 }
 assert.equal(await w.cached('/chair/health'),'<h1>Prepared /chair/health</h1>','an error page never replaces the cached copy');
 const cold=await worker();
 cold.reply('/chair/voting',503,'<h1>Server error</h1>');
 const response=await cold.navigate('/chair/voting');assert.ok(response);
 assert.equal(response.status,503,'no cached copy: the original server error is returned');assert.equal(await response.text(),'<h1>Server error</h1>');
});

test('staff shell navigation: 401, 403 and 404 are never masked by the cached page',async()=>{
 const w=await worker();await w.lifecycle('install');
 for(const status of [401,403,404]){
  w.reply('/chair',status,`<h1>${status}</h1>`);
  const response=await w.navigate('/chair');assert.ok(response);
  assert.equal(response.status,status);assert.equal(await response.text(),`<h1>${status}</h1>`);
 }
 assert.equal(await w.cached('/chair'),'<h1>Prepared /chair</h1>','access responses never overwrite the cached copy');
});

test('5xx fallback is limited to the prepared staff shell: other pages, forms and APIs are not intercepted',async()=>{
 const w=await worker();await w.lifecycle('install');
 for(const path of ['/admin','/approval','/submit/abc','/amend/abc','/api/health','/api/submissions','/chair/unknown']){
  w.reply(path,503,'<h1>Server error</h1>');
  assert.equal(w.navigate(path),undefined,`${path} must go straight to the network`);
 }
});

