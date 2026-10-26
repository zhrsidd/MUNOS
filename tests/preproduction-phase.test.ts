import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPreproductionPhase} from '../scripts/preproduction-phase.mjs';
const ref='testtesttesttesttest',url=`https://${ref}.supabase.co`,env={STAGING_SUPABASE_REFS:ref};
test('phase guard checks the committed target before any network and accepts only fresh matching preproduction metadata',async()=>{
 let calls=0;let payload:unknown={projectRef:ref,phase:'preproduction',revision:1,canTest:true};
 const fetcher=(async(input,init)=>{calls++;assert.equal(String(input),`${url}/rest/v1/rpc/preproduction_status`);assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');assert.ok(!JSON.stringify(init).includes('Bearer'));return Response.json(payload);}) as typeof fetch;
 await assert.rejects(assertPreproductionPhase('https://unknownunknownunknow1.supabase.co','pk',{STAGING_SUPABASE_REFS:'unknownunknownunknow1'},fetcher));assert.equal(calls,0);
 await assert.rejects(assertPreproductionPhase('https://gglltljhdpkfjnyjmnif.supabase.co','pk',env,fetcher));assert.equal(calls,0);
 await assert.rejects(assertPreproductionPhase(url,'',env,fetcher));assert.equal(calls,0);
 assert.equal((await assertPreproductionPhase(url,'pk',env,fetcher)).phase,'preproduction');
 for(const bad of [null,{}, {projectRef:ref,phase:'production',revision:2,canTest:false}, {projectRef:ref,phase:'unknown',revision:1,canTest:true}, {projectRef:'bad',phase:'rehearsal',revision:1,canTest:true}, {projectRef:ref,phase:'rehearsal',revision:0,canTest:true}, {projectRef:ref,phase:'rehearsal',revision:1,canTest:false}]){payload=bad;await assert.rejects(assertPreproductionPhase(url,'pk',env,fetcher));}
 await assert.rejects(assertPreproductionPhase(url,'pk',env,async()=>{throw Error('transport failure')}),/unavailable/);
});
