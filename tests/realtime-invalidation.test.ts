import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '../lib/domain';
import { createSeed } from '../lib/seed';
import { SupabaseTransport } from '../lib/supabase/repository';
import { DurableRepository } from '../lib/sync/repository';
import { DurableStore } from '../lib/sync/store';

type Notification = { new: { conference_id: string; committee_id: string | null; topic?: string } };
class MockChannel {
  filter = '';
  onChange?: (payload: Notification) => void;
  onStatus?: (status: string) => void;
  constructor(private connectImmediately: boolean) {}
  on(event: string, options: { event: string; schema: string; table: string; filter: string }, callback: (payload: Notification) => void) {
    assert.equal(event, 'postgres_changes');
    assert.deepEqual({ event: options.event, schema: options.schema, table: options.table }, { event: 'INSERT', schema: 'public', table: 'operational_changes' });
    this.filter = options.filter;
    this.onChange = callback;
    return this;
  }
  subscribe(callback: (status: string) => void) {
    this.onStatus = callback;
    if (this.connectImmediately) callback('SUBSCRIBED');
    return this;
  }
  // Emulate the existing server-side filter, without attributing that filtering to the client.
  deliver(payload: Notification) {
    const [field, expected] = this.filter.split('=eq.');
    if (payload.new[field as 'conference_id' | 'committee_id'] === expected) this.onChange?.(payload);
  }
}
function harness(roles: readonly Role[], committeeIds: string[] = [], connectImmediately = false) {
  const channels: MockChannel[] = [];
  const removed: MockChannel[] = [];
  let reads = 0;
  const client = {
    channel() { const channel = new MockChannel(connectImmediately); channels.push(channel); return channel; },
    async removeChannel(channel: MockChannel) { removed.push(channel); },
    async rpc(name: string) {
      if (name === 'conference_snapshot') { reads++; return { data: createSeed(), error: null }; }
      assert.equal(name, 'operations_snapshot');
      return { data: {}, error: null };
    },
  } as unknown as SupabaseClient;
  return {
    transport: new SupabaseTransport(client, 'conference-test', 'staff-test', committeeIds, false, roles),
    channels, removed, reads: () => reads,
    emit(topic: string | undefined, committeeId: string | null = 'ga1') {
      channels.forEach(channel => channel.deliver({ new: { conference_id: 'conference-test', committee_id: committeeId, topic } }));
    },
  };
}

test('Realtime SUBSCRIBED reports connection without scheduling a second invalidation', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(['chair'], ['ga1', 'sc']);
  const states: boolean[] = [];
  let refreshes = 0;
  const stop = h.transport.subscribe(() => { refreshes++; }, state => states.push(state));
  try {
    h.channels[0].onStatus?.('SUBSCRIBED');
    h.channels[1].onStatus?.('SUBSCRIBED');
    assert.deepEqual(states, [false, true]);
    t.mock.timers.tick(1000);
    assert.equal(refreshes, 0);
    h.channels[1].onStatus?.('CHANNEL_ERROR');
    h.channels[1].onStatus?.('SUBSCRIBED');
    assert.deepEqual(states, [false, true, false, true]);
    t.mock.timers.tick(1000);
    assert.equal(refreshes, 0, 'reconnect also reconciles through the state callback only');
  } finally { stop(); }
  assert.equal(h.removed.length, 2);
});

for (const roles of [['approval'], ['logistics'], ['approval', 'logistics']] as Role[][]) {
  test(`${roles.join('/')} ignores Chair notifications but refreshes document and configuration changes`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness(roles);
    let refreshes = 0;
    const stop = h.transport.subscribe(() => { refreshes++; }, () => {});
    try {
      assert.equal(h.channels[0].filter, 'conference_id=eq.conference-test');
      for (let i = 0; i < 20; i++) h.emit('chair');
      t.mock.timers.tick(1000);
      assert.equal(refreshes, 0);
      for (const topic of ['documents', 'configuration']) {
        h.emit(topic, null);
        t.mock.timers.tick(349);
        assert.equal(refreshes, topic === 'documents' ? 0 : 1);
        // Ignored Chair traffic must not postpone a relevant pending refresh.
        h.emit('chair');
        t.mock.timers.tick(1);
        assert.equal(refreshes, topic === 'documents' ? 1 : 2);
      }
      h.emit(undefined);
      t.mock.timers.tick(350);
      assert.equal(refreshes, 3, 'unknown or missing topics are conservatively retained');
      h.emit('documents');
    } finally { stop(); }
    t.mock.timers.tick(350);
    assert.equal(refreshes, 3, 'unsubscribe clears pending debounce');
  });
}

test('Chairs retain committee subscriptions and reconcile relevant Chair notifications', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(['chair'], ['ga1', 'sc']);
  let refreshes = 0;
  const stop = h.transport.subscribe(() => { refreshes++; }, () => {});
  try {
    assert.deepEqual(h.channels.map(channel => channel.filter), ['committee_id=eq.ga1', 'committee_id=eq.sc']);
    h.emit('chair', 'hrc');
    t.mock.timers.tick(350);
    assert.equal(refreshes, 0, 'unassigned committees remain excluded by the subscription filters');
    h.emit('chair', 'ga1');
    h.emit('chair', 'sc');
    t.mock.timers.tick(350);
    assert.equal(refreshes, 1, 'bursts across assigned committees are still batched');
    h.emit('documents', 'ga1');
    t.mock.timers.tick(350);
    assert.equal(refreshes, 2);
  } finally { stop(); }
});

for (const roles of [['admin'], ['admin', 'approval'], ['chair', 'approval'], []] as Role[][]) {
  test(`${roles.join('/') || 'missing role metadata'} keeps all notification topics`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness(roles);
    let refreshes = 0;
    const stop = h.transport.subscribe(() => { refreshes++; }, () => {});
    try {
      for (const topic of ['chair', 'documents', 'configuration', 'future-topic']) {
        h.emit(topic);
        t.mock.timers.tick(350);
      }
      assert.equal(refreshes, 4);
      assert.equal(h.channels[0].filter, 'conference_id=eq.conference-test');
    } finally { stop(); }
  });
}

async function settleUntil(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'repository reconciliation should settle');
}

test('repository startup and Realtime connection perform one reconciliation, without a delayed duplicate', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const h = harness(['approval'], [], true);
  const store = new DurableStore(`realtime-startup-${crypto.randomUUID()}`);
  const repo = new DurableRepository('conference-test', createSeed, store, h.transport);
  try {
    await repo.ready();
    await settleUntil(() => !!repo.getHealth().lastSynced && repo.getHealth().state === 'saved');
    assert.equal(repo.getHealth().realtime, true);
    assert.equal(h.reads(), 1, 'startup flush and synchronous connection retry share the in-flight sync');
    t.mock.timers.tick(350);
    // Drain real IndexedDB tasks so a delayed invalidation cannot hide behind asynchronous storage.
    for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.reads(), 1, 'SUBSCRIBED must not schedule a duplicate read after debounce');
    h.emit('chair');
    t.mock.timers.tick(350);
    for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.reads(), 1);
    h.emit('documents');
    t.mock.timers.tick(350);
    await settleUntil(() => h.reads() === 2 && repo.getHealth().state === 'saved');
    assert.equal(h.reads(), 2);
    h.channels[0].onStatus?.('CHANNEL_ERROR');
    assert.equal(repo.getHealth().realtime, false);
    h.channels[0].onStatus?.('SUBSCRIBED');
    await settleUntil(() => h.reads() === 3 && repo.getHealth().state === 'saved');
    t.mock.timers.tick(350);
    for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.reads(), 3, 'reconnect reconciles once without a delayed duplicate');
  } finally {
    repo.dispose();
    await store.close();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
