import test from 'node:test';
import assert from 'node:assert/strict';
import {nextResolutionCode} from '../lib/resolution-number';
import {displayResolutionCode} from '../lib/resolution-identity';
import {applyCommand} from '../lib/commands';
import type {Mutation} from '../lib/sync/store';
import {createSeed} from '../lib/seed';

test('numbers continue after the highest sequential code and ignore legacy hex codes',()=>{
 assert.equal(nextResolutionCode('TST',[]),'TST / 01');
 assert.equal(nextResolutionCode('TST',[{code:'TST / 01'},{code:'TST / 02'}]),'TST / 03');
 assert.equal(nextResolutionCode('TST',[{code:'TST / ca7640bb'},{code:'TST / 12345678'}]),'TST / 01');
 assert.equal(nextResolutionCode('TST',[{code:'TST / ca7640bb'},{code:'TST / 07'}]),'TST / 08');
 assert.equal(nextResolutionCode('TST',[{code:'TST / 99'}]),'TST / 100');
 assert.equal(nextResolutionCode('TST',[{code:'TST / 01'}],new Set(['TST / 02'])),'TST / 03');
});

test('legacy and sequential codes display the same way',()=>{
 assert.equal(displayResolutionCode('TST / 03'),'TST/03');
 assert.equal(displayResolutionCode('TST / ca7640bb'),'TST/ca7640bb');
});

test('the demo reducer numbers Chair drafts like the hosted helper and ignores legacy codes',()=>{
 const before=createSeed();
 const committee=before.committees[0];
 const own=before.documents.filter(d=>d.committeeId===committee.id);
 const legacy={...own[0],id:'legacy-hex',code:`${committee.code} / ca7640bb`};
 const data={...before,documents:[...before.documents,legacy]};
 const session=data.sessions.find(s=>s.committeeId===committee.id)!,delegate=data.delegates.find(d=>d.committeeId===committee.id)!;
 const command={type:'newDocument' as const,committeeId:committee.id,sessionId:session.id,title:'Draft',submitterId:delegate.id};
 const after=applyCommand(data,command,'chair',{id:'m1',actorId:'chair-demo'} as Mutation);
 const created=after.documents.at(-1)!;
 assert.equal(created.code,nextResolutionCode(committee.code,own));
 assert.notEqual(created.code,legacy.code);
 const again=applyCommand(after,command,'chair',{id:'m2',actorId:'chair-demo'} as Mutation);
 assert.notEqual(again.documents.at(-1)!.code,created.code,'the next draft takes the next number');
 assert.ok(again.documents.some(d=>d.code===legacy.code),'the legacy code is untouched');
});
