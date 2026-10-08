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
function harness(roles: readonly Role[], committeeIds: string[] = [], connectImmediately = false, deferAuth = false) {
  const channels: MockChannel[] = [];
  const removed: MockChannel[] = [];
  let reads = 0;
  let authCalls = 0;
  const authArgs: number[] = [];
  let releaseAuth = () => {};
  const deferredAuth = deferAuth ? new Promise<void>(resolve => { releaseAuth = resolve; }) : null;
  // Most invalidation tests are about filtering/debouncing, not Promise scheduling. This
  // immediate thenable keeps those tests synchronous; the dedicated auth-race test below
  // uses a real deferred Promise to verify that channels cannot join before auth settles.
  const immediateAuth = {
    catch() { return this; },
    then(onFulfilled: () => void) { onFulfilled(); return Promise.resolve(); },
  };
  const client = {
    realtime: {
      setAuth(...args: unknown[]) {
        authCalls++;
        authArgs.push(args.length);
        return deferredAuth ?? immediateAuth;
      },
    },
    channel() { const channel = new MockChannel(connectImmediately); channels.push(channel); return channel; },
    async removeChannel(channel: MockChannel) { removed.push(channel); },
    async rpc(name: string) {
      if (['conference_state_snapshot', 'executive_state_snapshot', 'conference_snapshot', 'executive_snapshot'].includes(name)) { reads++; return { data: createSeed(), error: null }; }
      assert.equal(name, 'operations_snapshot');
      return { data: {}, error: null };
    },
  } as unknown as SupabaseClient;
  return {
    transport: new SupabaseTransport(client, 'conference-test', 'staff-test', committeeIds, false, roles),
    channels, removed, reads: () => reads,
    authCalls: () => authCalls,
    authArgs: () => authArgs,
    releaseAuth,
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

test('Realtime auth settles before the first channel joins, without handling raw tokens in the transport', async () => {
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const h = harness(['chair'], ['ga1'], false, true);
  const stop = h.transport.subscribe(() => {}, () => {});
  assert.equal(h.authCalls(), 1);
  assert.deepEqual(h.authArgs(), [0], 'setAuth is called without a token so Supabase keeps its auth callback as source of truth');
  assert.equal(h.channels.length, 0, 'no channel joins while Realtime auth is unresolved');
  h.releaseAuth();
  await settle();
  assert.equal(h.channels.length, 1, 'channel joins only after auth preparation settles');
  stop();
  assert.equal(h.removed.length, 1);

  const cancelled = harness(['chair'], ['ga1'], false, true);
  const cancel = cancelled.transport.subscribe(() => {}, () => {});
  cancel();
  cancelled.releaseAuth();
  await settle();
  assert.equal(cancelled.channels.length, 0, 'disposing during auth preparation cannot create a late subscription');
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

for (const roles of [['admin', 'approval'], ['chair', 'approval'], ['admin', 'admin'], []] as Role[][]) {
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

test('Executive Chair traffic uses a fixed two-second window that cannot be postponed', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(['admin']);
  let refreshes = 0;
  const stop = h.transport.subscribe(() => { refreshes++; }, () => {});
  try {
    h.emit('chair');
    t.mock.timers.tick(500);
    h.emit('chair');
    t.mock.timers.tick(1000);
    h.emit('chair');
    t.mock.timers.tick(499);
    assert.equal(refreshes, 0);
    h.emit('chair');
    t.mock.timers.tick(1);
    assert.equal(refreshes, 1, 'continuous Chair activity cannot extend the first event deadline');
    h.emit('chair');
    t.mock.timers.tick(1999);
    assert.equal(refreshes, 1);
    t.mock.timers.tick(1);
    assert.equal(refreshes, 2, 'the next event after reconciliation starts a fresh window');
    t.mock.timers.tick(5000);
    assert.equal(refreshes, 2, 'the Chair window is not a recurring timer');
  } finally { stop(); }
});

for (const topic of ['documents', 'configuration', 'future-topic', undefined]) {
  test(`Executive ${topic ?? 'missing topic'} stays fast and supersedes pending Chair refresh`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness(['admin']);
    let refreshes = 0;
    const stop = h.transport.subscribe(() => { refreshes++; }, () => {});
    try {
      h.emit('chair');
      t.mock.timers.tick(1000);
      h.emit(topic);
      t.mock.timers.tick(200);
      h.emit('chair');
      t.mock.timers.tick(149);
      assert.equal(refreshes, 0);
      t.mock.timers.tick(1);
      assert.equal(refreshes, 1, 'Chair events neither postpone the fast refresh nor add another timer');
      t.mock.timers.tick(3000);
      assert.equal(refreshes, 1, 'both the old and intervening Chair notifications were reconciled by the fast read');
      h.emit('chair');
      t.mock.timers.tick(2000);
      assert.equal(refreshes, 2, 'a later Chair event can start another window');
    } finally { stop(); }
  });
}

for (const topic of ['chair', 'documents']) {
  test(`Executive unsubscribe clears pending ${topic} timer`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = harness(['admin']);
    let refreshes = 0;
    const stop = h.transport.subscribe(() => { refreshes++; }, () => {});
    h.emit(topic);
    stop();
    t.mock.timers.tick(5000);
    assert.equal(refreshes, 0);
    assert.equal(h.removed.length, 1);
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
