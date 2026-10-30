import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freshDatabase} from './helpers/database';

// The SQL twin of tests/session-window.test.ts: the same vectors, run against real PostgreSQL with every migration applied.
type Json=Record<string,unknown>;
const vectors=JSON.parse(readFileSync('tests/fixtures/session-window-vectors.json','utf8')) as {
 timeZone:string;
 schedules:Record<string,{leadMinutes:number;graceMinutes:number;sessions:unknown[];dayClose?:Json;windows:{sessionId:string;start:string;end:string}[]}>;
 windowCases:{name:string;schedule:string;at:string;expect:Json}[];
 validation:{name:string;sessions:unknown[];leadMinutes:number;graceMinutes:number;errors:string[]}[];
 resolveCases:{name:string;versions:unknown[];overrides:unknown[];committeeId:string;at:string;dayClose?:Json;expect:Json}[];
 overrideExpiryCases:{name:string;versions:unknown[];setAt:string;expect:string|null}[];
};
const instant=(v:unknown)=>v==null?v:new Date(v as string).toISOString();
const timeKeys=new Set(['windowStart','windowEnd','nextSwitchAt']);

test('real PostgreSQL: the session window functions match the shared vectors, and are not API-callable',async()=>{
 const {db,asOwner,as,grant,ids}=await freshDatabase();
 try{
  await asOwner();
  const one=async<T>(sql:string,p:unknown[]):Promise<T>=>(await db.query<{r:T}>(sql,p)).rows[0].r;
  const windows=(s:{leadMinutes:number;graceMinutes:number;sessions:unknown[];dayClose?:Json})=>
   one<{sessionId:string;start:string;end:string}[]>('select private.session_windows($1::jsonb,$2,$3,$4::jsonb,$5) r',[JSON.stringify(s.sessions),s.leadMinutes,s.graceMinutes,s.dayClose?JSON.stringify(s.dayClose):null,vectors.timeZone]);

  for(const [name,s] of Object.entries(vectors.schedules)){
   const got=(await windows(s)).map(w=>({...w,start:instant(w.start),end:instant(w.end)}));
   assert.deepEqual(got,s.windows.map(w=>({...w,start:instant(w.start),end:instant(w.end)})),`schedule ${name}`);
  }

  // Point-in-time vectors go through session_resolve with a single always-on version (the window rule alone).
  for(const c of vectors.windowCases){
   const s=vectors.schedules[c.schedule];
   const version={effectiveFrom:'2026-01-01T00:00:00Z',leadMinutes:s.leadMinutes,graceMinutes:s.graceMinutes,automationEnabled:true,sessions:s.sessions};
   const r=await one<Json>('select private.session_resolve($1::jsonb,$2::jsonb,$3::jsonb,$4,$5::timestamptz,$6) r',[JSON.stringify([version]),'[]',s.dayClose?JSON.stringify(s.dayClose):null,'ga1',c.at,vectors.timeZone]);
   for(const [key,want] of Object.entries(c.expect))
    assert.equal(timeKeys.has(key)?instant(r[key]):r[key],timeKeys.has(key)?instant(want):want,`${c.name}: ${key}`);
  }

  for(const c of vectors.validation)
   assert.deepEqual(await one<string[]>('select private.session_schedule_errors($1::jsonb,$2,$3) r',[JSON.stringify(c.sessions),c.leadMinutes,c.graceMinutes]),c.errors,c.name);

  for(const c of vectors.resolveCases){
   const r=await one<Json>('select private.session_resolve($1::jsonb,$2::jsonb,$3::jsonb,$4,$5::timestamptz,$6) r',[JSON.stringify(c.versions),JSON.stringify(c.overrides),c.dayClose?JSON.stringify(c.dayClose):null,c.committeeId,c.at,vectors.timeZone]);
   for(const [key,want] of Object.entries(c.expect))
    assert.equal(timeKeys.has(key)?instant(r[key]):r[key],timeKeys.has(key)?instant(want):want,`${c.name}: ${key}`);
  }

  for(const c of vectors.overrideExpiryCases){
   const r=await one<string|null>('select private.session_override_expiry($1::jsonb,$2::timestamptz,null,$3) r',[JSON.stringify(c.versions),c.setAt,vectors.timeZone]);
   assert.equal(instant(r),instant(c.expect),c.name);
  }

  // No API role may call them: they are internal helpers for later security-definer RPCs, not an API surface.
  const user='76000000-0000-4000-8000-000000000001';
  await grant(user,'chair',ids.ga1);
  for(const role of ['authenticated','anon','service_role']){
   await asOwner();
   const allowed=(await db.query<{ok:boolean}>(`select has_function_privilege($1,'private.session_windows(jsonb,int,int,jsonb,text)','execute') ok`,[role])).rows[0].ok;
   assert.equal(allowed,false,`${role} cannot execute private.session_windows`);
  }
  await as(user);
  await assert.rejects(()=>db.query(`select private.session_windows('[]'::jsonb,5,20,null,'Asia/Qatar')`),/permission denied/);
 }finally{await db.close();}
});
