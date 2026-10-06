import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGoogleDocLink,googleDocUrl} from '../lib/submissions/google-doc';
const id='1aBcD_efGhIjKlMnOpQrStUvWxYz0123456789-xyz';
test('valid Google Docs links normalize to one canonical edit URL',()=>{
 for(const link of [`https://docs.google.com/document/d/${id}/edit`,`https://docs.google.com/document/d/${id}/edit?usp=sharing`,`https://docs.google.com/document/d/${id}`,`docs.google.com/document/d/${id}/view#heading=h.1`,`https://docs.google.com/document/u/1/d/${id}/edit`,`  http://docs.google.com/document/d/${id}/edit?tab=t.0  `,`https://DOCS.GOOGLE.COM/document/d/${id}/edit`]){
  const r=parseGoogleDocLink(link);assert.ok(r.ok,link);assert.equal(r.ok&&r.url,`https://docs.google.com/document/d/${id}/edit`);assert.equal(r.ok&&r.id,id);
 }
});
test('malformed, non-Google, look-alike and unsafe links are rejected with a helpful reason',()=>{
 const problem=(s:string)=>{const r=parseGoogleDocLink(s);return r.ok?'ok':r.problem;};
 assert.equal(problem(''),'empty');
 assert.equal(problem('https://docs.google.com/document/d/short/edit'),'malformed');
 assert.equal(problem('https://docs.google.com/document/edit'),'malformed');
 assert.equal(problem(`https://docs.google.com/document/d/e/2PACX-${id}/pub`),'published_link');
 for(const s of [`https://drive.google.com/file/d/${id}/view`,`https://docs.google.com/spreadsheets/d/${id}/edit`,`https://example.com/document/d/${id}`,`https://docs.google.com.evil.example/document/d/${id}`,`https://evil.example/?u=https://docs.google.com/document/d/${id}`,`https://docs.google.com@evil.example/document/d/${id}`,`https://user:pw@docs.google.com/document/d/${id}`,`https://docs.google.com:8443/document/d/${id}`,`javascript:alert(1)//docs.google.com/document/d/${id}`,`data:text/html,docs.google.com/document/d/${id}`,`ftp://docs.google.com/document/d/${id}`,`docs.google.com/document/d/${id} extra`,'not a link'])assert.equal(problem(s),'not_google_doc',s);
 assert.throws(()=>googleDocUrl('../../evil'),/Invalid/);
});
