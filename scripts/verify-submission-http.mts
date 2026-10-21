import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {assertToolTarget} from '../lib/platform/target-guard';
nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref=assertToolTarget(url);
assert.ok(process.env.SUPABASE_SECRET_KEY,'Server-only development key required');
const server=createClient(url!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8'));
const fixture=JSON.parse(await readFile('.test-sessions/integration.json','utf8'));
const link={token:fixture.token};
const lookup=await server.rpc('submission_link_info',{link_token:link.token});assert.ifError(lookup.error);assert.ok(lookup.data);
const origin='http://localhost:3001',results:Record<string,unknown>={project:ref,checkedAt:new Date().toISOString()};
const page=await fetch(`${origin}/submit/${link.token}`);assert.equal(page.status,200);
const html=await page.text();assert.ok(html.includes('I have made sure the Chairs can edit this document.'));assert.ok(!html.includes(process.env.SUPABASE_SECRET_KEY!));results.page=true;
const submission=randomUUID(),googleDoc=`https://docs.google.com/document/d/rehearsal_${randomUUID().replaceAll('-','')}/edit`;
async function post(values:Record<string,string>={},file?:Blob){
 const form=new FormData();
 for(const [k,v]of Object.entries({token:link!.token,submissionId:submission,submitterId:ids.france,...(!file?{googleDoc}:{}),...values}))form.set(k,v);
 if(file)form.set('file',file,'rehearsal.pdf');
 const r=await fetch(`${origin}/api/submissions`,{method:'POST',body:form});
 assert.equal(r.headers.get('set-cookie'),null,'Delegate HTTP must not issue an auth cookie');
 return {status:r.status,body:await r.json()};
}
const first=await post();assert.equal(first.status,201);assert.equal(first.body.status,'created');results.created=first.body.code;
const retries=await Promise.all([post(),post(),post()]);assert.ok(retries.every(r=>r.status===200&&r.body.status==='replayed'&&r.body.code===first.body.code));results.concurrentRetriesExactlyOnce=true;
const duplicate=await post({submissionId:randomUUID()});assert.equal(duplicate.body.status,'duplicate');assert.equal(duplicate.body.code,first.body.code);results.duplicateSource=true;
// The form has no title; a legacy client's title is ignored, so a different Google Doc is the changed payload.
const legacy=await post({submissionId:randomUUID(),title:'Legacy client title',googleDoc:`https://docs.google.com/document/d/rehearsal_${randomUUID().replaceAll('-','')}/edit`});assert.equal(legacy.status,201);results.legacyTitleIgnored=true;
const changed=await post({googleDoc:`https://docs.google.com/document/d/rehearsal_${randomUUID().replaceAll('-','')}/edit`});assert.equal(changed.status,409);assert.equal(changed.body.error,'idempotency_conflict');results.changedRetryDenied=true;
const invalid=await post({submissionId:randomUUID(),googleDoc:'https://example.com/not-a-doc'});assert.equal(invalid.status,400);results.invalidHostDenied=true;
const foreign=await post({submissionId:randomUUID(),submitterId:randomUUID()});assert.equal(foreign.status,400);results.invalidSubmitterDenied=true;
const invalidToken=await post({token:randomUUID().replaceAll('-',''),submissionId:randomUUID()});assert.equal(invalidToken.status,404);results.invalidTokenDenied=true;
// Google Docs only: a file is refused, alone or with a valid link.
const pdf=new Blob([`%PDF-1.4\n% Development-only Docs-only refusal check ${randomUUID()}\n%%EOF\n`],{type:'application/pdf'});
for(const values of [{submissionId:randomUUID()},{submissionId:randomUUID(),googleDoc}]){
 const refused=await post(values,pdf);assert.equal(refused.status,400);assert.equal(refused.body.error,'docs_only');
}
results.fileRefused=true;
await writeFile('.test-sessions/http-browser.json',JSON.stringify({url:`${origin}/submit/${link.token}`,googleDoc,submission}),{mode:0o600});
await writeFile('docs/submission-http-results.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
