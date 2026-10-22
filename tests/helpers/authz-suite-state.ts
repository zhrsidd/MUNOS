import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {ACTORS, type ActorKey, type ConfRole} from './authz-fixture';
import {COMMANDS, type Cmd} from './authz-catalogue';
import {attempt, mutationCall, mutationId, sequence, targetFor, type Outcome} from './authz-matrix';
import {assertNone, type Ctx} from './authz-suite-core';
import {REPS} from './authz-suite-writes';

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const cmdOf = (id: string) => COMMANDS.find(c => c.id === id)!;

export async function stateSection(t: TestContext, ctx: Ctx) {
 const {engine, f} = ctx;
 const send = (step: (a: Parameters<typeof attempt>[1]) => Promise<Outcome>, actor: ActorKey, cmd: Cmd, role: ConfRole, n: number, extraPre = '') =>
  step({actor: ACTORS[actor], pre: `${cmd.pre?.(f) ?? ''}${extraPre}`, expectedSql: cmd.expected?.(f), call: mutationCall(targetFor(cmd), f.confA, mutationId(1000 + n), cmd.command(f), role, 'valid')});

 await t.test('archived committee or session with the Chair grant still live (a late offline replay): every operational Chair write is a PT409 stale conflict, never silently applied', async () => {
  const ids = ['attendance', 'participation', 'queue', 'queueAdd', 'speechStart', 'speechScore', 'poiAllowance', 'voteMode', 'pointAdjustment', 'amendmentStatus'];
  const problems: string[] = [];
  for (const [label, sql] of [
   ['committee archived', `update public.committees set archived=true where id=${q(f.committee.ga1)};`],
   ['session archived', `update public.sessions set archived=true where id=${q(f.session)};`],
  ] as const) {
   for (const id of ids) {
    const cmd = cmdOf(id);
    const o = await attempt(engine, {actor: ACTORS.chairGa1, pre: `${cmd.pre?.(f) ?? ''}${sql}`, expectedSql: cmd.expected?.(f), call: mutationCall(targetFor(cmd), f.confA, mutationId(1000), cmd.command(f), 'chair', 'valid')});
    if (o.code !== 'PT409' || o.delta !== 0) problems.push(`${label}: ${id} expected PT409 with no write, got ${o.code} ${o.message} (delta ${o.delta})`);
   }
  }
  assertNone('archived guard', problems);
 });

 await t.test('committee lifecycle archive revokes the Chair\'s grant and credential in the same transaction: the Chair is refused at once, the old code is dead, a new Chair code cannot be issued', async () => {
  const seen: Record<string, string> = {};
  await sequence(engine, async (step, owner) => {
   await owner(`update public.documents set status='Closed', outcome='Withdrawn' where id=${q(f.resolution)};
    insert into private.access_credentials(conference_id,committee_id,role,credential_hash,expires_at) values (${q(f.confA)},${q(f.committee.ga1)},'chair',encode(sha256(convert_to('A1B2C3D4E5F6A1B2C3D4E5F6','UTF8')),'hex'),now() + interval '2 days');`);
   const attendance = cmdOf('attendance');
   seen.before = (await send(step, 'chairGa1', attendance, 'chair', 1)).code;
   const archive = cmdOf('committeeLifecycle');
   const archiveGa1 = {...archive, command: () => ({type: 'committeeLifecycle', id: f.committee.ga1, action: 'archive'}), expected: () => `(select revision::text from public.committees where id=${q(f.committee.ga1)})`};
   seen.archive = (await send(step, 'exec', archiveGa1, 'admin', 2)).code;
   seen.afterArchive = (await send(step, 'chairGa1', attendance, 'chair', 3)).code;
   const redeem = await step({actor: ACTORS.noGrant, call: `public.redeem_access_code(${q(f.confA)}::uuid, 'A1B2C3D4E5F6A1B2C3D4E5F6')`});
   seen.redeemOldCode = String((JSON.parse(redeem.message) as {status: string}).status);
   const rotate = await step({actor: ACTORS.exec, call: `public.rotate_access_code(${q(f.confA)}::uuid, 'chair', ${q(f.committee.ga1)}::uuid, now() + interval '1 day')`});
   seen.rotateForArchived = `${rotate.code}`;
   seen.grantsLeft = (await owner(`select count(*) from public.user_access where user_id=${q(ACTORS.chairGa1.sub!)} and revoked_at is null`));
  });
  assert.deepEqual(seen, {before: 'ok', archive: 'ok', afterArchive: '42501', redeemOldCode: 'invalid', rotateForArchived: '22023', grantsLeft: '0'});
 });

 await t.test('a grant that is revoked, expires, changes role or is re-scoped stops working in the very next call (no cache, no grace period)', async () => {
  const seen: string[] = [];
  const attendance = cmdOf('attendance');
  await sequence(engine, async (step, owner) => {
   const chair = ACTORS.chairGa1.sub!;
   const write = async (n: number) => (await send(step, 'chairGa1', attendance, 'chair', n)).code;
   seen.push(await write(1));
   await owner(`update public.user_access set role='observer' where user_id=${q(chair)}`);
   seen.push(await write(2));
   await owner(`update public.user_access set role='chair', committee_id=${q(f.committee.who)} where user_id=${q(chair)}`);
   seen.push(await write(3));
   await owner(`update public.user_access set committee_id=${q(f.committee.ga1)} where user_id=${q(chair)}`);
   seen.push(await write(4));
   await owner(`update public.user_access set expires_at=now() - interval '1 second' where user_id=${q(chair)}`);
   seen.push(await write(5));
   await owner(`update public.user_access set expires_at=now() + interval '1 day' where user_id=${q(chair)}`);
   seen.push(await write(6));
   await owner(`update public.user_access set revoked_at=now() where user_id=${q(chair)}`);
   seen.push(await write(7));
   await owner(`delete from public.user_access where user_id=${q(chair)}`);
   seen.push(await write(8));
  });
  assert.deepEqual(seen, ['ok', '42501', '42501', 'ok', '42501', 'ok', '42501', '42501']);
 });

 await t.test('a Closed resolution is final: no role can move it, and it takes no more ballots', async () => {
  const problems: string[] = [];
  const closed = `update public.documents set status='Closed', outcome='Withdrawn' where id=${q(f.docReview)};`;
  const statuses = ['Draft', 'Submitted', 'Review', 'Approved', 'Printed', 'In Debate', 'Closed'];
  for (const [actor, role] of [['chairGa1', 'chair'], ['approval', 'approval'], ['logistics', 'logistics'], ['exec', 'admin'], ['observer', 'observer']] as const) {
   for (const status of statuses) {
    const o = await attempt(engine, {actor: ACTORS[actor], pre: closed, expectedSql: `(select revision::text from public.documents where id=${q(f.docReview)})`,
     call: mutationCall('public.apply_conference_mutation', f.confA, mutationId(1100), {type: 'document', id: f.docReview, status, comment: 'x', outcome: status === 'Closed' ? 'Withdrawn' : undefined}, role, 'valid')});
    if (o.code !== '22023' || o.delta !== 0) problems.push(`${role} -> ${status} on a Closed resolution: expected 22023, got ${o.code} ${o.message} (delta ${o.delta})`);
   }
  }
  const vote = cmdOf('vote');
  const late = await attempt(engine, {actor: ACTORS.chairGa1, pre: `update public.documents set status='Closed', outcome='Withdrawn' where id=${q(f.resolution)};`, expectedSql: vote.expected!(f),
   call: mutationCall('public.apply_conference_mutation', f.confA, mutationId(1101), vote.command(f), 'chair', 'valid')});
  if (late.code !== '22023' || !/active debate/.test(late.message)) problems.push(`a ballot on a Closed resolution: got ${late.code} ${late.message}`);
  assertNone('closed resolution', problems);
 });

 await t.test('OBSERVATION O1: the database lets a committee-scoped Executive grant act on its own committee\'s Executive commands (the app can only issue conference-wide Executive codes, so only direct SQL can create one)', async () => {
  const outcomes: Record<string, string> = {};
  for (const id of ['committeeUpdate', 'session', 'submissionLink', 'school', 'sessionSlot']) {
   const cmd = cmdOf(id);
   const o = await attempt(engine, {actor: ACTORS.execGa1, pre: cmd.pre?.(f), expectedSql: cmd.expected?.(f), call: mutationCall(targetFor(cmd), f.confA, mutationId(1200), cmd.command(f), 'admin', 'valid')});
   outcomes[id] = o.code;
  }
  assert.deepEqual(outcomes, {committeeUpdate: 'ok', session: 'ok', submissionLink: 'ok', school: '42501', sessionSlot: '42501'});
  const rotate = await attempt(engine, {actor: ACTORS.execGa1, call: `public.rotate_access_code(${q(f.confA)}::uuid, 'admin', null, now() + interval '1 day')`});
  assert.equal(rotate.code, '42501', 'but it can never mint access codes');
  const codes = await attempt(engine, {actor: ACTORS.execGa1, call: `public.rotate_access_code(${q(f.confA)}::uuid, 'chair', ${q(f.committee.ga1)}::uuid, now() + interval '1 day')`});
  assert.equal(codes.code, '42501');
 });

 await t.test('OBSERVATION O2: with the Supabase default privileges (service_role holds EXECUTE) the security-definer access-code RPCs trust auth.uid(): a service_role call WITH an Executive sub claim is the Executive, one without a sub is refused', async () => {
  const withSub = {...ACTORS.serviceModel, name: 'service_role + default privileges + Executive sub', sub: ACTORS.exec.sub};
  const call = `public.rotate_access_code(${q(f.confA)}::uuid, 'approval', null, now() + interval '1 day')`;
  assert.equal((await attempt(engine, {actor: withSub, call})).code, 'ok');
  assert.equal((await attempt(engine, {actor: ACTORS.serviceModel, call})).code, '42501');
  assert.equal((await attempt(engine, {actor: ACTORS.serviceSub, call})).code, '42501', 'on the hosted privilege audit (service_role has no EXECUTE) even a forged sub is refused by privilege');
 });

 await t.test('OBSERVATION O4: re-redeeming a still-valid code reinstates a grant that was revoked on its own (revocation of one user is only durable if the credential is revoked too)', async () => {
  const o = await attempt(engine, {
   actor: ACTORS.chairRevoked,
   pre: `insert into private.access_credentials(conference_id,committee_id,role,credential_hash,expires_at) values (${q(f.confA)},${q(f.committee.ga1)},'chair',encode(sha256(convert_to('A1B2C3D4E5F6A1B2C3D4E5F6','UTF8')),'hex'),now() + interval '2 days');`,
   call: `public.redeem_access_code(${q(f.confA)}::uuid, 'A1B2C3D4E5F6A1B2C3D4E5F6')`,
   afterSql: `(select count(*) from public.user_access where user_id=${q(ACTORS.chairRevoked.sub!)} and revoked_at is null and expires_at>now())`});
  assert.equal(o.code, 'ok');
  assert.equal(o.after, '1');
 });

 await t.test('OBSERVATION O5: a session whose state is "closed" is not a write barrier in the database (only archiving is); the Chair can still record attendance in it', async () => {
  const cmd = cmdOf('attendance');
  const o = await attempt(engine, {actor: ACTORS.chairGa1, pre: `update public.sessions set state='closed' where id=${q(f.session)};`, expectedSql: cmd.expected!(f),
   call: mutationCall(targetFor(cmd), f.confA, mutationId(1300), cmd.command(f), 'chair', 'valid')});
  assert.equal(o.code, 'ok');
 });

 // ---- findings ---------------------------------------------------------------------------------------------------

 // FINDING F1. The receipt look-up of every write function precedes the access check. A revoked, expired or
 // re-scoped caller who replays an action that was applied while they still had access gets SUCCESS (and no effect).
 // AGENTS.md "Access revocation takes effect immediately" and the access-code design ("expired or revoked access
 // does not discard the durable outbox") both need the opposite signal to reach a client whose access was
 // withdrawn: the outbox must learn that it lost access, not be told the action was accepted.
 const afterRevocation = async (rep: (typeof REPS)[number]) => {
  const cmd = cmdOf(rep.cmd);
  const result = {} as {first: Outcome; replay: Outcome; fresh: Outcome};
  await sequence(engine, async (step, owner) => {
   if (cmd.pre) await owner(cmd.pre(f));
   const exp0 = (await owner(`select (${cmd.expected!(f)})::text`)) || null;
   const call = (n: number) => mutationCall(targetFor(cmd), f.confA, mutationId(n), cmd.command(f), rep.role, {literal: exp0});
   result.first = await step({actor: ACTORS[rep.actor], call: call(1400)});
   await owner(`update public.user_access set revoked_at=now() where user_id=${q(ACTORS[rep.actor].sub!)}`);
   result.replay = await step({actor: ACTORS[rep.actor], call: call(1400)});
   result.fresh = await step({actor: ACTORS[rep.actor], call: call(1401)});
  });
  return result;
 };
 await t.test('FINDING F1 (characterisation, current behaviour): a replay of an already-applied action by a caller whose grant has since been revoked returns success and writes nothing, in all four implementations; a NEW action is refused', async () => {
  const seen: string[] = [];
  for (const rep of REPS) {
   const r = await afterRevocation(rep);
   seen.push(`${rep.cmd}: first=${r.first.code} replay-after-revoke=${r.replay.code}/${r.replay.delta} new-action-after-revoke=${r.fresh.code}`);
  }
  assert.deepEqual(seen, REPS.map(r => `${r.cmd}: first=ok replay-after-revoke=ok/0 new-action-after-revoke=42501`));
 });
 await t.test('FINDING F1 (documented intent): a replay by a revoked caller must be refused with 42501 so the outbox learns it lost access', {todo: 'FINDING F1: all four write implementations answer a replay from a revoked or expired grant with success, because the idempotency receipt is read before has_access. Nothing is written and the action was applied while access was valid, but the revoked device is told "accepted".'}, async () => {
  const codes: string[] = [];
  for (const rep of REPS) codes.push((await afterRevocation(rep)).replay.code);
  assert.deepEqual(codes, REPS.map(() => '42501'));
 });
}
