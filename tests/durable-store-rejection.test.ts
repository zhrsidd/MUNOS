import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableRepository} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';
import {createSeed} from '../lib/seed';

const transactionEvents = () => new Promise(resolve => setTimeout(resolve, 20));

test('a stale local tab rejects once, keeps the newer debate state, and leaves storage usable', async () => {
  const store = new DurableStore(`stale-tab-${crypto.randomUUID()}`);
  const first = new DurableRepository('ga1', createSeed, store);
  const stale = new DurableRepository('ga1', createSeed, store);
  try {
    await first.ready(); await stale.ready();
    await first.execute({type: 'debateMode', committeeId: 'ga1', mode: 'closed', phase: 'for'}, 'chair');
    await assert.rejects(stale.execute({type: 'debateMode', committeeId: 'ga1', mode: 'open', phase: 'for'}, 'chair'), /Another tab updated this item/);
    // A rejected transaction must not emit a second, unhandled AbortError after the handled save failure.
    await transactionEvents();
    const saved = await store.read('ga1');
    assert.equal(saved?.base.debateStates?.find(x => x.committeeId === 'ga1' && !x.sessionId)?.mode, 'closed');
    assert.deepEqual(saved?.pending, []);
    await first.execute({type: 'debateMode', committeeId: 'ga1', mode: 'closed', phase: 'against'}, 'chair');
    assert.equal((await store.read('ga1'))?.base.debateStates?.find(x => x.committeeId === 'ga1' && !x.sessionId)?.phase, 'against');
  } finally {first.dispose(); stale.dispose(); await store.close();}
});

test('a failed IndexedDB put preserves the checkpoint and reports the original save error', async () => {
  const store = new DurableStore(`failed-put-${crypto.randomUUID()}`);
  try {
    const before = await store.update('ga1', () => ({key: 'ga1', base: createSeed(), pending: [], savedAt: 'before'}));
    await assert.rejects(store.update('ga1', old => ({...old!, savedAt: (() => {}) as unknown as string})), {name: 'DataCloneError'});
    await transactionEvents();
    assert.deepEqual(await store.read('ga1'), before);
    await store.update('ga1', old => ({...old!, savedAt: 'after'}));
    assert.equal((await store.read('ga1'))?.savedAt, 'after');
  } finally {await store.close();}
});
