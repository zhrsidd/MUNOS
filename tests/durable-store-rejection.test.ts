import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableRepository} from '../lib/sync/repository';
import {DurableStore} from '../lib/sync/store';
import {createSeed} from '../lib/seed';

const transactionEvents = () => new Promise(resolve => setTimeout(resolve, 20));

test('a stale local tab rejects once, keeps the newer attendance, and leaves storage usable', async () => {
  const store = new DurableStore(`stale-tab-${crypto.randomUUID()}`);
  const first = new DurableRepository('ga1', createSeed, store);
  const stale = new DurableRepository('ga1', createSeed, store);
  try {
    await first.ready(); await stale.ready();
    await first.execute({type: 'attendance', delegateId: 'd0', sessionId: 's1', status: 'Absent'}, 'chair');
    await assert.rejects(stale.execute({type: 'attendance', delegateId: 'd0', sessionId: 's1', status: 'Present & Voting'}, 'chair'), /Another tab updated this item/);
    // A rejected transaction must not emit a second, unhandled AbortError after the handled save failure.
    await transactionEvents();
    const saved = await store.read('ga1');
    assert.equal(saved?.base.attendance.find(a => a.delegateId === 'd0' && a.sessionId === 's1')?.status, 'Absent');
    assert.deepEqual(saved?.pending, []);
    await first.execute({type: 'attendance', delegateId: 'd1', sessionId: 's1', status: 'Absent'}, 'chair');
    assert.equal((await store.read('ga1'))?.base.attendance.find(a => a.delegateId === 'd1' && a.sessionId === 's1')?.status, 'Absent');
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
