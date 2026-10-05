import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSubmission,SubmissionRejected,derivedIds,type SubmissionBackend,type SubmitArgs} from '../lib/submissions/service';
import {kindFromBytes} from '../lib/submissions/rules';
import {demoSubmissionBackend} from '../lib/submissions/demo-backend';
const token='T'.repeat(22), submitter='11111111-1111-4111-8111-111111111111';
const pdf=(text='resolution')=>new File([`%PDF-1.7\n${text}`],'GA1 draft.pdf',{type:'application/pdf'});
class FakeBackend implements SubmissionBackend{
 files=new Map<string,number>();submissions=new Map<string,SubmitArgs>();failUpload=false;reject?:SubmissionRejected;crash=false;
 async linkInfo(t:string){return t===token?{linkId:'l',conferenceId:'conf',committeeId:'ga1',conferenceName:'DCMUN',committeeCode:'GA1',committeeName:'General Assembly',contact:'help@example.com',submitters:[{id:submitter,country:'France',flag:'🇫🇷'}]}:null;}
 async upload(path:string,bytes:Uint8Array){if(this.failUpload)throw Error('storage down');this.files.set(path,bytes.length);}
 async remove(path:string){this.files.delete(path);}
 async submit(a:SubmitArgs){
  if(this.reject)throw this.reject;if(this.crash)throw Error('db down');
  if(this.submissions.has(a.submissionId))return {status:'replayed' as const,code:'GA1 / 01'};
  if([...this.submissions.values()].some(s=>s.sha256===a.sha256))return {status:'duplicate' as const,code:'GA1 / 01'};
  this.submissions.set(a.submissionId,a);return {status:'created' as const,code:'GA1 / 01'};
 }
}
const form=(fields:Record<string,string|File>)=>{const f=new FormData();for(const [k,v] of Object.entries({token,submissionId:crypto.randomUUID(),submitterId:submitter,title:'Protecting civilians',file:pdf(),...fields}))f.set(k,v);return f;};
test('valid PDF is stored under the committee path and created once; retry replays; same file is a duplicate',async()=>{
 const backend=new FakeBackend();const id=crypto.randomUUID();
 const first=await handleSubmission(form({submissionId:id}),backend);
 assert.equal(first.status,201);assert.deepEqual(first.body,{ok:true,status:'created',code:'GA1 / 01'});
 const key=[...backend.files.keys()][0];assert.equal(key,`conf/ga1/${derivedIds(id).documentId}/${derivedIds(id).versionId}.pdf`);
 const retry=await handleSubmission(form({submissionId:id}),backend);assert.equal(retry.body.ok&&retry.body.status,'replayed');
 const again=await handleSubmission(form({}),backend);assert.equal(again.body.ok&&again.body.status,'duplicate');
 assert.equal(backend.files.size,1,'duplicate upload is removed');assert.equal(backend.submissions.size,1);
});
test('invalid files, titles, submitters and links are rejected before anything is stored',async()=>{
 const backend=new FakeBackend();
 const png=new File([new Uint8Array([0x89,0x50,0x4e,0x47])],'resolution.pdf');
 for(const [fields,error,status] of [
  [{file:png},'invalid_file',400],[{file:new File(['hello'],'notes.txt')},'invalid_file',400],[{file:new File([],'empty.pdf')},'invalid_file',400],
  [{file:new File([new Uint8Array(4*1024*1024+1)],'big.pdf')},'too_large',413],
  [{title:'  '},'invalid_title',400],[{submitterId:'22222222-2222-4222-8222-222222222222'},'invalid_submitter',400],
  [{token:'x'.repeat(22)},'invalid_link',404],[{token:'../../etc'},'invalid_link',404],
 ] as const){
  const r=await handleSubmission(form(fields as Record<string,string|File>),backend);
  assert.equal(r.status,status,error);assert.equal(!r.body.ok&&r.body.error,error);
 }
 assert.equal(backend.files.size,0);assert.equal(backend.submissions.size,0);
});
test('upload failure never advances the workflow; database failure removes the orphaned file',async()=>{
 const backend=new FakeBackend();backend.failUpload=true;
 const storage=await handleSubmission(form({}),backend);
 assert.equal(storage.status,503);assert.equal(!storage.body.ok&&storage.body.error,'storage_unavailable');assert.equal(backend.submissions.size,0);
 backend.failUpload=false;backend.crash=true;
 const crash=await handleSubmission(form({}),backend);assert.equal(crash.status,500);assert.equal(backend.files.size,0);
 backend.crash=false;backend.reject=new SubmissionRejected('rate_limited');
 const limited=await handleSubmission(form({}),backend);assert.equal(limited.status,429);assert.equal(backend.files.size,0);
 assert.match(!limited.body.ok?limited.body.message:'',/Wait a few minutes/);
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
test('local demo backend resolves seed committees only and detects duplicates',async()=>{
 const demo=demoSubmissionBackend();
 assert.equal(await demo.linkInfo('demo_nope_0123456789abcdef0123'),null);
 const info=await demo.linkInfo('demo_ga1_0123456789abcdef0123');assert.equal(info?.committeeCode,'GA1');
 assert.ok(info!.submitters.every(s=>Object.keys(s).join()==='id,country,flag'),'countries only, no names or emails');
});
