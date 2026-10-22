import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {ACTORS, ACTOR_KEYS, DEVICES, NO_EXECUTE, type Actor, type ActorKey, type ConfRole} from './authz-fixture';
import {COMMANDS} from './authz-catalogue';
import {attempt, mutationCall, mutationId, sequence, targetFor, type Outcome} from './authz-matrix';
import {assertNone, type Ctx} from './authz-suite-core';

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const device = (n: number): Actor => ({name: `signed-in device ${n}`, db: 'authenticated', sub: DEVICES[n]});
const isExecutive = (a: Actor) => a.db === 'authenticated' && !!a.sub && a.grant?.role === 'admin' && a.grant.scope === null && a.grant.conf === 'A' && a.grant.state === 'active';
const json = (o: Outcome): Record<string, unknown> => { try { return JSON.parse(o.message) as Record<string, unknown>; } catch { return {}; } };

// ---- idempotent replay and stale-write (PT409) parity across the four implementations ---------------------------

interface Rep {cmd: string; actor: ActorKey; role: ConfRole; stranger: ActorKey; strangerRole: ConfRole}
export const REPS: Rep[] = [
 {cmd: 'attendance', actor: 'chairGa1', role: 'chair', stranger: 'chairWho', strangerRole: 'chair'},
 {cmd: 'currentSession', actor: 'chairGa1', role: 'chair', stranger: 'chairWho', strangerRole: 'chair'},
 {cmd: 'committeeUpdate', actor: 'exec', role: 'admin', stranger: 'approval', strangerRole: 'approval'},
 {cmd: 'resolutionLink', actor: 'chairGa1', role: 'chair', stranger: 'chairWho', strangerRole: 'chair'},
 {cmd: 'photoSlot:update', actor: 'exec', role: 'admin', stranger: 'approval', strangerRole: 'approval'},
];
export const EXPECTED_TRACE = ['ok+', 'ok0', '22023', '22023', '22023', 'PT409', 'ok+', 'ok0', '42501'];
const cls = (o: Outcome) => (o.code === 'ok' ? (o.delta > 0 ? 'ok+' : 'ok0') : o.code);

/** The ordered replay/stale trace of one command, in one rolled-back transaction. */
export async function replayTrace(ctx: Ctx, rep: Rep, mutate?: (owner: (sql: string) => Promise<string>) => Promise<void>) {
 const {engine, f} = ctx;
 const cmd = COMMANDS.find(c => c.id === rep.cmd)!;
 const target = targetFor(cmd);
 const actor = ACTORS[rep.actor], stranger = ACTORS[rep.stranger];
 const command = cmd.command(f);
 const trace: string[] = [];
 let replayAfterChange: Outcome | undefined;
 await sequence(engine, async (step, owner) => {
  if (cmd.pre) await owner(cmd.pre(f));
  const exp0 = (await owner(`select (${cmd.expected!(f)})::text`)) || null;
  const M1 = mutationId(1), M2 = mutationId(2), M3 = mutationId(3), M4 = mutationId(4);
  const call = (m: string, c: unknown, role: ConfRole, expected: Parameters<typeof mutationCall>[5]) => mutationCall(target, f.confA, m, c, role, expected);
  const run = async (a: Actor, m: string, c: unknown, role: ConfRole, expected: Parameters<typeof mutationCall>[5]) =>
   step({actor: a, call: call(m, c, role, expected), expectedSql: cmd.expected!(f)});
  trace.push(cls(await run(actor, M1, command, rep.role, 'valid')));                                      // first delivery
  trace.push(cls(await run(actor, M1, command, rep.role, {literal: exp0})));                              // offline retry of the same action
  trace.push(cls(await run(actor, M1, {...(command as object), variant: 1}, rep.role, {literal: exp0}))); // same key, different action
  trace.push(cls(await run(actor, M1, command, rep.role, {literal: 'something-else'})));                  // same key, different precondition
  trace.push(cls(await run(stranger, M1, command, rep.strangerRole, {literal: exp0})));                   // same key, different caller
  trace.push(cls(await run(actor, M2, command, rep.role, 'stale')));                                      // stale write
  trace.push(cls(await run(actor, M3, command, rep.role, 'valid')));                                      // fresh precondition
  replayAfterChange = await run(actor, M1, command, rep.role, {literal: exp0});                           // the first action again, now stale
  trace.push(cls(replayAfterChange));
  trace.push(cls(await run(stranger, M4, command, rep.strangerRole, 'stale')));                           // stale write by someone with no access
  if (mutate) await mutate(owner);
 });
 return {trace, replayAfterChange};
}

export async function idempotencySection(t: TestContext, ctx: Ctx) {
 await t.test(`replay and stale-write parity: all four implementations (${REPS.length} commands) give the same trace: first delivery, retry, different action/precondition/caller under one key, PT409, retry after the state moved on, stale write by a stranger`, async () => {
  const problems: string[] = [];
  for (const rep of REPS) {
   const {trace} = await replayTrace(ctx, rep);
   if (trace.join() !== EXPECTED_TRACE.join()) problems.push(`${rep.cmd} (${COMMANDS.find(c => c.id === rep.cmd)!.impl}): ${trace.join(' ')}  expected ${EXPECTED_TRACE.join(' ')}`);
  }
  assertNone('idempotency parity', problems);
 });

 await t.test('a replay is a no-op: exactly one receipt, one audit row and one effect however many times it is retried', async () => {
  const {engine, f} = ctx;
  const cmd = COMMANDS.find(c => c.id === 'attendance')!;
  const results: string[] = [];
  await sequence(engine, async (step, owner) => {
   const exp0 = await owner(`select (${cmd.expected!(f)})::text`);
   for (let i = 0; i < 4; i++) {
    const o = await step({actor: ACTORS.chairGa1, call: mutationCall(targetFor(cmd), f.confA, mutationId(77), cmd.command(f), 'chair', {literal: exp0}),
     afterSql: `(select count(*) from private.mutation_receipts where id=${q(mutationId(77))})||'/'||(select count(*) from public.audit_log where mutation_id=${q(mutationId(77))})||'/'||(select revision from public.attendance where "sessionId"=${q(f.session)} and "delegateId"=${q(f.japan)})`});
    results.push(`${o.code}:${o.after}`);
   }
  });
  assert.deepEqual(results, ['ok:1/1/2', 'ok:1/1/2', 'ok:1/1/2', 'ok:1/1/2']);
 });
}

// ---- access-code RPCs ----------------------------------------------------------------------------------------------

const CODE = {chair: 'A1B2C3D4E5F6A1B2C3D4E5F6', approval: 'B2C3D4E5F6A1B2C3D4E5F6A1', logistics: 'C3D4E5F6A1B2C3D4E5F6A1B2', admin: 'D4E5F6A1B2C3D4E5F6A1B2C3',
 revoked: 'E5F6A1B2C3D4E5F6A1B2C3D4', expired: 'F6A1B2C3D4E5F6A1B2C3D4E5', otherConference: '0A1B2C3D4E5F6A1B2C3D4E5F', archived: '1B2C3D4E5F6A1B2C3D4E5F6A'};
const CRED = '7f000000-0000-4000-8000-000000000001';
const DEVICE_GRANT = '7f000000-0000-4000-8000-000000000002';
const hash = (code: string) => `encode(sha256(convert_to(${q(code)},'UTF8')),'hex')`;
const credential = (conf: string, role: string, committee: string | null, code: string, state: 'active' | 'revoked' | 'expired' = 'active', id?: string) =>
 `insert into private.access_credentials(${id ? 'id,' : ''}conference_id,committee_id,role,credential_hash,expires_at,revoked_at) values (${id ? q(id) + ',' : ''}${q(conf)},${committee ? q(committee) : 'null'},${q(role)},${hash(code)},${state === 'expired' ? "now() - interval '1 hour'" : "now() + interval '2 days'"},${state === 'revoked' ? 'now()' : 'null'});`;
const activeGrants = (user: string, conf: string, role: string, committee: string | null) =>
 `(select count(*) from public.user_access where user_id=${q(user)} and conference_id=${q(conf)} and role=${q(role)} and committee_id is not distinct from ${committee ? q(committee) : 'null'} and revoked_at is null and expires_at>now())`;

export async function accessCodeSection(t: TestContext, ctx: Ctx) {
 const {engine, f} = ctx;
 const everyone = ACTOR_KEYS;

 await t.test('rotate_access_code: Executive only; every other principal refused; unsupported role / missing or foreign committee / past expiry refused as 22023 even for the Executive', async () => {
  const scenarios = [
   {n: 'chair code for a committee', role: 'chair', committee: f.committee.ga1, days: 2, valid: true},
   {n: 'approval code', role: 'approval', committee: null, days: 2, valid: true},
   {n: 'logistics code', role: 'logistics', committee: null, days: 2, valid: true},
   {n: 'admin (Executive) code', role: 'admin', committee: null, days: 2, valid: true},
   {n: 'observer is not a code role', role: 'observer', committee: null, days: 2, valid: false},
   {n: 'chair code without a committee', role: 'chair', committee: null, days: 2, valid: false},
   {n: 'approval code scoped to a committee', role: 'approval', committee: f.committee.ga1, days: 2, valid: false},
   {n: 'chair code for a committee of another conference', role: 'chair', committee: f.committeeB, days: 2, valid: false},
   {n: 'expiry already past', role: 'chair', committee: f.committee.ga1, days: -1, valid: false},
  ];
  const problems: string[] = [];
  for (const s of scenarios) for (const key of everyone) {
   const actor = ACTORS[key];
   const call = `public.rotate_access_code(${q(f.confA)}::uuid, ${q(s.role)}::public.conference_role, ${s.committee ? q(s.committee) + '::uuid' : 'null::uuid'}, now() + interval '${s.days} days')`;
   const o = await attempt(engine, {actor, call, afterSql: `(select count(*) from private.access_credentials where conference_id=${q(f.confA)} and role=${q(s.role)} and committee_id is not distinct from ${s.committee && s.committee !== f.committeeB ? q(s.committee) : 'null'} and revoked_at is null)`});
   const want = !isExecutive(actor) ? '42501' : s.valid ? 'ok' : '22023';
   const cell = `rotate [${s.n}] :: ${actor.name}`;
   if (o.code !== want) problems.push(`${cell}: expected ${want}, got ${o.code} ${o.message}`);
   else if (want === 'ok') {
    const r = json(o);
    if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/.test(String(r.code))) problems.push(`${cell}: malformed code`);
    if (o.delta <= 0) problems.push(`${cell}: wrote nothing`);
    if (o.after !== '1') problems.push(`${cell}: ${o.after} active credentials for the scope after rotation, expected exactly 1`);
   } else if (o.delta !== 0) problems.push(`${cell}: refused but changed ${o.delta} rows`);
   if (NO_EXECUTE.includes(key) && !/permission denied/.test(o.message)) problems.push(`${cell}: expected a privilege denial, got ${o.message}`);
  }
  assertNone('rotate_access_code', problems);
 });

 await t.test('access_code_status (Executive-only read of credential metadata): same principal rule, never returns a code or hash', async () => {
  const problems: string[] = [];
  for (const key of everyone) {
   const actor = ACTORS[key];
   const o = await attempt(engine, {actor, call: `public.access_code_status(${q(f.confA)}::uuid)`, pre: credential(f.confA, 'approval', null, CODE.approval)});
   const want = isExecutive(actor) ? 'ok' : '42501';
   if (o.code !== want) problems.push(`${actor.name}: expected ${want}, got ${o.code} ${o.message}`);
   if (want === 'ok' && (/hash|"code"/i.test(o.message) || !o.message.includes('approval'))) problems.push(`${actor.name}: status should list the credential without its secret: ${o.message}`);
  }
  assertNone('access_code_status', problems);
 });

 await t.test('revoke_access_code: Executive only; revoke_devices revokes exactly the grants redeemed from that credential; a credential of another conference is unavailable even to that conference\'s Executive', async () => {
  const pre = `${credential(f.confA, 'chair', f.committee.ga1, CODE.chair, 'active', CRED)}
   insert into public.user_access(id,conference_id,user_id,role,committee_id,expires_at) values (${q(DEVICE_GRANT)},${q(f.confA)},${q(DEVICES[0])},'chair',${q(f.committee.ga1)},now() + interval '1 day');
   insert into private.access_grant_sources(user_access_id,credential_id) values (${q(DEVICE_GRANT)},${q(CRED)});`;
  const after = `(select (revoked_at is not null)::text from private.access_credentials where id=${q(CRED)})||'/'||(select (revoked_at is not null)::text from public.user_access where id=${q(DEVICE_GRANT)})`;
  const problems: string[] = [];
  for (const devices of [false, true]) for (const key of everyone) {
   const actor = ACTORS[key];
   const o = await attempt(engine, {actor, pre, afterSql: after, call: `public.revoke_access_code(${q(f.confA)}::uuid, ${q(CRED)}::uuid, ${devices})`});
   const cell = `revoke(devices=${devices}) :: ${actor.name}`;
   if (isExecutive(actor)) {
    const want = devices ? 'true/true' : 'true/false';
    if (o.code !== 'ok' || o.after !== want) problems.push(`${cell}: expected ok ${want}, got ${o.code} ${o.after} ${o.message}`);
   } else if (o.code !== '42501' || o.after !== 'false/false' || o.delta !== 0) problems.push(`${cell}: expected 42501 and no change, got ${o.code} ${o.after} (delta ${o.delta})`);
  }
  // Another conference's Executive, naming conference B with conference A's credential id; and an unknown credential.
  for (const [who, conf, credentialId] of [['execB', f.confB, CRED], ['exec', f.confA, '7f000000-0000-4000-8000-0000000000ff']] as const) {
   const o = await attempt(engine, {actor: ACTORS[who], pre, afterSql: after, call: `public.revoke_access_code(${q(conf)}::uuid, ${q(credentialId)}::uuid, true)`});
   if (o.code !== '22023' || o.after !== 'false/false' || o.delta !== 0) problems.push(`${who} revoking ${credentialId} in ${conf}: expected 22023 unchanged, got ${o.code} ${o.after} (delta ${o.delta})`);
  }
  assertNone('revoke_access_code', problems);
 });

 await t.test('redeem_access_code: any signed-in user, never anon/service_role; wrong, revoked, expired, other-conference, malformed and archived-committee codes all give the same generic "invalid" and grant nothing', async () => {
  const redeemers: ActorKey[] = ['noGrant', 'chairWho', 'execB', 'authNoSub', 'anon', 'service', 'serviceModel', 'serviceSub'];
  const scenarios: {n: string; code: string; pre: string; status: 'ok' | 'invalid'; role?: string; committee?: string | null}[] = [
   {n: 'valid chair code', code: CODE.chair, pre: credential(f.confA, 'chair', f.committee.ga1, CODE.chair), status: 'ok', role: 'chair', committee: f.committee.ga1},
   {n: 'valid chair code typed lower-case with dashes and spaces', code: 'a1b2-c3d4 e5f6-a1b2-c3d4-e5f6', pre: credential(f.confA, 'chair', f.committee.ga1, CODE.chair), status: 'ok', role: 'chair', committee: f.committee.ga1},
   {n: 'valid approval code', code: CODE.approval, pre: credential(f.confA, 'approval', null, CODE.approval), status: 'ok', role: 'approval', committee: null},
   {n: 'valid logistics code', code: CODE.logistics, pre: credential(f.confA, 'logistics', null, CODE.logistics), status: 'ok', role: 'logistics', committee: null},
   {n: 'valid admin code', code: CODE.admin, pre: credential(f.confA, 'admin', null, CODE.admin), status: 'ok', role: 'admin', committee: null},
   {n: 'revoked code', code: CODE.revoked, pre: credential(f.confA, 'chair', f.committee.who, CODE.revoked, 'revoked'), status: 'invalid'},
   {n: 'expired code', code: CODE.expired, pre: credential(f.confA, 'approval', null, CODE.expired, 'expired'), status: 'invalid'},
   {n: 'code issued for another conference', code: CODE.otherConference, pre: credential(f.confB, 'chair', f.committeeB, CODE.otherConference), status: 'invalid'},
   {n: 'unknown code', code: 'ABCDEF012345ABCDEF012345', pre: '', status: 'invalid'},
   {n: 'malformed code', code: 'not-a-code', pre: '', status: 'invalid'},
   {n: 'oversized input', code: 'A'.repeat(200), pre: '', status: 'invalid'},
   {n: 'chair code of a committee that was archived (the lifecycle command revokes it)', code: CODE.archived, status: 'invalid',
    pre: `${credential(f.confA, 'chair', f.committee.sc, CODE.archived)}
     do $a$ begin perform set_config('request.jwt.claim.sub', ${q(ACTORS.exec.sub!)}, true);
      perform public.apply_conference_mutation(${q(f.confA)}, ${q(mutationId(500))}, ${q(JSON.stringify({type: 'committeeLifecycle', id: f.committee.sc, action: 'archive'}))}::jsonb, 'admin', (select revision::text from public.committees where id=${q(f.committee.sc)}), now());
      perform set_config('request.jwt.claim.sub', '', true); end $a$;`},
  ];
  const problems: string[] = [];
  for (const s of scenarios) for (const key of redeemers) {
   const actor = ACTORS[key];
   const after = s.role ? activeGrants(actor.sub ?? '00000000-0000-0000-0000-000000000000', f.confA, s.role, s.committee ?? null) : `(select count(*) from public.user_access where user_id=${q(actor.sub ?? '00000000-0000-0000-0000-000000000000')} and conference_id=${q(f.confA)} and revoked_at is null and role in ('chair','approval','logistics') and created_at>=now())`;
   const o = await attempt(engine, {actor, pre: s.pre, afterSql: after, call: `public.redeem_access_code(${q(f.confA)}::uuid, ${q(s.code)})`});
   const cell = `redeem [${s.n}] :: ${actor.name}`;
   const signedIn = actor.db === 'authenticated' && !!actor.sub;
   if (!signedIn) {
    if (o.code !== '42501' || o.delta !== 0) problems.push(`${cell}: expected 42501 and no write, got ${o.code} ${o.message} (delta ${o.delta})`);
    continue;
   }
   const r = json(o);
   if (o.code !== 'ok' || r.status !== s.status) { problems.push(`${cell}: expected status ${s.status}, got ${o.code} ${o.message}`); continue; }
   if (s.status === 'ok') {
    if (r.role !== s.role || (r.committeeId ?? null) !== (s.committee ?? null)) problems.push(`${cell}: wrong grant returned ${o.message}`);
    if (o.after !== '1') problems.push(`${cell}: ${o.after} matching active grants after redemption, expected 1`);
    if (/hash|credential_hash/i.test(o.message) || o.message.includes(s.code)) problems.push(`${cell}: the response leaks credential internals`);
   } else {
    if (o.after !== '0') problems.push(`${cell}: an invalid code left ${o.after} new grants`);
    if (JSON.stringify(r) !== '{"status": "invalid"}' && JSON.stringify(r) !== '{"status":"invalid"}') problems.push(`${cell}: invalid responses must be generic, got ${o.message}`);
   }
  }
  assertNone('redeem_access_code', problems);
 });

 await t.test('redemption rate limit: 8 failed attempts lock the user out of this conference, even for a valid code; another user is unaffected', async () => {
  const seen: string[] = [];
  await sequence(engine, async (step, owner) => {
   await owner(credential(f.confA, 'chair', f.committee.ga1, CODE.chair));
   const redeem = async (a: Actor, code: string) => json(await step({actor: a, call: `public.redeem_access_code(${q(f.confA)}::uuid, ${q(code)})`})).status as string;
   for (let i = 0; i < 8; i++) seen.push(await redeem(device(1), `00000000000000000000000${i}`));
   seen.push(await redeem(device(1), CODE.chair));
   seen.push(await redeem(device(2), CODE.chair));
  });
  assert.deepEqual(seen, [...Array(8).fill('invalid'), 'rate_limited', 'ok']);
 });

 await t.test('a redeemed code grants exactly its own role and committee: the new device can do the Chair\'s work on GA1 and nothing else; revoking the code with devices removes it at once', async () => {
  const outcomes: Record<string, string> = {};
  const run = (name: string, o: Outcome) => { outcomes[name] = o.code; };
  await sequence(engine, async (step, owner) => {
   const d = device(3);
   await owner(`${credential(f.confA, 'chair', f.committee.ga1, CODE.chair, 'active', CRED)}`);
   const as = (id: string, role: ConfRole, n: number) => {
    const cmd = COMMANDS.find(c => c.id === id)!;
    return step({actor: d, pre: cmd.pre?.(f), expectedSql: cmd.expected?.(f), call: mutationCall(targetFor(cmd), f.confA, mutationId(600 + n), cmd.command(f), role, 'valid')});
   };
   const own = (role: ConfRole, n: number) => as('attendance', role, n);
   run('before redeeming', await own('chair', 1));
   assert.equal(json(await step({actor: d, call: `public.redeem_access_code(${q(f.confA)}::uuid, ${q(CODE.chair)})`})).status, 'ok');
   run('own committee', await own('chair', 2));
   run('claims admin with a chair grant', await own('admin', 3));
   run('another committee', await as('document:chairDebate', 'chair', 4));
   run('Executive command', await as('school', 'chair', 5));
   run('Approval Panel transition', await as('document:approvalReview', 'chair', 6));
   run('revoke the code (devices kept)', await step({actor: ACTORS.exec, call: `public.revoke_access_code(${q(f.confA)}::uuid, ${q(CRED)}::uuid, false)`}));
   run('still allowed after revoking the code only', await own('chair', 7));
   run('revoke the code with devices', await step({actor: ACTORS.exec, call: `public.revoke_access_code(${q(f.confA)}::uuid, ${q(CRED)}::uuid, true)`}));
   run('immediately after revoking devices', await own('chair', 8));
  });
  assert.deepEqual(outcomes, {
   'before redeeming': '42501', 'own committee': 'ok', 'claims admin with a chair grant': '42501', 'another committee': '42501',
   'Executive command': '42501', 'Approval Panel transition': '22023', 'revoke the code (devices kept)': 'ok',
   'still allowed after revoking the code only': 'ok', 'revoke the code with devices': 'ok', 'immediately after revoking devices': '42501',
  });
 });
}
