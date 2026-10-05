import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../lib/commands';
import {createSeed} from '../lib/seed';
import {isOperationsCommand,newSubmissionToken} from '../lib/operations/commands';
const meta=(id=crypto.randomUUID())=>({id,createdAt:'2026-11-12T08:00:00.000Z',actorId:'exec'});
test('submission link commands project locally with server-matching ids and respect roles',()=>{
 let d=createSeed();const token=newSubmissionToken('ga1');assert.match(token,/^[A-Za-z0-9_-]{22}$/);
 assert.match(newSubmissionToken('ga1',true),/^demo_ga1_[0-9a-f]{22}$/);
 assert.throws(()=>applyCommand(d,{type:'submissionLink',action:'create',committeeId:'ga1',token},'chair'),/role boundary/);
 const m=meta();d=applyCommand(d,{type:'submissionLink',action:'create',committeeId:'ga1',token,contact:'help@example.com'},'admin',m);
 assert.equal(d.submissionLinks!.length,1);assert.equal(d.submissionLinks![0].id,m.id.slice(0,24)+'000000000001','same derived id as the database');
 const rotated=newSubmissionToken('ga1');d=applyCommand(d,{type:'submissionLink',action:'rotate',committeeId:'ga1',token:rotated},'admin',meta());
 assert.deepEqual(d.submissionLinks!.map(l=>l.token),[rotated],'one active link per committee');
 d=applyCommand(d,{type:'submissionLink',action:'revoke',committeeId:'ga1'},'admin',meta());assert.equal(d.submissionLinks!.length,0);
 assert.throws(()=>applyCommand(d,{type:'submissionLink',action:'create',committeeId:'ga1',token:'short'},'admin'),/Invalid submission link/);
 assert.ok(isOperationsCommand({type:'submissionLink'}));assert.ok(!isOperationsCommand({type:'attendance'}));
});
