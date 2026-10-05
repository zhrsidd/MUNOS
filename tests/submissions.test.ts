import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSubmission,SubmissionRejected,derivedIds,type SubmissionBackend,type SubmitArgs} from '../lib/submissions/service';
import {kindFromBytes,type LinkInfo} from '../lib/submissions/rules';
import {demoSubmissionBackend} from '../lib/submissions/demo-backend';
const token='T'.repeat(22), submitter='11111111-1111-4111-8111-111111111111';
const docId='1aBcD_efGhIjKlMnOpQrStUvWxYz0123456789-xyz';
const docLink=`https://docs.google.com/document/d/${docId}/edit?usp=sharing`;
const pdf=(text='resolution')=>new File([`%PDF-1.7\n${text}`],'GA1 draft.pdf',{type:'application/pdf'});
class FakeBackend implements SubmissionBackend{
 files=new Map<string,number>();submissions=new Map<string,SubmitArgs>();failUpload=false;reject?:SubmissionRejected;crash=false;
 async linkInfo(t:string):Promise<LinkInfo|null>{return t===token?{linkId:'l',conferenceId:'conf',committeeId:'ga1',conferenceName:'DCMUN',committeeCode:'GA1',committeeName:'General Assembly',shareWith:'ga1@dcmun.example',submitters:[{id:submitter,country:'France',flag:'🇫🇷'}]}:null;}
 async upload(path:string,bytes:Uint8Array){if(this.failUpload)throw Error('storage down');this.files.set(path,bytes.length);}
 async remove(path:string){this.files.delete(path);}
 async submit(a:SubmitArgs){
  if(this.reject)throw this.reject;if(this.crash)throw Error('db down');
  if(this.submissions.has(a.submissionId))return {status:'replayed' as const,code:'GA1 / 01'};
  const same=(s:SubmitArgs)=>(a.googleDocId&&s.googleDocId===a.googleDocId)||(a.file&&s.file?.sha256===a.file.sha256);
  if([...this.submissions.values()].some(same))return {status:'duplicate' as const,code:'GA1 / 01'};
  this.submissions.set(a.submissionId,a);return {status:'created' as const,code:'GA1 / 01'};
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
 const key=[...backend.files.keys()][0];assert.equal(key,`conf/ga1/${derivedIds(id).documentId}/${derivedIds(id).versionId}.pdf`);
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
test('upload failure never advances the workflow; database failure removes the orphaned file; rate limit',async()=>{
 const backend=new FakeBackend();backend.failUpload=true;
 const storage=await handleSubmission(form({file:pdf()},{}),backend);
 assert.equal(storage.status,503);assert.equal(!storage.body.ok&&storage.body.error,'storage_unavailable');assert.equal(backend.submissions.size,0);
 assert.match(!storage.body.ok?storage.body.message:'',/Google Doc link instead/);
 const doc=await handleSubmission(form({}),backend);assert.equal(doc.status,201,'Google Doc path works while file storage is down');
 backend.failUpload=false;backend.crash=true;
 const crash=await handleSubmission(form({file:pdf('x')},{}),backend);assert.equal(crash.status,500);assert.equal(backend.files.size,0);
 backend.crash=false;backend.reject=new SubmissionRejected('rate_limited');
 const limited=await handleSubmission(form({googleDoc:docLink.replace('xyz','xya')}),backend);assert.equal(limited.status,429);
});
test('cloud mode without the server key reports not configured',async()=>{
 const r=await handleSubmission(form({}),null);assert.equal(r.status,503);assert.equal(!r.body.ok&&r.body.error,'not_configured');
});
test('file signatures: pdf, docx, legacy doc',()=>{
 assert.equal(kindFromBytes('a.PDF',new TextEncoder().encode('%PDF-1.4')),'pdf');
 assert.equal(kindFromBytes('a.docx',new Uint8Array([0x50,0x4b,3,4])),'docx');
 assert.equal(kindFromBytes('a.doc',new Uint8Array([0xd0,0xcf,0x11,0xe0])),'doc');
 assert.equal(kindFromBytes('a.docx',new TextEncoder().encode('%PDF-1.4')),null);
});
test('local demo backend resolves seed committees only, shows the sharing address and detects duplicate documents',async()=>{
 const demo=demoSubmissionBackend();
 assert.equal(await demo.linkInfo('demo_nope_0123456789abcdef0123'),null);
 const info=await demo.linkInfo('demo_ga1_0123456789abcdef0123');assert.equal(info?.committeeCode,'GA1');assert.equal(info?.shareWith,'ga1@dcmun.example');
 assert.ok(info!.submitters.every(s=>Object.keys(s).join()==='id,country,flag'),'countries only, no names or emails');
 const args={token:'demo_ga1_0123456789abcdef0123',submitterId:'d0',title:'T',googleDocId:docId};
 assert.equal((await demo.submit({...args,submissionId:crypto.randomUUID()})).status,'created');
 assert.equal((await demo.submit({...args,submissionId:crypto.randomUUID()})).status,'duplicate');
});
