import test from 'node:test';
import type {Engine} from './authz-engine';
import {installFixture} from './authz-fixture';
import {cellsRun} from './authz-matrix';
import {accessCodeSection, idempotencySection} from './authz-suite-writes';
import {stateSection} from './authz-suite-state';
import {helperSection, submissionSection} from './authz-suite-public';
import {coverageSection, crossReferenceSection, mutationMatrixSection, privilegeSection, type Ctx} from './authz-suite-core';

export interface SuiteEnv {engine: Engine; ids: Record<string, string>; close(): Promise<void>}

/**
 * The write-RPC authorisation matrix (HD10). One disposable database per engine; every cell runs in its own
 * rolled-back transaction as a real database role, so nothing leaks between cells and every privilege check is real.
 */
export function registerAuthzSuite(label: string, open: () => Promise<SuiteEnv>, options: {skip?: string | false} = {}) {
 test(`write-RPC authorisation matrix on ${label}`, {skip: options.skip ?? false, timeout: 1_800_000}, async t => {
  const env = await open();
  try {
   const f = await installFixture(env.engine, env.ids);
   const ctx: Ctx = {engine: env.engine, f, log: line => t.diagnostic(line)};
   await t.test('EXECUTE privilege matrix', s => privilegeSection(s, ctx));
   await t.test('vocabulary coverage', s => coverageSection(s, ctx));
   await t.test('command matrix', s => mutationMatrixSection(s, ctx));
   await t.test('cross-reference cases', s => crossReferenceSection(s, ctx));
   await t.test('idempotent replay and stale-write parity', s => idempotencySection(s, ctx));
   await t.test('access-code RPCs', s => accessCodeSection(s, ctx));
   await t.test('public submissions and link look-ups', s => submissionSection(s, ctx));
   await t.test('helper functions executable by authenticated', s => helperSection(s, ctx));
   await t.test('state, lifecycle, observations and findings', s => stateSection(s, ctx));
   t.diagnostic(`total authorisation cells executed on ${label}: ${cellsRun()}`);
  } finally {
   await env.close();
  }
 });
}
