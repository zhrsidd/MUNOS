import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '../lib/domain';
import { createSeed } from '../lib/seed';
import { SupabaseTransport } from '../lib/supabase/repository';

type Result = { data: unknown; error: null | { code: string; message: string } };
const missing = (code = 'PGRST202'): Result => ({ data: null, error: { code, message: 'Could not find the function' } });
/** Mock client: the bundled state RPCs, the legacy core RPCs and operations_snapshot answer independently. */
function setup(roles: readonly Role[], o: { bundled?: Result; core?: Result; operations?: Result; recoveryOnly?: boolean } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const seed = createSeed();
  const client = {
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      if (name === 'conference_state_snapshot' || name === 'executive_state_snapshot') return o.bundled ?? { data: seed, error: null };
      if (name === 'operations_snapshot') return o.operations ?? { data: {}, error: null };
      return o.core ?? { data: seed, error: null };
    },
  } as unknown as SupabaseClient;
  return { calls, transport: new SupabaseTransport(client, 'conference-test', 'actor-test', [], o.recoveryOnly ?? false, roles) };
}
const operations = {
  resolutionLinks: [{ documentId: 'r1', workingDocId: 'doc-1', approvalCopyDocId: null, access: 'ok', submittedAt: null, revision: 1 }],
  photoAcks: [{ slotId: 'slot-1', committeeId: 'ga1', stage: 'due', revision: 1, at: '2026-10-06T00:00:00Z' }],
};
const pureExecutive = (roles: readonly Role[]) => roles.length === 1 && roles[0] === 'admin';
const allRoleSets = [['admin'], ['chair'], ['approval'], ['logistics'], ['admin', 'chair'], ['admin', 'approval'], ['admin', 'logistics'], ['admin', 'admin'], []] as Role[][];

for (const roles of allRoleSets) {
  const bundledName = pureExecutive(roles) ? 'executive_state_snapshot' : 'conference_state_snapshot';
  test(`${roles.join('/') || 'missing roles'}: one ${bundledName} RPC per refresh`, async () => {
    const merged = { ...createSeed(), ...operations };
    const { transport, calls } = setup(roles, { bundled: { data: merged, error: null } });
    assert.deepEqual(await transport.read(), merged, 'the server-merged state is returned as-is');
    assert.deepEqual(calls, [{ name: bundledName, args: { conf: 'conference-test' } }], 'exactly one snapshot RPC');
  });
}

for (const roles of [['admin'], ['chair']] as Role[][]) {
  const legacyCore = pureExecutive(roles) ? 'executive_snapshot' : 'conference_snapshot';
  for (const code of ['PGRST202', '42883']) {
    test(`${roles[0]}: missing bundled function (${code}) falls back to the previous two-RPC read, once`, async () => {
      const seed = createSeed();
      const { transport, calls } = setup(roles, { bundled: missing(code), core: { data: seed, error: null }, operations: { data: operations, error: null } });
      assert.deepEqual(await transport.read(), { ...seed, ...operations }, 'same {...core, ...operations} merge as before');
      assert.deepEqual(calls.map(c => c.name), [pureExecutive(roles) ? 'executive_state_snapshot' : 'conference_state_snapshot', legacyCore, 'operations_snapshot']);
      calls.length = 0;
      await transport.read();
      assert.deepEqual(calls.map(c => c.name), [legacyCore, 'operations_snapshot'], 'later reads skip the known-missing bundled RPC');
    });
  }
  for (const error of [{ code: '42501', message: 'Access denied' }, { code: '57014', message: 'canceling statement due to statement timeout' }, { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }, { code: 'XX000', message: 'Internal error' }]) {
    test(`${roles[0]}: bundled ${error.code} propagates without falling back`, async () => {
      const { transport, calls } = setup(roles, { bundled: { data: null, error } });
      await assert.rejects(transport.read(), thrown => thrown === error);
      assert.equal(calls.length, 1, 'no second RPC after a real failure');
      calls.length = 0;
      await assert.rejects(transport.read(), thrown => thrown === error);
      assert.equal(calls.length, 1, 'a real failure never switches the transport to the legacy path');
    });
  }
  test(`${roles[0]}: bundled read rejects an absent authorized conference`, async () => {
    const { transport } = setup(roles, { bundled: { data: {}, error: null } });
    await assert.rejects(transport.read(), /Conference access has not been granted/);
  });
  // Fallback path keeps the previous semantics exactly.
  for (const code of ['PGRST202', '42883']) {
    test(`${roles[0]} fallback: tolerates only missing operations RPC (${code})`, async () => {
      const seed = createSeed();
      const { transport } = setup(roles, { bundled: missing(), core: { data: seed, error: null }, operations: missing(code) });
      assert.deepEqual(await transport.read(), seed);
    });
  }
  test(`${roles[0]} fallback: propagates core errors without trying another core RPC`, async () => {
    const error = { code: 'PGRST202', message: 'Missing selected core function' };
    const { transport, calls } = setup(roles, { bundled: missing(), core: { data: null, error } });
    await assert.rejects(transport.read(), thrown => thrown === error);
    assert.equal(calls.filter(call => call.name === legacyCore).length, 1);
  });
  test(`${roles[0]} fallback: propagates operations authorization errors`, async () => {
    const error = { code: '42501', message: 'Access denied' };
    const { transport } = setup(roles, { bundled: missing(), operations: { data: null, error } });
    await assert.rejects(transport.read(), thrown => thrown === error);
  });
  test(`${roles[0]} fallback: null operations data leaves the core snapshot unchanged`, async () => {
    const seed = createSeed();
    const { transport } = setup(roles, { bundled: missing(), core: { data: seed, error: null }, operations: { data: null, error: null } });
    assert.deepEqual(await transport.read(), seed);
  });
}

test('recovery-only Executive transport does not issue any snapshot RPC', async () => {
  const { transport, calls } = setup(['admin'], { recoveryOnly: true });
  await assert.rejects(transport.read(), /Renew device access/);
  assert.deepEqual(calls, []);
});

test('fallback: Executive core and operations reads still start concurrently', async () => {
  const calls: string[] = [];
  let releaseCore!: (value: Result) => void;
  let releaseOperations!: (value: Result) => void;
  const client = {
    rpc(name: string) {
      calls.push(name);
      if (name === 'executive_state_snapshot') return Promise.resolve(missing());
      return new Promise<Result>(resolve => {
        if (name === 'executive_snapshot') releaseCore = resolve;
        else if (name === 'operations_snapshot') releaseOperations = resolve;
        else assert.fail(`Unexpected RPC ${name}`);
      });
    },
  } as unknown as SupabaseClient;
  const transport = new SupabaseTransport(client, 'conference-test', 'actor-test', [], false, ['admin']);
  const read = transport.read();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['executive_state_snapshot', 'executive_snapshot', 'operations_snapshot']);
  releaseOperations({ data: { photoSlots: [] }, error: null });
  releaseCore({ data: createSeed(), error: null });
  assert.deepEqual((await read).photoSlots, []);
});
