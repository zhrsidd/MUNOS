import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '../lib/domain';
import { createSeed } from '../lib/seed';
import { SupabaseTransport } from '../lib/supabase/repository';

type Result = { data: unknown; error: null | { code: string; message: string } };
function setup(roles: readonly Role[], core: Result = { data: createSeed(), error: null }, operations: Result = { data: {}, error: null }, recoveryOnly = false) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return name === 'operations_snapshot' ? operations : core;
    },
  } as unknown as SupabaseClient;
  return { calls, transport: new SupabaseTransport(client, 'conference-test', 'actor-test', [], recoveryOnly, roles) };
}

for (const roles of [['admin'], ['chair'], ['approval'], ['logistics'], ['admin', 'chair'], ['admin', 'approval'], ['admin', 'logistics'], ['admin', 'admin'], []] as Role[][]) {
  test(`${roles.join('/') || 'missing roles'} selects the appropriate core snapshot and preserves operations merge`, async () => {
    const seed = createSeed();
    const operations = {
      resolutionLinks: [{ documentId: 'r1', workingDocId: 'doc-1', approvalCopyDocId: null, access: 'ok', submittedAt: null, revision: 1 }],
      photoAcks: [{ slotId: 'slot-1', committeeId: 'ga1', stage: 'due', revision: 1, at: '2026-10-06T00:00:00Z' }],
    };
    const { transport, calls } = setup(roles, { data: seed, error: null }, { data: operations, error: null });
    const snapshot = await transport.read();
    assert.deepEqual(calls, [
      { name: roles.length === 1 && roles[0] === 'admin' ? 'executive_snapshot' : 'conference_snapshot', args: { conf: 'conference-test' } },
      { name: 'operations_snapshot', args: { conf: 'conference-test' } },
    ]);
    assert.deepEqual(snapshot, { ...seed, ...operations });
  });
}

for (const roles of [['admin'], ['chair']] as Role[][]) {
  for (const code of ['PGRST202', '42883']) {
    test(`${roles[0]} tolerates only missing operations RPC (${code})`, async () => {
      const seed = createSeed();
      const { transport } = setup(roles, { data: seed, error: null }, { data: null, error: { code, message: 'Missing extension function' } });
      assert.deepEqual(await transport.read(), seed);
    });
  }
  test(`${roles[0]} propagates core errors without falling back to a different core RPC`, async () => {
    const error = { code: 'PGRST202', message: 'Missing selected core function' };
    const { transport, calls } = setup(roles, { data: null, error });
    await assert.rejects(transport.read(), thrown => thrown === error);
    assert.equal(calls.length, 2);
    assert.equal(calls.filter(call => call.name !== 'operations_snapshot').length, 1);
  });
  test(`${roles[0]} propagates operations authorization errors`, async () => {
    const error = { code: '42501', message: 'Access denied' };
    const { transport } = setup(roles, { data: createSeed(), error: null }, { data: null, error });
    await assert.rejects(transport.read(), thrown => thrown === error);
  });
  test(`${roles[0]} rejects an absent authorized conference`, async () => {
    const { transport } = setup(roles, { data: {}, error: null });
    await assert.rejects(transport.read(), /Conference access has not been granted/);
  });
  test(`${roles[0]} tolerates null operations data without altering core snapshot`, async () => {
    const seed = createSeed();
    const { transport } = setup(roles, { data: seed, error: null }, { data: null, error: null });
    assert.deepEqual(await transport.read(), seed);
  });
}

test('recovery-only Executive transport does not issue either snapshot RPC', async () => {
  const { transport, calls } = setup(['admin'], undefined, undefined, true);
  await assert.rejects(transport.read(), /Renew device access/);
  assert.deepEqual(calls, []);
});

test('Executive core and operations reads still start concurrently', async () => {
  const calls: string[] = [];
  let releaseCore!: (value: Result) => void;
  let releaseOperations!: (value: Result) => void;
  const client = {
    rpc(name: string) {
      calls.push(name);
      return new Promise<Result>(resolve => {
        if (name === 'executive_snapshot') releaseCore = resolve;
        else if (name === 'operations_snapshot') releaseOperations = resolve;
        else assert.fail(`Unexpected RPC ${name}`);
      });
    },
  } as unknown as SupabaseClient;
  const transport = new SupabaseTransport(client, 'conference-test', 'actor-test', [], false, ['admin']);
  const read = transport.read();
  assert.deepEqual(calls, ['executive_snapshot', 'operations_snapshot']);
  releaseOperations({ data: { photoSlots: [] }, error: null });
  releaseCore({ data: createSeed(), error: null });
  assert.deepEqual((await read).photoSlots, []);
});
