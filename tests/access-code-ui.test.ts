import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {StaffAccessGate} from '../components/staff-access';
import {redeemStaffCode,rotateAccessCode,revokeAccessCode,listAccessCodes} from '../lib/access-codes';
import {grantAccess} from '../lib/access';
function mock(session:unknown,status='ok'){
 const calls:{name:string;args?:unknown}[]=[];const client={auth:{getSession:async()=>{calls.push({name:'getSession'});return{data:{session},error:null};},signInAnonymously:async()=>{calls.push({name:'signInAnonymously'});return{data:{session:{user:{id:'new'}}},error:null};}},rpc:async(name:string,args:unknown)=>{calls.push({name,args});return{data:{status,code:'ONCE-ONLY'},error:null};}} as unknown as SupabaseClient;return{client,calls};
}
for(const existing of [null,{user:{id:'anonymous',is_anonymous:true}},{user:{id:'named'}}])test(`code redemption ${existing?'reuses identity':'creates identity only on submit'}`,async()=>{
 const {client,calls}=mock(existing);assert.equal(calls.length,0);assert.equal(await redeemStaffCode(client,'conference','RAW-CODE'),'ok');
 assert.equal(calls.filter(c=>c.name==='signInAnonymously').length,existing?0:1);
 assert.deepEqual(calls.at(-1),{name:'redeem_access_code',args:{conf:'conference',code:'RAW-CODE'}});
});
for(const status of ['invalid','rate_limited'] as const)test(`redemption returns ${status} without leaking code`,async()=>{const {client}=mock({user:{id:'a'}},status);assert.equal(await redeemStaffCode(client,'conference','SECRET'),status);});
test('empty input cannot create an anonymous identity',async()=>{const {client,calls}=mock(null);assert.equal(await redeemStaffCode(client,'conference',' '),'invalid');assert.deepEqual(calls,[]);});
test('access-code administration calls only existing RPCs, never the durable mutation/audit path',async()=>{
 const {client,calls}=mock({user:{id:'executive'}});assert.equal(await rotateAccessCode(client,'c','chair','ga1','2030-01-01T00:00:00Z'),'ONCE-ONLY');await revokeAccessCode(client,'c','credential',true);await listAccessCodes(client,'c');
 assert.deepEqual(calls.map(c=>c.name),['rotate_access_code','revoke_access_code','access_code_status']);assert.deepEqual(calls[1].args,{conf:'c',credential:'credential',revoke_devices:true});assert.deepEqual(calls[2].args,{conf:'c'});
});
for(const status of ['signedOut','noAccess'] as const)test(`${status} gate contains no editable staff workspace or password-login alternative`,()=>{
 const html=renderToStaticMarkup(createElement(StaffAccessGate,{access:{status,roles:[],committeeIds:[],actorId:status==='noAccess'?'actor':undefined}}));
 assert.match(html,/Staff access code/);assert.doesNotMatch(html,/Staff email|current-password|Roll call|Record Speech/);
 if(status==='noAccess')assert.match(html,/You are signed in, but you do not currently have access to this conference/);
});
test('mixed grants retain Chair committee scopes as well as granted workspace choices',()=>{
 const expires_at=new Date(Date.now()+3600000).toISOString();const a=grantAccess([{role:'chair',committee_id:'ga1',expires_at},{role:'approval',committee_id:null,expires_at}], 'actor');assert.deepEqual(a.roles,['chair','approval']);assert.deepEqual(a.committeeIds,['ga1']);
});
