import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedBody} from '../lib/http/bounded-body';
import {POST as submit} from '../app/api/submissions/route';
import {POST as amend} from '../app/api/amendments/route';
import {MAX_SUBMISSION_BODY} from '../lib/submissions/rules';

// Audit F4 (20 October): the public body limit must hold without trusting Content-Length.
const chunks=(sizes:number[],onCancel?:()=>void)=>new ReadableStream<Uint8Array>({
 start(controller){for(const n of sizes)controller.enqueue(new Uint8Array(n).fill(120));controller.close();},
 cancel(){onCancel?.();},
});
const streamed=(body:ReadableStream<Uint8Array>|string,headers:Record<string,string>={})=>new Request('http://localhost/api',{method:'POST',body,headers,duplex:'half'} as RequestInit);

test('bounded body: exact limit passes, one byte over fails, whatever the declared length',async()=>{
 const exact=await readBoundedBody(streamed(chunks([60,40])),100);
 assert.ok(exact.ok&&exact.bytes.length===100);
 assert.deepEqual(await readBoundedBody(streamed(chunks([60,41])),100),{ok:false,reason:'too_large'});
 // Understated, malformed and absent Content-Length are all counted.
 assert.deepEqual(await readBoundedBody(streamed(chunks([150]),{'content-length':'10'}),100),{ok:false,reason:'too_large'});
 assert.deepEqual(await readBoundedBody(streamed(chunks([150]),{'content-length':'abc'}),100),{ok:false,reason:'too_large'});
 const small=await readBoundedBody(streamed(chunks([5]),{'content-length':'abc'}),100);
 assert.ok(small.ok&&small.bytes.length===5);
 // An overstated length is refused before reading anything.
 const declared=streamed(chunks([500]),{'content-length':'101'});
 assert.deepEqual(await readBoundedBody(declared,100),{ok:false,reason:'too_large'});
 assert.equal(declared.bodyUsed,false);
 // The reader is cancelled as soon as the limit is passed.
 let cancelled=false;
 const endless=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(64));},cancel(){cancelled=true;}});
 assert.deepEqual(await readBoundedBody(streamed(endless),100),{ok:false,reason:'too_large'});
 assert.equal(cancelled,true);
 // No body at all is an empty, readable body.
 const empty=await readBoundedBody(new Request('http://localhost/api',{method:'POST'}),100);
 assert.ok(empty.ok&&empty.bytes.length===0);
});

test('public submission endpoint rejects an oversized multipart body without Content-Length before parsing',async()=>{
 const previous=process.env.NEXT_PUBLIC_DATA_BACKEND;process.env.NEXT_PUBLIC_DATA_BACKEND='local';
 try{
  const boundary='----munos';
  const part=(name:string,value:string)=>`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const multipart=(title:string)=>`${part('padding',title)}--${boundary}--\r\n`;
  const type={'content-type':`multipart/form-data; boundary=${boundary}`};
  const encode=(text:string)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(text));c.close();}});
  // The audit's reproduction: ~70 KB, no Content-Length. Before the fix this reached validation.
  const big=multipart('x'.repeat(70_000));
  const tooLarge=await submit(streamed(encode(big),type));
  assert.equal(tooLarge.status,413);
  assert.equal((await tooLarge.json()).error,'too_large');
  assert.equal(tooLarge.headers.get('Cache-Control'),'no-store');
  // A misleading small Content-Length is not trusted either.
  assert.equal((await submit(streamed(encode(big),{...type,'content-length':'100'}))).status,413);
  // A body exactly at the limit is parsed and reaches validation (not 413).
  const filler=MAX_SUBMISSION_BODY-new TextEncoder().encode(multipart('')).length;
  const atLimit=multipart('x'.repeat(filler));
  assert.equal(new TextEncoder().encode(atLimit).length,MAX_SUBMISSION_BODY);
  assert.notEqual((await submit(streamed(encode(atLimit),type))).status,413);
  assert.equal((await submit(streamed(encode(multipart('x'.repeat(filler+1))),type))).status,413);
  // A body that is not multipart is a missing source, as before.
  assert.equal((await submit(streamed(encode('not a form'),{'content-type':'text/plain'}))).status,400);
 }finally{if(previous===undefined)delete process.env.NEXT_PUBLIC_DATA_BACKEND;else process.env.NEXT_PUBLIC_DATA_BACKEND=previous;}
});

test('public amendment endpoint keeps its 32 KB bound for streamed bodies',async()=>{
 const previous=process.env.NEXT_PUBLIC_DATA_BACKEND;process.env.NEXT_PUBLIC_DATA_BACKEND='local';
 try{
  assert.equal((await amend(streamed(chunks([20_000,20_000])))).status,413);
  assert.equal((await amend(streamed(chunks([10])))).status,400,'not JSON');
 }finally{if(previous===undefined)delete process.env.NEXT_PUBLIC_DATA_BACKEND;else process.env.NEXT_PUBLIC_DATA_BACKEND=previous;}
});
