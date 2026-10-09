import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSubmission,SubmissionRejected,derivedIds,type SubmissionBackend,type SubmitArgs} from '../lib/submissions/service';
import {kindFromBytes,type LinkInfo} from '../lib/submissions/rules';
import {demoSubmissionBackend} from '../lib/submissions/demo-backend';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SubmissionForm} from '../components/operations/submission-form';
const token='T'.repeat(22), submitter='11111111-1111-4111-8111-111111111111';
const docId='1aBcD_efGhIjKlMnOpQrStUvWxYz0123456789-xyz';
const docLink=`https://docs.google.com/document/d/${docId}/edit?usp=sharing`;
const pdf=(text='resolution')=>new File([`%PDF-1.7\n${text}`],'GA1 draft.pdf',{type:'application/pdf'});
class FakeBackend implements SubmissionBackend{
 files=new Map<string,number>();submissions=new Map<string,SubmitArgs>();failUpload=false;reject?:SubmissionRejected;crash=false;loseResponse=false;
 async linkInfo(t:string):Promise<LinkInfo|null>{return t===token?{linkId:'l',conferenceId:'conf',committeeId:'ga1',conferenceName:'DCMUN',committeeCode:'GA1',committeeName:'General Assembly',shareWith:'ga1@dcmun.example',submitters:[{id:submitter,country:'France',flag:'🇫🇷'}]}:null;}
 async upload(path:string,bytes:Uint8Array){if(this.failUpload)throw Error('storage down');this.files.set(path,bytes.length);}
 async remove(path:string){this.files.delete(path);}
 async submit(a:SubmitArgs){
  if(this.reject)throw this.reject;if(this.crash)throw Error('db down');
  if(this.submissions.has(a.submissionId))return {status:'replayed' as const,code:'GA1 / 01'};
  const same=(s:SubmitArgs)=>(a.googleDocId&&s.googleDocId===a.googleDocId)||(a.file&&s.file?.sha256===a.file.sha256);
  const original=[...this.submissions.values()].find(same);
  if(original)return {status:'duplicate' as const,code:'GA1 / 01',storageKey:original.file?.storageKey};
  this.submissions.set(a.submissionId,a);if(this.loseResponse){this.loseResponse=false;throw Error('response lost after commit');}return {status:'created' as const,code:'GA1 / 01'};
 }
}
const form=(fields:Record<string,string|File>,base:Record<string,string|File>={googleDoc:docLink})=>{const f=new FormData();for(const [k,v] of Object.entries({token,submissionId:crypto.randomUUID(),submitterId:submitter,title:'Protecting civilians',...base,...fields}))f.set(k,v);return f;};
test('Google Doc link (normal path): stores only the canonical document id, never uploads, never fetches the document',async()=>{
 const backend=new FakeBackend();const id=crypto.randomUUID();
 const realFetch=globalThis.fetch;let fetched=false;globalThis.fetch=(async()=>{fetched=true;throw Error('no network');}) as typeof fetch;
 try{
  const first=await handleSubmission(form({submissionId:id}),backend);
  assert.equal(first.status,201);assert.deepEqual(first.body,{ok:true,status:'created',code:'GA1 / 01'});
  const stored=backend.submissions.get(id)!;assert.equal(stored.googleDocId,docId);assert.equal(stored.file,undefined);
  assert.equal(backend.files.size,0,'nothing uploaded');assert.equal(fetched,false,'Google is never contacted');
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
  [{googleDoc:''},'missing_source',/Paste the link/],
 ] as const){
  const r=await handleSubmission(form(fields as Record<string,string>),backend);
  assert.equal(r.status,400,error);assert.equal(!r.body.ok&&r.body.error,error);assert.match(!r.body.ok?r.body.message:'',pattern);
 }
 const none=await handleSubmission(form({},{}),backend);assert.equal(!none.body.ok&&none.body.error,'missing_source','no link and no file');
 assert.equal(backend.submissions.size,0);
});
test('fallback file upload: stored under the committee path; invalid files and sizes rejected; same file is a duplicate',async()=>{
 const backend=new FakeBackend();const id=crypto.randomUUID();
 const first=await handleSubmission(form({submissionId:id,file:pdf()},{}),backend);
 assert.equal(first.status,201);assert.equal(backend.submissions.get(id)!.googleDocId,undefined);
 const key=[...backend.files.keys()][0];assert.ok(key.startsWith(`conf/ga1/${derivedIds(id).documentId}/${derivedIds(id).versionId}-`));assert.match(key,/-[0-9a-f]{64}\.pdf$/);
 const dup=await handleSubmission(form({file:pdf()},{}),backend);assert.equal(dup.body.ok&&dup.body.status,'duplicate');assert.equal(backend.files.size,1,'duplicate upload removed');
 for(const [file,error,status] of [[new File([new Uint8Array([0x89,0x50,0x4e,0x47])],'resolution.pdf'),'invalid_file',400],[new File(['hello'],'notes.txt'),'invalid_file',400],[new File([],'empty.pdf'),'invalid_file',400],[new File([new Uint8Array(4*1024*1024+1)],'big.pdf'),'too_large',413]] as const){
  const r=await handleSubmission(form({file},{}),backend);assert.equal(r.status,status,error);assert.equal(!r.body.ok&&r.body.error,error);
 }
});
test('valid and invalid committee tokens; wrong submitter; title',async()=>{
 const backend=new FakeBackend();
 for(const [fields,error,status] of [[{token:'x'.repeat(22)},'invalid_link',404],[{token:'../../etc'},'invalid_link',404],[{submitterId:'22222222-2222-4222-8222-222222222222'},'invalid_submitter',400],[{title:'  '},'invalid_title',400]] as const){
  const r=await handleSubmission(form(fields),backend);assert.equal(r.status,status,error);assert.equal(!r.body.ok&&r.body.error,error);
 }
 assert.equal((await handleSubmission(form({}),backend)).status,201,'valid token accepted');
});
test('upload failure never advances the workflow; ambiguous database failure retains the uploaded file; rate limit',async()=>{
 const backend=new FakeBackend();backend.failUpload=true;
 const storage=await handleSubmission(form({file:pdf()},{}),backend);
 assert.equal(storage.status,503);assert.equal(!storage.body.ok&&storage.body.error,'storage_unavailable');assert.equal(backend.submissions.size,0);
 assert.match(!storage.body.ok?storage.body.message:'',/Google Doc link instead/);
 const doc=await handleSubmission(form({}),backend);assert.equal(doc.status,201,'Google Doc path works while file storage is down');
 backend.failUpload=false;backend.crash=true;
 const crash=await handleSubmission(form({file:pdf('x')},{}),backend);assert.equal(crash.status,500);assert.equal(backend.files.size,1,"an ambiguous failure must not delete possibly committed bytes");
 backend.crash=false;backend.reject=new SubmissionRejected('rate_limited');
 const limited=await handleSubmission(form({googleDoc:docLink.replace('xyz','xya')}),backend);assert.equal(limited.status,429);
});
test('cloud mode without the server key reports not configured',async()=>{
 const r=await handleSubmission(form({}),null);assert.equal(r.status,503);assert.equal(!r.body.ok&&r.body.error,'not_configured');
});
test('fallback upload survives a lost commit response and a retry confirms it exactly once',async()=>{
 const backend=new FakeBackend();backend.loseResponse=true;const id=crypto.randomUUID();
 const first=await handleSubmission(form({submissionId:id,file:pdf('committed')},{}),backend);
 assert.equal(first.status,500);assert.match(!first.body.ok?first.body.message:'',/could not confirm/);
 assert.equal(backend.submissions.size,1);assert.equal(backend.files.size,1,'committed bytes retained');
 const retry=await handleSubmission(form({submissionId:id,file:pdf('committed')},{}),backend);
 assert.equal(retry.status,200);assert.equal(retry.body.ok&&retry.body.status,'replayed');
 assert.equal(backend.submissions.size,1);assert.equal(backend.files.size,1);
});
test('a duplicate sharing the original storage path never deletes accepted file bytes',async()=>{
 const backend=new FakeBackend(),id=crypto.randomUUID();
 await handleSubmission(form({submissionId:id,file:pdf()},{}),backend);
 const suffix=id.endsWith('1')?'2':'1';const samePrefix=id.slice(0,-1)+suffix;
 const duplicate=await handleSubmission(form({submissionId:samePrefix,file:pdf()},{}),backend);
 assert.equal(duplicate.body.ok&&duplicate.body.status,'duplicate');
 assert.equal(backend.files.size,1,'accepted upload remains');
 assert.equal('storageKey' in duplicate.body,false,'internal cleanup metadata is not public');
});
test('file signatures: pdf, docx, legacy doc',()=>{
 assert.equal(kindFromBytes('a.PDF',new TextEncoder().encode('%PDF-1.4')),'pdf');
 assert.equal(kindFromBytes('a.docx',new Uint8Array([0x50,0x4b,3,4])),'docx');
 assert.equal(kindFromBytes('a.doc',new Uint8Array([0xd0,0xcf,0x11,0xe0])),'doc');
 assert.equal(kindFromBytes('a.docx',new TextEncoder().encode('%PDF-1.4')),null);
});
test('local demo backend resolves seed committees only, does not invent Chair mailboxes and detects duplicate documents',async()=>{
 const demo=demoSubmissionBackend();
 assert.equal(await demo.linkInfo('demo_nope_0123456789abcdef0123'),null);
 const info=await demo.linkInfo('demo_ga1_0123456789abcdef0123');assert.equal(info?.committeeCode,'GA1');assert.equal(info?.shareWith,'');assert.deepEqual(info?.chairs,[]);
 assert.ok(info!.submitters.every(s=>Object.keys(s).join()==='id,country,flag'),'countries only, no names or emails');
 const args={token:'demo_ga1_0123456789abcdef0123',submitterId:'d0',title:'T',googleDocId:docId};
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
 assert.match(html,/<fieldset disabled=""[^>]*><ol class="submit-steps">/,'country, title, link, checkbox and file cannot be edited before React state exists');
 assert.match(html,/<button class="button primary submit-button" disabled="">Loading form…<\/button>/,'submit (and Enter-key implicit submission) is blocked');
 assert.match(html,/<button type="button" class="link-button" disabled="">/,'the file/Google Doc toggle is not a silent no-op');
 assert.match(html,/<p class="muted" role="status">If this form does not load, ask your Chair how to submit your resolution\.<\/p>/,'stalled hydration (JS on, never loads) still tells the delegate what to do');
 assert.match(html,/<noscript>.*This form needs JavaScript to submit\. Ask your Chair how to submit your resolution\..*<\/noscript>/,'JavaScript disabled is never a silent dead form');
});
test('after hydration the resolution form is enabled and unchanged',t=>{
 t.mock.method(React,'useSyncExternalStore',((_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot()) as typeof React.useSyncExternalStore);
 const html=renderToStaticMarkup(createElement(SubmissionForm,{token,link:formLink}));
 assert.doesNotMatch(html,/<fieldset disabled/);
 assert.match(html,/<button class="button primary submit-button">Submit resolution<\/button>/);
 assert.match(html,/<button type="button" class="link-button">Can&#x27;t use Google Docs\? Upload a file instead<\/button>/);
 assert.doesNotMatch(html,/Loading form…|If this form does not load/);
 for(const s of ['France','Chair One','chair@dcmun.example','Google Doc link'])assert.ok(html.includes(s),s);
});
