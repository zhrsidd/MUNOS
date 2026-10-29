import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForSpeechFinish} from '../scripts/rehearsal/speech-finish.mjs';
import {project} from '../lib/sync/repository';
import {createSeed} from '../lib/seed';
import type {Checkpoint} from '../lib/sync/store';

test('speech navigation waits for the actual Chair heading and this speech in the durable checkpoint', async () => {
  let showChair!: () => void, saveFinish!: (data: unknown) => void, readAgain!: () => void;
  const heading = new Promise<void>(resolve => {showChair = resolve;});
  const saved = new Promise(resolve => {saveFinish = resolve;});
  const secondRead = new Promise<void>(resolve => {readAgain = resolve;});
  let reads = 0, completed = false;
  const page = {getByRole: (role: string, options: unknown) => {
    assert.equal(role, 'heading'); assert.deepEqual(options, {name: 'The floor is with the Chair', exact: true});
    return {waitFor: () => heading};
  }};
  const result = waitForSpeechFinish(page, async () => {
    if (++reads === 1) return {speeches: [{id: 'current', state: 'speaking'}, {id: 'older', state: 'finished'}]};
    readAgain(); return saved;
  }, 'current', {every: 1}).then(() => {completed = true;});
  await Promise.resolve(); assert.equal(reads, 0, 'unrelated empty-queue copy cannot stand in for the Chair heading');
  showChair(); await secondRead;
  assert.equal(completed, false, 'even the heading cannot stand in for a durable finished state');
  saveFinish({speeches: [{id: 'current', state: 'finished'}]});
  await result; assert.equal(completed, true);
});

test('a missing finish fails instead of silently allowing navigation', async () => {
  const page = {getByRole: () => ({waitFor: async () => {}})};
  await assert.rejects(waitForSpeechFinish(page, async () => ({speeches: [{id: 'other', state: 'finished'}]}), 'current', {timeout: 5, every: 1}), /not committed to the device checkpoint/);
});

test('offline completion uses the persisted outbox projection without requiring a server read', async () => {
  const base = createSeed();
  base.speeches = [{id: 'speech', committeeId:'ga1', delegateId: 'd0', resolutionId: 'r1', classification: 'Other', yieldedFrom: null, state: 'speaking', poiLimit: null, poiCount: 0, revision: 0, createdAt: new Date().toISOString()}];
  const checkpoint: Checkpoint = {key: 'offline', base, savedAt: new Date().toISOString(), pending: [{id: 'finish', actorId: 'chair', role: 'chair', state: 'pending', expected: '0', createdAt: new Date().toISOString(), command: {type: 'speechFinish', committeeId:'ga1', speechId: 'speech'}}]};
  await waitForSpeechFinish({getByRole: () => ({waitFor: async () => {}})}, async () => project(checkpoint), 'speech', {timeout: 5});
  assert.equal(checkpoint.base.speeches?.[0]?.state, 'speaking', 'authoritative base has not changed while offline');
  assert.equal(checkpoint.pending.length, 1, 'the finish is still durably queued for later sync');
});
