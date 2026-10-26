import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {Engine} from './authz-engine';
import {ACTORS, ACTOR_KEYS, type ActorKey, type ConfRole, type Fixture} from './authz-fixture';
import {COMMANDS, type Cmd} from './authz-catalogue';
import {attempt, mutationCall, mutationId, privateTargetFor, runCommand, targetFor, type Mismatch} from './authz-matrix';
import {applyCommand} from '../../lib/commands';
import {createSeed} from '../../lib/seed';
import {operationsCommandTypes, operationsRoles} from '../../lib/operations/commands';
import {procedureTypes} from '../../lib/procedure/types';
import {batchTypes} from '../../lib/batch/types';

export interface Ctx {engine: Engine; f: Fixture; log: (line: string) => void}

export const assertNone = (label: string, problems: Mismatch[] | string[]) => {
 const lines = problems.map(p => (typeof p === 'string' ? p : `${p.cell}\n    expected ${p.expected}\n    actual   ${p.actual}`));
 assert.equal(lines.length, 0, `${label}: ${lines.length} mismatch(es)\n  ${lines.slice(0, 25).join('\n  ')}`);
};

/** Users whose grants are live; the revoked/expired variants are exercised separately on representative commands. */
export const CORE: ActorKey[] = ACTOR_KEYS.filter(k => !/Revoked$|Expired$/.test(k));
export const LIFECYCLE: ActorKey[] = ACTOR_KEYS.filter(k => /Revoked$|Expired$/.test(k));

// ---- EXECUTE privilege matrix --------------------------------------------------------------------------------

interface Privilege {anon: boolean; authenticated: boolean; service_role: boolean; public: boolean}
const PRIVILEGE_SQL = `select json_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', json_build_object(
 'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
 'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
 'public', exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)))::text
 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')`;

interface InventoryFn {schema: string; name: string; args: string; exec: Record<string, boolean>; usage: Record<string, boolean>; publicExec: boolean; trigger: boolean}
interface Inventory {migrations: string[]; bare: {fns: InventoryFn[]; schemas: {name: string; usage: Record<string, boolean>}[]}; 'supabase-model': {fns: InventoryFn[]}}
const inventory = (): Inventory => JSON.parse(readFileSync('docs/generated/isolation-t1-inventory.json', 'utf8')) as Inventory;
const keyOf = (fn: {schema: string; name: string; args: string}) => `${fn.schema}.${fn.name}(${fn.args})`;

/**
 * The hosted privilege audit of 22 October 2026 (HD5), recorded by name. It is the owner-facing statement the local
 * inventory must keep matching: anon has nothing; authenticated holds EXECUTE on the public apply_*, access-code and
 * snapshot RPCs and on these private functions; service_role holds EXECUTE only on the four public-submission functions.
 */
export const HOSTED_AUDIT = {
 authenticated: new Set([
  'public.apply_conference_mutation', 'public.apply_operations_mutation', 'public.redeem_access_code', 'public.rotate_access_code',
  'public.revoke_access_code', 'public.access_code_status', 'public.conference_snapshot', 'public.conference_state_snapshot',
  'public.executive_snapshot', 'public.executive_state_snapshot', 'public.operations_snapshot', 'public.staff_batch_snapshot',
  'private.access_grants', 'private.apply_mutation', 'private.apply_operations_mutation', 'private.apply_procedure', 'private.apply_staff_batch',
  'private.decision_history', 'private.document_submitter_countries', 'private.has_access', 'private.permitted', 'private.photo_chairs', 'private.uuid_or_null',
 ]),
 serviceRole: new Set(['public.submission_link_info', 'public.amendment_link_info', 'public.submit_resolution', 'public.submit_amendment']),
};
const nameOf = (key: string) => key.slice(0, key.indexOf('('));

export async function privilegeSection(t: TestContext, {engine}: Ctx) {
 const live = JSON.parse(await engine.run(PRIVILEGE_SQL)) as Record<string, Privilege>;
 const inv = inventory();

 await t.test('every function of the committed T1 inventory has exactly the inventoried EXECUTE privilege (anon, authenticated, service_role, PUBLIC)', () => {
  const problems: string[] = [];
  for (const fn of inv.bare.fns) {
   const got = live[keyOf(fn)];
   if (!got) { problems.push(`${keyOf(fn)}: inventoried but missing from the database`); continue; }
   for (const role of ['anon', 'authenticated', 'service_role'] as const)
    if (got[role] !== fn.exec[role]) problems.push(`${keyOf(fn)}: ${role} EXECUTE is ${got[role]}, inventory says ${fn.exec[role]}`);
   if (got.public !== fn.publicExec) problems.push(`${keyOf(fn)}: PUBLIC EXECUTE is ${got.public}, inventory says ${fn.publicExec}`);
  }
  assertNone('privilege matrix vs inventory', problems);
  const inventoried = new Set(inv.bare.fns.map(keyOf));
  assertNone('functions missing from the inventory (regenerate docs/generated and review)', Object.keys(live).filter(k => !inventoried.has(k)));
 });

 await t.test('hosted-audit baseline plus reviewed lifecycle delta: one anon metadata RPC, two additional authenticated helpers, service_role unchanged', () => {
  const problems: string[] = [];
  for (const [key, got] of Object.entries(live)) {
   const name = nameOf(key);
   if (got.anon !== (name==='public.preproduction_status')) problems.push(`${key}: unexpected anon EXECUTE=${got.anon}`);
   if (got.public) problems.push(`${key}: PUBLIC has EXECUTE`);
   if (got.authenticated !== (HOSTED_AUDIT.authenticated.has(name)||['public.preproduction_status','private.lifecycle_allows'].includes(name))) problems.push(`${key}: authenticated=${got.authenticated}, audit says ${HOSTED_AUDIT.authenticated.has(name)}`);
   if (got.service_role !== HOSTED_AUDIT.serviceRole.has(name)) problems.push(`${key}: service_role=${got.service_role}, audit says ${HOSTED_AUDIT.serviceRole.has(name)}`);
  }
  assertNone('privilege matrix vs hosted audit', problems);
  assert.equal(HOSTED_AUDIT.authenticated.size, 23);
  assert.equal(Object.keys(live).filter(k => live[k].authenticated).length, 25, 'the audited baseline plus two lifecycle functions exists exactly once');
  assert.equal(Object.keys(live).filter(k => live[k].service_role).length, 4);
 });

 await t.test('schema USAGE: private is usable by authenticated only; public by all three API roles (inventory)', async () => {
  const usage = JSON.parse(await engine.run(`select json_object_agg(s.nspname, json_build_object(
   'anon', has_schema_privilege('anon', s.oid, 'USAGE'), 'authenticated', has_schema_privilege('authenticated', s.oid, 'USAGE'),
   'service_role', has_schema_privilege('service_role', s.oid, 'USAGE')))::text from pg_namespace s where s.nspname in ('public', 'private')`)) as Record<string, Record<string, boolean>>;
  const problems: string[] = [];
  for (const schema of inv.bare.schemas.filter(s => s.name === 'public' || s.name === 'private'))
   for (const role of ['anon', 'authenticated', 'service_role'])
    if (usage[schema.name][role] !== schema.usage[role]) problems.push(`schema ${schema.name}: ${role} USAGE is ${usage[schema.name][role]}, inventory says ${schema.usage[role]}`);
  assertNone('schema usage', problems);
  assert.deepEqual(usage.private, {anon: false, authenticated: true, service_role: false});
 });

 await t.test('the model privilege comparison matches its recorded calibration and hardening state', () => {
  const model = new Map(inv['supabase-model'].fns.map(fn => [keyOf(fn), fn]));
  const differing = inv.bare.fns.filter(fn => JSON.stringify(fn.exec) !== JSON.stringify(model.get(keyOf(fn))!.exec));
  const hardened=inv.migrations.includes('20261022090000_privilege_hardening.sql');
  for (const fn of differing) {
   const m = model.get(keyOf(fn))!;
   assert.equal(fn.schema, 'public', `${keyOf(fn)}: only public functions differ`);
   assert.equal(fn.exec.service_role, false);
   assert.equal(m.exec.service_role, true);
   assert.equal(m.exec.anon, fn.exec.anon);
   assert.equal(m.exec.authenticated, fn.exec.authenticated);
  }
  assert.equal(differing.length, hardened?0:12, hardened?'the hosted-calibrated/hardened model preserves the same explicit RPC grants as the bare bootstrap':'the historical pre-audit model exposes 12 extra public functions to service_role');
 });
}

// ---- coverage: the matrix covers the whole command vocabulary --------------------------------------------------

const TOKEN = /\bwhen\s+((?:'[A-Za-z]+'\s*,\s*)*'[A-Za-z]+')\s+then/g;
const tokens = (definition: string) => new Set([...definition.matchAll(TOKEN)].flatMap(m => [...m[1].matchAll(/'([A-Za-z]+)'/g)].map(x => x[1])));

export async function coverageSection(t: TestContext, {engine}: Ctx) {
 const definition = async (name: string) => engine.run(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = '${name}'`);

 await t.test('every command the SQL dispatchers handle has a matrix entry, per implementation, and nothing else', async () => {
  for (const [impl, fn] of [['mutation', 'private.apply_mutation'], ['procedure', 'private.apply_procedure'], ['batch', 'private.apply_staff_batch'], ['operations', 'private.apply_operations_mutation']] as const) {
   const sql = tokens(await definition(fn));
   const matrix = new Set(COMMANDS.filter(c => c.impl === impl).map(c => c.type));
   assert.deepEqual([...sql].sort(), [...matrix].sort(), `${fn} dispatches [${[...sql].sort()}], matrix covers [${[...matrix].sort()}]`);
  }
 });

 await t.test('the routers send exactly the batch and procedure types to their implementations (everything else falls to apply_mutation)', async () => {
  const router = await definition('public.apply_conference_mutation');
  const lists = [...router.matchAll(/in \(([^)]*)\)/g)].map(m => [...m[1].matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]).sort());
  assert.deepEqual(lists[0], [...batchTypes].sort());
  assert.deepEqual(lists[1], [...procedureTypes].sort());
  assert.equal(lists.length, 2);
 });

 await t.test('the TypeScript command vocabularies are all covered', () => {
  const covered = (impl: Cmd['impl']) => new Set(COMMANDS.filter(c => c.impl === impl).map(c => c.type));
  for (const type of operationsCommandTypes) assert.ok(covered('operations').has(type), `operations ${type}`);
  for (const type of procedureTypes) assert.ok(covered('procedure').has(type), `procedure ${type}`);
  for (const type of batchTypes) assert.ok(covered('batch').has(type), `batch ${type}`);
 });

 await t.test('the matrix role rules equal the client-side role boundary of lib/commands.ts and lib/operations operationsRoles (the documented intent)', () => {
  const problems: string[] = [];
  const roles: ConfRole[] = ['chair', 'approval', 'logistics', 'admin'];
  const types = [...new Set(COMMANDS.map(c => c.type))];
  const notModelled: string[] = [];
  for (const type of types) {
   const intended = new Set(COMMANDS.filter(c => c.type === type).flatMap(c => c.roles));
   const allowedByClient = roles.filter(role => {
    try { applyCommand(createSeed(), {type} as never, role as never); return true; } catch (error) {
     const message = (error as Error).message;
     if (/outside the demo role boundary/.test(message)) return false;
     if (error instanceof TypeError && /reading 'includes'/.test(message)) { notModelled.push(type); return true; }
     return true; // refused later for another reason: the role boundary itself passed
    }
   });
   if (notModelled.includes(type)) continue;
   if ([...intended].sort().join() !== allowedByClient.sort().join()) problems.push(`${type}: matrix roles [${[...intended].sort()}] vs client boundary [${allowedByClient.sort()}]`);
  }
  for (const type of operationsCommandTypes) {
   const matrix = COMMANDS.filter(c => c.type === type).flatMap(c => c.roles);
   assert.deepEqual([...new Set(matrix)].sort(), [...operationsRoles[type]].sort(), `operationsRoles.${type}`);
  }
  // `timer` is a legacy server command: no client code emits it (the countdown is a local calculation), so the client
  // role map has no entry. The database keeps it Chair-only.
  assert.deepEqual([...new Set(notModelled)], ['timer'], 'only the legacy timer command is absent from the client role map');
  assert.deepEqual(COMMANDS.find(c => c.type === 'timer')!.roles, ['chair']);
  assertNone('role rules vs client boundary', problems);
 });
}

// ---- the table-driven allow/deny matrices ---------------------------------------------------------------------

export async function mutationMatrixSection(t: TestContext, {engine, f, log}: Ctx) {
 const cells = {n: 0};
 const run = async (title: string, actors: ActorKey[], commands: Cmd[], target: (c: Cmd) => ReturnType<typeof targetFor>, seedBase: number) => {
  await t.test(title, async () => {
   const all: Mismatch[] = [];
   for (const [i, cmd] of commands.entries()) {
    const r = await runCommand(engine, f, cmd, target(cmd), actors, seedBase + i);
    cells.n += r.cells;
    all.push(...r.mismatches);
   }
   assertNone(title, all);
  });
 };
 const routed = COMMANDS.length;
 await run(`public routers: ${routed} commands x every principal x intended+own role (anon, no session, service_role incl. default-privilege model, no grant, each conference role on own/other committee, other conference)`, CORE, COMMANDS, targetFor, 1);
 await run('private.apply_* called directly (executable by authenticated): same allow/deny as through the routers; anon and service_role have no schema USAGE', CORE, COMMANDS, privateTargetFor, 100);
 const representative = COMMANDS.filter(c => c.representative);
 await run(`revoked and expired grants of every role (${LIFECYCLE.length} principals) x ${representative.length} representative commands: refused immediately, wrote nothing`, LIFECYCLE, representative, targetFor, 200);
 await run(`revoked and expired grants through the private functions`, LIFECYCLE, representative, privateTargetFor, 300);
 log(`mutation matrix cells: ${cells.n}`);
}

// ---- cross-reference and state cases ----------------------------------------------------------------------------

interface Case {name: string; actor: ActorKey; role: ConfRole; target: ReturnType<typeof targetFor>; command: (f: Fixture) => unknown; pre?: (f: Fixture) => string; expected?: (f: Fixture) => string; code: string}
const q = (v: string) => `'${v.replaceAll("'", "''")}'`;

export async function crossReferenceSection(t: TestContext, {engine, f}: Ctx) {
 const WHO_AMENDMENT = '7d000000-0000-4000-8000-0000000000aa';
 const cases: Case[] = [
  {name: 'attendance: own session, delegate of ANOTHER committee', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '22023',
   command: f => ({type: 'attendance', delegateId: f.brazilWho, sessionId: f.session, status: 'Absent'})},
  {name: 'attendance: another committee\'s session', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'attendance', delegateId: f.brazilWho, sessionId: f.sessionWho, status: 'Absent'})},
  {name: 'vote: own session, resolution of ANOTHER committee', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '22023',
   command: f => ({type: 'vote', delegateId: f.france, sessionId: f.session, resolutionId: f.docApproved, choice: 'For'})},
  {name: 'document: another committee\'s resolution (Approved -> Printed as Chair)', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'document', id: f.docApproved, status: 'Printed'})},
  {name: 'newDocument: own session, ANOTHER committee in the body', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '22023',
   command: f => ({type: 'newDocument', committeeId: f.committee.who, sessionId: f.session, title: 'Cross', submitterId: f.france})},
  {name: 'speechStart: another committee\'s session', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'speechStart', sessionId: f.sessionWho, delegateId: f.brazilWho, classification: 'Other'})},
  {name: 'currentSession: own committee, another committee\'s session', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'currentSession', committeeId: f.committee.ga1, sessionId: f.sessionWho})},
  {name: 'amendmentStatus: another committee\'s amendment', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '42501',
   pre: f => `insert into public.amendments(id,conference_id,committee_id,"resolutionId","sessionId","submitterId",type,clause,wording) values (${q(WHO_AMENDMENT)},${q(f.confA)},${q(f.committee.who)},${q(f.docApproved)},${q(f.sessionWho)},${q(f.brazilWho)},'Add','1','W');`,
   command: () => ({type: 'amendmentStatus', id: WHO_AMENDMENT, status: 'Accepted for Debate'})},
  {name: 'photoAck: another committee', actor: 'chairGa1', role: 'chair', target: 'public.apply_operations_mutation', code: '42501',
   command: f => ({type: 'photoAck', committeeId: f.committee.who, slotId: f.photoSlot, stage: 'warning', revision: 1, epoch: 0, chairs: ''})},
  {name: 'pointAdjustment: own delegate, another committee\'s session', actor: 'chairGa1', role: 'chair', target: 'public.apply_operations_mutation', code: '22023',
   command: f => ({type: 'pointAdjustment', action: 'deduct', delegateId: f.france, sessionId: f.sessionWho, amount: 2, reason: 'Cross committee'})},
  {name: 'pointAdjustment: another committee\'s delegate', actor: 'chairGa1', role: 'chair', target: 'public.apply_operations_mutation', code: '42501',
   command: f => ({type: 'pointAdjustment', action: 'deduct', delegateId: f.brazilWho, sessionId: f.sessionWho, amount: 2, reason: 'Cross committee'})},
  {name: 'resolutionLink: another committee\'s resolution', actor: 'chairGa1', role: 'chair', target: 'public.apply_operations_mutation', code: '42501',
   command: f => ({type: 'resolutionLink', documentId: f.docApproved, action: 'access', access: 'ok'})},
  {name: 'submissionLink: Chair of the committee (admin-only command)', actor: 'chairGa1', role: 'chair', target: 'public.apply_operations_mutation', code: '42501',
   command: f => ({type: 'submissionLink', action: 'rotate', committeeId: f.committee.ga1, token: 'sub_rotated_token_eeeeeeeeeee'})},
  {name: 'committeeUpdate: Chair of the committee', actor: 'chairGa1', role: 'chair', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'committeeUpdate', id: f.committee.ga1, code: 'GA1', name: 'Mine now', room: 'R'})},
  {name: 'committee scoped admin cannot reach a conference-wide command', actor: 'execGa1', role: 'admin', target: 'public.apply_conference_mutation', code: '42501',
   command: () => ({type: 'school', name: 'Scoped admin school'})},
  {name: 'committee scoped admin cannot reach another committee', actor: 'execGa1', role: 'admin', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'committeeUpdate', id: f.committee.who, code: 'WHO', name: 'Other', room: 'R'})},
  {name: 'other conference\'s Executive against conference A\'s committee', actor: 'execB', role: 'admin', target: 'public.apply_conference_mutation', code: '42501',
   command: f => ({type: 'committeeUpdate', id: f.committee.ga1, code: 'GA1', name: 'Other conference', room: 'R'})},
 ];
 await t.test(`cross-reference and wrong-committee cases (${cases.length}): every id from another committee is refused and nothing is written`, async () => {
  const problems: string[] = [];
  for (const [i, c] of cases.entries()) {
   const o = await attempt(engine, {actor: ACTORS[c.actor], call: mutationCall(c.target, f.confA, mutationId(900 + i), c.command(f), c.role, 'none'), pre: c.pre?.(f)});
   if (o.code !== c.code || o.delta !== 0) problems.push(`${c.name}: expected ${c.code} with no write, got ${o.code} (delta ${o.delta}): ${o.message}`);
  }
  assertNone('cross reference', problems);
 });
 await t.test('an unauthorised caller gets 42501 BEFORE the stale-write check: no revision of an item they cannot see is revealed', async () => {
  const problems: string[] = [];
  for (const cmd of COMMANDS.filter(c => c.expected && c.roles.includes('chair') && c.scope === 'ga1')) {
   const o = await attempt(engine, {actor: ACTORS.chairWho, call: mutationCall(targetFor(cmd), f.confA, mutationId(950), cmd.command(f), 'chair', 'stale'), pre: cmd.pre?.(f)});
   if (o.code !== '42501' || o.delta !== 0) problems.push(`${cmd.id}: Chair of another committee with a stale precondition got ${o.code} ${o.message}`);
  }
  for (const cmd of COMMANDS.filter(c => c.expected && c.roles.includes('admin'))) {
   const o = await attempt(engine, {actor: ACTORS.approval, call: mutationCall(targetFor(cmd), f.confA, mutationId(951), cmd.command(f), 'approval', 'stale'), pre: cmd.pre?.(f)});
   if (o.code !== '42501' && !(cmd.type === 'document')) problems.push(`${cmd.id}: Approval Panel with a stale precondition got ${o.code} ${o.message}`);
  }
  assertNone('stale before authorisation', problems);
 });
}

