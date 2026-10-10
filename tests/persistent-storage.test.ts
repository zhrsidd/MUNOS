import test from 'node:test';
import assert from 'node:assert/strict';
import {persistentStorageRequester} from '../lib/platform/persistent-storage';
import {isPublicPath} from '../components/conference-shell';

function fakeStorage(persist:()=>Promise<boolean>,persisted?:()=>Promise<boolean>){
 const calls={persist:0,persisted:0};
 return{calls,manager:{persist:()=>{calls.persist++;return persist();},...(persisted?{persisted:()=>{calls.persisted++;return persisted();}}:{})}};
}

test('active staff access requests persistent storage once per page load',async()=>{
 const {calls,manager}=fakeStorage(async()=>true,async()=>false);
 const request=persistentStorageRequester(()=>manager);
 assert.equal(await request({status:'active'}),true);
 assert.equal(await request({status:'active'}),undefined,'never repeated on later renders');
 assert.equal(calls.persist,1);
});

test('already persistent storage is not requested again',async()=>{
 const {calls,manager}=fakeStorage(async()=>true,async()=>true);
 assert.equal(await persistentStorageRequester(()=>manager)({status:'active'}),true);
 assert.equal(calls.persist,0);
});

test('non-staff, demo, loading and signed-out access never request persistent storage',async()=>{
 const {calls,manager}=fakeStorage(async()=>true);
 const request=persistentStorageRequester(()=>manager);
 for(const status of ['loading','demo','signedOut','noAccess','unavailable'] as const)assert.equal(await request({status}),undefined);
 assert.equal(calls.persist,0);
 // Public delegate QR pages bypass the staff provider entirely (components/conference-shell.tsx).
 assert.equal(isPublicPath('/submit/abc'),true);assert.equal(isPublicPath('/amend/abc'),true);
});

test('unsupported, denied or failing storage APIs are harmless',async()=>{
 assert.equal(await persistentStorageRequester(()=>undefined)({status:'active'}),undefined,'no navigator.storage');
 assert.equal(await persistentStorageRequester(()=>({} as never))({status:'active'}),undefined,'no persist()');
 assert.equal(await persistentStorageRequester(()=>fakeStorage(async()=>false).manager)({status:'active'}),false,'browser declined');
 assert.equal(await persistentStorageRequester(()=>fakeStorage(async()=>{throw Error('SecurityError');}).manager)({status:'active'}),false,'rejection swallowed');
 assert.equal(await persistentStorageRequester(()=>{throw Error('no storage');})({status:'active'}),false,'accessor failure swallowed');
});

test('a browser that never answers does not block the caller',async()=>{
 const {manager}=fakeStorage(()=>new Promise<boolean>(()=>{}));
 const request=persistentStorageRequester(()=>manager);
 let settled=false;void request({status:'active'}).then(()=>{settled=true;});
 // The UI fires and forgets: control returns immediately while the browser decides.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);
});
