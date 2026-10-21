import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {freshDatabase} from './helpers/database';

// Replays the cumulative run order of docs/NUMBERING_HOSTED_VERIFICATION.md section 8.2 on a local database: the setup SQL of 8.1
// is read from the document (with real digests), Chair devices redeem their codes, and every step's expected numbers are asserted.
// Concurrent steps are sequential stand-ins here (the real-connection race is tests/sequential-chair-numbering-concurrency.test.ts).
test('the verification run order produces the numbers the document promises',{timeout:180000},async()=>{
 const {db}=await freshDatabase();
 const doc=await readFile('docs/NUMBERING_HOSTED_VERIFICATION.md','utf8');
 let setup=/```sql\n(do \$setup\$[\s\S]*?)```/.exec(doc)![1];
 const raws:Record<string,string>={};
 for(const k of ['Executive','TST','BND','BRW']){raws[k]=randomBytes(12).toString('hex').toUpperCase();setup=setup.replace(`<sha256 digest of the ${k==='Executive'?'Executive':k+' Chair'} code>`,createHash('sha256').update(raws[k]).digest('hex'));}
 assert.ok(!setup.includes('<sha256'),'every digest placeholder is replaced');
 await db.exec(setup);
 const q=async<T=Record<string,unknown>>(sql:string,p:unknown[]=[])=>(await db.query<T>(sql,p)).rows;
 const conf=(await q<{id:string}>(`select id from public.conferences where name like 'DCMUN Development Test (temporary numbering check)%'`))[0].id;
 const cm:Record<string,string>={};for(const r of await q<{id:string;code:string}>('select id,code from public.committees where conference_id=$1',[conf]))cm[r.code]=r.id;
 const info=async(code:string)=>({committee:cm[code],
  session:(await q<{id:string}>('select id from public.sessions where committee_id=$1',[cm[code]]))[0].id,
  delegate:(await q<{id:string}>('select id from public.delegates where committee_id=$1 order by email limit 1',[cm[code]]))[0].id,
  token:(await q<{token:string}>('select token from public.submission_links where committee_id=$1',[cm[code]]))[0].token});
 const I={TST:await info('TST'),BND:await info('BND'),BRW:await info('BRW')};
 const device=async(code:string)=>{const u=randomUUID();await db.exec(`reset role; insert into auth.users values('${u}'); select set_config('request.jwt.claim.sub','${u}',false); set role authenticated;`);
  const r=await q<{r:{status:string}}>('select public.redeem_access_code($1,$2) r',[conf,raws[code].match(/.{4}/g)!.join('-')]);assert.equal(r[0].r.status,'ok');await db.exec('reset role');return u;};
 const dev={TST:[await device('TST'),await device('TST'),await device('TST')],BND:[await device('BND')],BRW:[await device('BRW'),await device('BRW')]};
 const chair=async(code:'TST'|'BND'|'BRW',u:string,mutation=randomUUID(),title='Draft')=>{const i=I[code];
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${u}',false); set role authenticated;`);
  try{await db.query('select public.apply_conference_mutation($1,$2,$3,$4,null,$5)',[conf,mutation,JSON.stringify({type:'newDocument',committeeId:i.committee,sessionId:i.session,title,submitterId:i.delegate}),'chair','2026-10-21T10:00:00Z']);}finally{await db.exec('reset role');}return mutation;};
 const pub=async(code:'TST'|'BND'|'BRW',submission=randomUUID(),docId=randomUUID().replaceAll('-','').padEnd(30,'x'))=>{const i=I[code];
  await db.exec('reset role; set role service_role;');
  const r=await q<{r:{code:string;status:string}}>('select public.submit_resolution($1,$2,$3,$4,$5,null,null,null,null) r',[i.token,submission,i.delegate,'Protecting civilians online',docId]);
  await db.exec('reset role');return r[0].r;};
 const seq=async(code:string)=>(await q<{code:string}>('select code from public.documents where committee_id=$1',[cm[code]])).map(r=>r.code).filter(c=>/ \/ \d{2,6}$/.test(c)).map(c=>Number(c.split(' / ')[1])).sort((a,b)=>a-b);
 const expectNew=async(code:string,before:number[],from:number,to:number,label:string)=>assert.deepEqual((await seq(code)).filter(n=>!before.includes(n)),Array.from({length:to-from+1},(_,i)=>from+i),label);

 let b=await seq('TST');for(let i=0;i<3;i++)await chair('TST',dev.TST[0]);await expectNew('TST',b,1,3,'T1');
 const sub=randomUUID(),docId=randomUUID().replaceAll('-','').padEnd(30,'x');
 let r=await pub('TST',sub,docId);assert.equal(r.code,'TST / 04');
 r=await pub('TST',sub,docId);assert.equal(r.status,'replayed');assert.equal(r.code,'TST / 04');assert.equal((await seq('TST')).length,4,'T2');
 await db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values(gen_random_uuid(),$1,$2,$3,$4,'TST / ca7640bb','Legacy'),(gen_random_uuid(),$1,$2,$3,$4,'TST / 12345678','Legacy')`,[conf,cm.TST,I.TST.session,I.TST.delegate]);
 b=await seq('TST');await chair('TST',dev.TST[1]);await expectNew('TST',b,5,5,'T3');
 b=await seq('TST');for(let i=0;i<8;i++)await chair('TST',dev.TST[i%3]);await expectNew('TST',b,6,13,'T4');
 b=await seq('TST');for(let i=0;i<4;i++){await chair('TST',dev.TST[i%3]);await pub('TST');}await expectNew('TST',b,14,21,'T5');
 const m1=randomUUID(),m2=randomUUID();
 b=await seq('TST');for(let i=0;i<5;i++)await chair('TST',dev.TST[0],m1);await expectNew('TST',b,22,22,'T6 first id');
 b=await seq('TST');for(let i=0;i<5;i++)await chair('TST',dev.TST[1],m2);await expectNew('TST',b,23,23,'T6 second id');
 b=await seq('TST');await chair('TST',dev.TST[2]);await expectNew('TST',b,24,24,'T7');
 await assert.rejects(()=>chair('TST',dev.TST[0],m1,'Different title'),/Idempotency key reused/);
 await assert.rejects(()=>chair('BND',dev.TST[0]),/no access/i);
 await db.query(`insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) select gen_random_uuid(),$1,$2,$3,$4,'BND / '||lpad(g::text,2,'0'),'Seed' from generate_series(1,98) g`,[conf,cm.BND,I.BND.session,I.BND.delegate]);
 await chair('BND',dev.BND[0]);assert.equal((await pub('BND')).code,'BND / 100');await chair('BND',dev.BND[0]);
 const bnd=(await q<{code:string}>('select code from public.documents where committee_id=$1',[cm.BND])).map(r=>r.code);
 assert.ok(bnd.includes('BND / 99')&&bnd.includes('BND / 100')&&bnd.includes('BND / 101'));assert.equal(bnd.filter(c=>c==='BND / 10').length,1,'the seeded /10 only');
 b=await seq('BRW');for(let i=0;i<3;i++)await chair('BRW',dev.BRW[0]);await expectNew('BRW',b,1,3,'W1');
 b=await seq('BRW');await chair('BRW',dev.BRW[1]);await expectNew('BRW',b,4,4,'W2');
 b=await seq('BRW');await chair('BRW',dev.BRW[0]);await chair('BRW',dev.BRW[1]);await expectNew('BRW',b,5,6,'W3');
 b=await seq('BRW');assert.equal((await pub('BRW')).code,'BRW / 07');
 const all=(await q<{code:string}>('select code from public.documents where conference_id=$1',[conf])).map(r=>r.code);assert.equal(new Set(all).size,all.length,'S5');
});
