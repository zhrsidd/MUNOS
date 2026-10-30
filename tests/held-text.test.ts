import test from 'node:test';
import assert from 'node:assert/strict';
import {clockItems,clockOffsetMs,describeHeld,heldByDevice,reasonText} from '../lib/sessions/held';
import {createSeed} from '../lib/seed';
import {navigationFor} from '../lib/navigation';
import type {HeldAction} from '../lib/operations/types';

const base=(over:Partial<HeldAction>):HeldAction=>({id:'h',committeeId:'c',deviceId:'dev',deviceSeq:1,actorId:'u',role:'chair',command:{type:'participation'},reason:'uncertain_time',state:'held',timeConfidence:'uncertain',
 receivedAt:'2026-11-05T09:00:00.000Z',clientTime:null,decidedBy:null,decidedAt:null,decisionReason:null,lastError:null,...over});

test('every hold reason has plain wording, and an unknown one still reads as held',()=>{
 for(const r of ['uncertain_time','outside_window','stale','behind_held','day_closed','revision_mismatch','actor_not_authorised','not_applicable'])assert.ok(reasonText(r).length>10,r);
 assert.equal(reasonText('something_new'),'Held for review');
});

test('a held command is described with its effect and the delegation it names',()=>{
 const data=createSeed(),d=data.delegates[0];
 assert.equal(describeHeld({command:{type:'participation',delegateId:d.id,points:2,categoryId:'speech'}},data),`Score · +2 · ${d.country}`);
 assert.equal(describeHeld({command:{type:'vote',delegateId:d.id,choice:'For'}},data),`Ballot · For · ${d.country}`);
 assert.equal(describeHeld({command:{type:'document',status:'In Debate'}},data),'Resolution status changed · → In Debate');
 assert.equal(describeHeld({command:{type:'pointAdjustment',amount:3,delegateId:d.id}},data),`Point adjustment · −3 · ${d.country}`);
 assert.equal(describeHeld({command:{type:'brandNew'}},data),'brandNew');
});

test('open items are grouped by device in the order the device made them; decided items are left out',()=>{
 const groups=heldByDevice([base({id:'b',deviceSeq:2}),base({id:'a',deviceSeq:1}),base({id:'x',deviceId:null,deviceSeq:null}),base({id:'done',state:'applied'}),base({id:'o',deviceId:'other',deviceSeq:1})]);
 assert.deepEqual(groups.map(g=>[g.deviceId,g.items.map(i=>i.id)]),[['dev',['a','b']],[null,['x']],['other',['o']]]);
});

test('only items held for the clock can be approved together',()=>{
 const items=[base({id:'1'}),base({id:'2',reason:'behind_held'}),base({id:'3',reason:'outside_window'}),base({id:'4',reason:'stale'})];
 assert.deepEqual(clockItems(items).map(i=>i.id),['1','2']);
});

test('the stated clock error is a signed number of minutes within a day',()=>{
 assert.equal(clockOffsetMs(-180),-10_800_000);assert.equal(clockOffsetMs(1.5),90_000);assert.equal(clockOffsetMs(0),0);
 assert.equal(clockOffsetMs(1441),null);assert.equal(clockOffsetMs(NaN),null);assert.equal(clockOffsetMs(Infinity),null);
});

test('the Executive can reach the review screen; Chairs and others cannot navigate to it',()=>{
 const slugs=(role:Parameters<typeof navigationFor>[0])=>navigationFor(role).flatMap(i=>[i.slug,...(i.children?.map(c=>c.slug)??[])]);
 assert.ok(slugs('admin').includes('held'));
 for(const role of ['chair','approval','logistics'] as const)assert.ok(!slugs(role).includes('held'),role);
});
