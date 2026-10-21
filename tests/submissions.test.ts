import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSubmission,SubmissionRejected,type SubmissionBackend,type SubmitArgs} from '../lib/submissions/service';
import type {LinkInfo} from '../lib/submissions/rules';
import {demoSubmissionBackend} from '../lib/submissions/demo-backend';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SubmissionForm} from '../components/operations/submission-form';
const token='T'.repeat(22), submitter='11111111-1111-4111-8111-111111111111';
const docId='1aBcD_efGhIjKlMnOpQrStUvWxYz0123456789-xyz';
const docLink=`https://docs.google.com/document/d/${docId}/edit?usp=sharing`;
const pdf=(text='resolution')=>new File([`%PDF-1.7\n${text}`],'GA1 draft.pdf',{type:'application/pdf'});
class FakeBackend implements SubmissionBackend{
 submissions=new Map<string,SubmitArgs>();reject?:SubmissionRejected;crash=false;loseResponse=false;
 async linkInfo(t:string):Promise<LinkInfo|null>{return t===token?{linkId:'l',conferenceId:'conf',committeeId:'ga1',conferenceName:'DCMUN',committeeCode:'GA1',committeeName:'General Assembly',shareWith:'ga1@dcmun.example',submitters:[{id:submitter,country:'France',flag:'🇫🇷'}]}:null;}
 async submit(a:SubmitArgs){
  if(this.reject)throw this.reject;if(this.crash)throw Error('db down');
  if(this.submissions.has(a.submissionId))return {status:'replayed' as const,code:'GA1 / 01'};
  if([...this.submissions.values()].some(s=>s.googleDocId===a.googleDocId))return {status:'duplicate' as const,code:'GA1 / 01'};
  this.submissions.set(a.submissionId,a);if(this.loseResponse){this.loseResponse=false;throw Error('response lost after commit');}return {status:'created' as const,code:'GA1 / 01'};
 }
}
const form=(fields:Record<string,string|File>,base:Record<string,string|File>={googleDoc:docLink})=>{const f=new FormData();for(const [k,v] of Object.entries({token,submissionId:crypto.randomUUID(),submitterId:submitter,...base,...fields}))f.set(k,v);return f;};
test('Google Doc link (normal path): stores only the canonical document id, never uploads, never fetches the document',async()=>{
 const backend=new FakeBackend();const id=crypto.randomUUID();
 const realFetch=globalThis.fetch;let fetched=false;globalThis.fetch=(async()=>{fetched=true;throw Error('no network');}) as typeof fetch;
 try{
  const first=await handleSubmission(form({submissionId:id}),backend);
  assert.equal(first.status,201);assert.deepEqual(first.body,{ok:true,status:'created',code:'GA1 / 01'});
  const stored=backend.submissions.get(id)!;assert.equal(stored.googleDocId,docId);
  assert.equal(fetched,false,'Google is never contacted');
 }finally{globalThis.fetch=realFetch;}
 const retry=await handleSubmission(form({submissionId:id}),backend);assert.equal(retry.body.ok&&retry.body.status,'replayed','lost-response retry');
 const again=await handleSubmission(form({googleDoc:`docs.google.com/document/u/0/d/${docId}/view`}),backend);
 assert.equal(again.body.ok&&again.body.status,'duplicate','same document in another link form is a duplicate');
});
test('malformed, non-Google and missing links are rejected; nothing is created',async()=>{
 const backend=new FakeBackend();
 for(const [fields,error,pattern] of [
  [{googleDoc:'https://docs.google.com/document/d/short'},'invalid_google_doc',/incomplete/],
  [{googleDoc:`https://drive.google.com/file/d/${docId}/view`},'invalid_google_doc',/not a Google Docs link/],
  [{googleDoc:`https://evil.example/document/d/${docId}`},'invalid_google_doc',/not a Google Docs link/],
  [{googleDoc:`javascript:alert(1)`},'invalid_google_doc',/not a Google Docs link/],
  [{googleDoc:`https://docs.google.com/document/d/e/2PACX-${docId}/pub`},'invalid_google_doc',/Publish to the web/],
  [{googleDoc:`https://docs.google.com/document/d/${docId}/edit?usp=sharing&ouid=1234&rtpof=true&sd=true`},'invalid_google_doc',/Word file opened in Google Docs/],
  [{googleDoc:''},'missing_source',/Paste the link/],
 ] as const){
  const r=await handleSubmission(form(fields as Record<string,string>),backend);
  assert.equal(r.status,400,error);assert.equal(!r.body.ok&&r.body.error,error);assert.match(!r.body.ok?r.body.message:'',pattern);
 }
 const none=await handleSubmission(form({},{}),backend);assert.equal(!none.body.ok&&none.body.error,'missing_source','no link');
 assert.equal(backend.submissions.size,0);
});
test('Google Docs only: any file is refused before anything is created, even alongside a valid Doc link',async()=>{
 const backend=new FakeBackend();
 for(const [base,label] of [[{},'file only'],[{googleDoc:docLink},'file plus a valid link']] as const){
  for(const file of [pdf(),new File(['x'],'resolution.docx'),new File([],'empty.pdf')]){
   const r=await handleSubmission(form({file},base),backend);
   assert.equal(r.status,400,label);assert.equal(!r.body.ok&&r.body.error,'docs_only',label);assert.match(!r.body.ok?r.body.message:'',/Google Docs links only/);
  }
 }
 assert.equal(backend.submissions.size,0,'nothing created');
 const noBackend=await handleSubmission(form({file:pdf()},{}),null);assert.equal(!noBackend.body.ok&&noBackend.body.error,'docs_only','refused even before configuration is checked');
});
test('valid and invalid committee tokens; wrong submitter',async()=>{
 const backend=new FakeBackend();
 for(const [fields,error,status] of [[{token:'x'.repeat(22)},'invalid_link',404],[{token:'../../etc'},'invalid_link',404],[{submitterId:'22222222-2222-4222-8222-222222222222'},'invalid_submitter',400]] as const){
  const r=await handleSubmission(form(fields),backend);assert.equal(r.status,status,error);assert.equal(!r.body.ok&&r.body.error,error);
 }
 assert.equal((await handleSubmission(form({}),backend)).status,201,'valid token accepted');
});
test('ambiguous database failure and rate limit',async()=>{
 const backend=new FakeBackend();backend.crash=true;
 const crash=await handleSubmission(form({}),backend);assert.equal(crash.status,500);assert.match(!crash.body.ok?crash.body.message:'',/could not confirm/);
 backend.crash=false;backend.reject=new SubmissionRejected('rate_limited');
 const limited=await handleSubmission(form({googleDoc:docLink.replace('xyz','xya')}),backend);assert.equal(limited.status,429);
});
test('cloud mode without the server key reports not configured',async()=>{
 const r=await handleSubmission(form({}),null);assert.equal(r.status,503);assert.equal(!r.body.ok&&r.body.error,'not_configured');
});
test('a lost commit response and a retry with the same submission id confirm it exactly once',async()=>{
 const backend=new FakeBackend();backend.loseResponse=true;const id=crypto.randomUUID();
 const first=await handleSubmission(form({submissionId:id}),backend);
 assert.equal(first.status,500);assert.match(!first.body.ok?first.body.message:'',/could not confirm/);
 const retry=await handleSubmission(form({submissionId:id}),backend);
 assert.equal(retry.status,200);assert.equal(retry.body.ok&&retry.body.status,'replayed');
 assert.equal(backend.submissions.size,1);
});
test('local demo backend resolves seed committees only, does not invent Chair mailboxes and detects duplicate documents',async()=>{
 const demo=demoSubmissionBackend();
 assert.equal(await demo.linkInfo('demo_nope_0123456789abcdef0123'),null);
 const info=await demo.linkInfo('demo_ga1_0123456789abcdef0123');assert.equal(info?.committeeCode,'GA1');assert.equal(info?.shareWith,'');assert.deepEqual(info?.chairs,[]);
 assert.ok(info!.submitters.every(s=>Object.keys(s).join()==='id,country,flag'),'countries only, no names or emails');
 const args={token:'demo_ga1_0123456789abcdef0123',submitterId:'d0',googleDocId:docId};
 assert.equal((await demo.submit({...args,submissionId:crypto.randomUUID()})).status,'created');
 assert.equal((await demo.submit({...args,submissionId:crypto.randomUUID()})).status,'duplicate');
});
const formLink:LinkInfo={linkId:'l',conferenceId:'conf',committeeId:'ga1',conferenceName:'DCMUN',committeeCode:'GA1',committeeName:'General Assembly',shareWith:'',chairs:[{name:'Chair One',email:'chair@dcmun.example'}],submitters:[{id:submitter,country:'France',flag:'🇫🇷'}]};
test('before hydration the resolution form cannot submit natively, accept unsynced input or fail silently',()=>{
 // Server HTML is exactly what a slow device shows until React attaches submit() and the onChange handlers.
 const html=renderToStaticMarkup(createElement(SubmissionForm,{token,link:formLink}));
 const form=html.match(/<form[^>]*>/)![0];
 assert.match(form,/method="post"/,'a native submission is never a GET reload');
 assert.doesNotMatch(form,/action=/,'no native action target');
 assert.match(html,/<fieldset disabled=""[^>]*><ol class="submit-steps">/,'country, link and checkbox cannot be edited before React state exists');
 assert.match(html,/<button disabled="" type="submit" class="pending-button button primary submit-button"><span class="spinner" data-active="false" aria-hidden="true"><\/span>Loading form…<\/button>/,'submit (and Enter-key implicit submission) is blocked');
 assert.doesNotMatch(html,/type="file"|Upload a file/,'Google Docs only: no file input or upload toggle');
 assert.match(html,/<p class="muted" role="status">If this form does not load, ask your Chair how to submit your resolution\.<\/p>/,'stalled hydration (JS on, never loads) still tells the delegate what to do');
 assert.match(html,/<noscript>.*This form needs JavaScript to submit\. Ask your Chair how to submit your resolution\..*<\/noscript>/,'JavaScript disabled is never a silent dead form');
});
test('after hydration the resolution form is enabled and unchanged',t=>{
 t.mock.method(React,'useSyncExternalStore',((_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 const html=renderToStaticMarkup(createElement(SubmissionForm,{token,link:formLink}));
 assert.doesNotMatch(html,/<fieldset disabled/);
 assert.match(html,/<button type="submit" class="pending-button button primary submit-button"><span class="spinner" data-active="false" aria-hidden="true"><\/span>Submit resolution<\/button>/);
 assert.doesNotMatch(html,/type="file"|Upload a file/,'no file path after hydration either');
 assert.match(html,/Files \(PDF or Word\) are not accepted/,'the instructions say so before the delegate starts');
 assert.doesNotMatch(html,/Loading form…|If this form does not load/);
 for(const s of ['France','Chair One','chair@dcmun.example','Google Doc link'])assert.ok(html.includes(s),s);
});
