// Synthetic local browser verification only. Never accepts a hosted target URL.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const engines=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const engine=engines[process.env.BROWSER_ENGINE??'chromium'];
if(!engine)throw Error('Unknown browser engine');
const temp=await mkdtemp(join(tmpdir(),'munos-opening-'));
await build({entryPoints:['tests/fixtures/chair-opening-browser.tsx'],bundle:true,format:'esm',banner:{js:'var process = {env: {}, browser: true};'},outfile:join(temp,'fixture.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_DATA_BACKEND':'"supabase"','process.env.NEXT_PUBLIC_CONFERENCE_ID':'"opening-test"'},plugins:[{name:'local-backend',setup(b){if(process.env.CHAIR_OPENING_BASELINE==='1')b.onLoad({filter:/(lib\/context|components\/committee-workspace-loading)\.tsx$/},args=>({contents:execFileSync('git',['show',`62068be:${args.path.slice(process.cwd().length+1)}`],{encoding:'utf8'}),loader:'tsx'}));b.onLoad({filter:/lib\/supabase\/client\.ts$/},()=>({contents:'export function browserClient(){return window.__openingClient}',loader:'js'}));}}]});
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=path==='/fixture.js'?join(temp,'fixture.js'):path==='/globals.css'?resolve('app/globals.css'):path==='/loading/committee-collage-v1.webp'?resolve('public/loading/committee-collage-v1.webp'):path==='/dcmun-logo.jpg'?resolve('public/dcmun-logo.jpg'):null;
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webp')?'image/webp':path.endsWith('.jpg')?'image/jpeg':'text/html');
  res.end(file?await readFile(file):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/globals.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await engine.launch({headless:true,...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
const results=[];
try{
 for(const scenario of ['fast','cache-late','slow','skip','disabled','uncached','multi','revoked','expired','denied','recovery','image-failure','conflict','reduced','hidden']){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:scenario==='reduced'?'reduce':'no-preference'});
  await context.route('**/*',r=>{
   if(!r.request().url().startsWith(url))return r.abort();
   if(scenario==='image-failure'&&r.request().url().endsWith('.webp'))return r.fulfill({status:404,body:''});
   return r.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.timing={};new MutationObserver(()=>{const art=document.querySelector('.committee-loading'),ready=document.querySelector('[data-workspace]');if(art&&art.getBoundingClientRect().height&&art.querySelector('img')?.complete&&!window.timing.art)window.timing.art=performance.now();if(ready&&!window.timing.ready)window.timing.ready=performance.now();}).observe(document,{subtree:true,childList:true,attributes:true});});
  await page.goto(`${url}/?scenario=${scenario}`);
  const intro=page.locator('.committee-loading:visible'),workspace=page.locator('[data-workspace]');
  const enabled=['fast','cache-late','slow','skip','multi','conflict','reduced','hidden'].includes(scenario);
  if(enabled){
   await intro.waitFor({state:'visible',timeout:10000}).catch(async error=>{console.error({scenario,errors,body:await page.locator('body').innerText()});throw error;});
   if(scenario==='conflict')await page.evaluate(()=>window.setHealth({conflicts:1,state:'conflict'}));
   else if(scenario==='skip'){await page.getByRole('button',{name:'Enter workspace'}).focus();await page.keyboard.press('Enter');}
   else if(scenario==='slow'){assert.equal(await page.getByRole('button',{name:'Enter workspace'}).count(),0);}
   if(scenario==='hidden'){
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(3100);assert.equal(await intro.isVisible(),true);
    assert.equal(await page.locator('.committee-loading-dots > span').nth(1).evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   }
   if(scenario==='reduced')assert.equal(await page.locator('.committee-loading-dots > span').nth(1).evaluate(e=>getComputedStyle(e).animationName),'none');
   for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${scenario} overflow at ${width}`);
   }
  }
  if(['revoked','expired','denied'].includes(scenario)){await page.locator('.staff-access-card').waitFor();assert.equal(await workspace.count(),0);assert.equal(await intro.count(),0);}
  else {
   await workspace.waitFor({timeout:10000});
   const timing=await page.evaluate(()=>window.timing);
   if(enabled&&!['skip','conflict'].includes(scenario))assert.ok(timing.ready-timing.art>=3000,`${scenario}: ${timing.ready-timing.art}`);
   if(['skip','conflict'].includes(scenario))assert.ok(timing.ready-timing.art<2000);
   if(!enabled)assert.equal(timing.art,undefined,scenario);
   await page.evaluate(()=>{window.go('/chair/participation');window.dispatchEvent(new Event('focus'));});
   assert.equal(await workspace.isVisible(),true);assert.equal(await intro.count(),0);
   results.push({scenario,visibleMs:timing.art?Math.round(timing.ready-timing.art):null});
   if(scenario==='fast'){
    await page.reload();await intro.waitFor({state:'visible'});await workspace.waitFor();const again=await page.evaluate(()=>window.timing);assert.ok(again.ready-again.art>=3000);results.push({scenario:'refresh',visibleMs:Math.round(again.ready-again.art)});
   }
  }
  assert.deepEqual(errors,[],scenario);await context.close();
 }
 console.log(JSON.stringify({pass:true,results},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
