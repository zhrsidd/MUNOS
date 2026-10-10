/* Static application shell only. Supabase/Auth responses are NEVER cached here. */
const VERSION = 'conference-os-0.2.4';
const SHELL = ['/chair','/chair/roll-call','/chair/participation','/chair/documents','/chair/amendments','/chair/voting','/chair/photos','/chair/health','/approval/health','/logistics/health','/admin/health','/dcmun-logo.jpg'];
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
  try{
   const response=await fetch(request);
   if(response.ok){await cache.put(navigation?url.pathname:request,response.clone());return response;}
   // A server error (e.g. a broken deploy) on a prepared staff screen: keep the last good copy.
   // 401/403/404 and redirects pass through, so access changes are never masked.
   if(navigation&&response.status>=500){const hit=await cache.match(url.pathname);if(hit)return hit;}
   return response;
  }
  catch{const hit=await cache.match(navigation?url.pathname:request);return hit||new Response('Reconnect once to prepare this screen for offline use.',{status:503});}
 })());
});
