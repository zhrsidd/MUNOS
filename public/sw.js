/* Static application shell only. Supabase/Auth responses are NEVER cached here. */
const VERSION = 'conference-os-0.2.0';
const SHELL = ['/chair','/chair/roll-call','/chair/participation','/chair/documents','/chair/voting','/admin/health','/dcmun-logo.jpg'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(VERSION);
 for(const path of SHELL){
  const response=await fetch(path,{cache:'reload'});if(!response.ok)throw Error('Offline shell unavailable');
  await cache.put(path,response.clone());
  if(response.headers.get('content-type')?.includes('text/html')){
   const html=await response.text();
   const assets=[...new Set(html.match(/\/_next\/static\/[^"\s<>]+/g)||[])].map(s=>s.replaceAll('&amp;','&'));
   await Promise.all(assets.map(async asset=>{const r=await fetch(asset);if(r.ok)await cache.put(asset,r);}));
  }
 }
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('conference-os-')&&key!==VERSION)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 const navigation=request.mode==='navigate'&&SHELL.includes(url.pathname);
 const asset=url.pathname.startsWith('/_next/static/')||url.pathname==='/dcmun-logo.jpg';
 if(!navigation&&!asset)return;
 event.respondWith((async()=>{
  const cache=await caches.open(VERSION);
  if(asset){const hit=await cache.match(request);if(hit)return hit;}
  try{const response=await fetch(request);if(response.ok)await cache.put(navigation?url.pathname:request,response.clone());return response;}
  catch{const hit=await cache.match(navigation?url.pathname:request);return hit||new Response('Reconnect once to prepare this screen for offline use.',{status:503});}
 })());
});
