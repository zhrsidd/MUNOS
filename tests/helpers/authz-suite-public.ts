import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {ACTORS, ACTOR_KEYS, type Actor, type ActorKey, type Fixture} from './authz-fixture';
import {attempt, sequence, type Outcome} from './authz-matrix';
import {assertNone, type Ctx} from './authz-suite-core';

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const sub = (n: number) => `7e100000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const DOC_ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
const json = (o: Outcome): Record<string, unknown> => { try { return JSON.parse(o.message) as Record<string, unknown>; } catch { return {}; } };

/** Public submissions and link look-ups: reachable only by the server-side service_role (the Next.js route handlers). */
const CALLERS: ActorKey[] = ['anon', 'authNoSub', 'noGrant', 'exec', 'chairGa1', 'approval', 'execB', 'chairRevoked', 'serviceModel'];
const SERVICE: ActorKey[] = ['service', 'serviceSub', 'serviceModel'];

const resolutionCall = (f: Fixture, a: Partial<{token: string; submission: string | null; submitter: string; title: string; doc: string | null; fileName: string | null; storage: string | null; sha: string | null; size: number | null}> = {}) => {
 const v = {token: f.submissionToken, submission: sub(1), submitter: f.france, title: 'Climate resolution', doc: DOC_ID, fileName: null, storage: null, sha: null, size: null, ...a};
 const text = (x: string | null) => (x === null ? 'null::text' : q(x));
 return `public.submit_resolution(${text(v.token)}, ${v.submission === null ? 'null::uuid' : q(v.submission) + '::uuid'}, ${q(v.submitter)}::uuid, ${text(v.title)}, ${text(v.doc)}, ${text(v.fileName)}, ${text(v.storage)}, ${text(v.sha)}, ${v.size === null ? 'null::integer' : v.size})`;
};
const amendmentCall = (f: Fixture, a: Partial<{token: string; submission: string | null; submitter: string; type: string; clause: string; wording: string}> = {}) => {
 const v = {token: f.amendmentToken, submission: sub(2), submitter: f.france, type: 'Add', clause: 'Clause 3', wording: 'Insert a reporting duty.', ...a};
 return `public.submit_amendment(${q(v.token)}, ${v.submission === null ? 'null::uuid' : q(v.submission) + '::uuid'}, ${q(v.submitter)}::uuid, ${q(f.resolution)}::uuid, ${q(v.type)}, ${q(v.clause)}, ${q(v.wording)})`;
};
const openCommittee = (f: Fixture) => `update public.committees set "currentSessionId"=${q(f.session)} where id=${q(f.committee.ga1)};`;
const archiveCommittee = (f: Fixture) => `update public.committees set archived=true where id=${q(f.committee.ga1)};`;

export async function submissionSection(t: TestContext, {engine, f}: Ctx) {
 await t.test('submit_resolution and submit_amendment: EXECUTE is service_role only; anon, signed-in users of every role, revoked users and the default-privilege model all fail before the body runs', async () => {
  const problems: string[] = [];
  for (const [name, call, pre] of [['submit_resolution', resolutionCall(f), ''], ['submit_amendment', amendmentCall(f), openCommittee(f)]] as const) {
   for (const key of ACTOR_KEYS.filter(k => !SERVICE.includes(k))) {
    const o = await attempt(engine, {actor: ACTORS[key], call, pre});
    if (o.code !== '42501' || !/permission denied for function/.test(o.message) || o.delta !== 0) problems.push(`${name} as ${ACTORS[key].name}: expected a privilege denial, got ${o.code} ${o.message} (delta ${o.delta})`);
   }
   for (const key of SERVICE) {
    const o = await attempt(engine, {actor: ACTORS[key], call, pre});
    if (o.code !== 'ok' || json(o).status !== 'created' || o.delta <= 0) problems.push(`${name} as ${ACTORS[key].name}: expected created, got ${o.code} ${o.message}`);
   }
  }
  assertNone('submit_* privileges', problems);
 });

 await t.test('submit_resolution as the server: valid link, invalid / revoked / replaced / archived-committee link, wrong-committee submitter and malformed input', async () => {
  const uploadId = (s: string) => `${s.slice(0, 24)}000000000001`;
  const storage = `${f.confA}/${f.committee.ga1}/${uploadId(sub(7))}/resolution.pdf`;
  const cases: {n: string; call: string; pre?: string; code: string; status?: string; message?: RegExp}[] = [
   {n: 'valid Google Doc submission', call: resolutionCall(f), code: 'ok', status: 'created'},
   {n: 'valid uploaded file under its own storage prefix', call: resolutionCall(f, {submission: sub(7), doc: null, storage, fileName: 'resolution.pdf', sha: 'a'.repeat(64), size: 2048}), code: 'ok', status: 'created'},
   {n: 'unknown link token', call: resolutionCall(f, {token: 'nope_nope_nope_nope_nope_nope'}), code: 'P0001', message: /^invalid_link$/},
   {n: 'revoked link token', call: resolutionCall(f, {token: f.revokedSubmissionToken}), code: 'P0001', message: /^invalid_link$/},
   {n: 'link replaced by a rotation (the old token)', call: resolutionCall(f), code: 'P0001', message: /^invalid_link$/,
    pre: `update public.submission_links set revoked_at=now() where token=${q(f.submissionToken)}; insert into public.submission_links(conference_id,committee_id,token,share_with) values (${q(f.confA)},${q(f.committee.ga1)},'sub_rotated_token_zzzzzzzzzzz','');`},
   {n: 'the replacement token of a rotated link', call: resolutionCall(f, {token: 'sub_rotated_token_zzzzzzzzzzz'}), code: 'ok', status: 'created',
    pre: `update public.submission_links set revoked_at=now() where token=${q(f.submissionToken)}; insert into public.submission_links(conference_id,committee_id,token,share_with) values (${q(f.confA)},${q(f.committee.ga1)},'sub_rotated_token_zzzzzzzzzzz','');`},
   {n: 'committee archived after the link was issued', call: resolutionCall(f), pre: archiveCommittee(f), code: 'P0001', message: /^invalid_link$/},
   {n: 'submitter from ANOTHER committee', call: resolutionCall(f, {submitter: f.brazilWho}), code: 'P0001', message: /^invalid_submitter$/},
   {n: 'submitter id of nobody', call: resolutionCall(f, {submitter: sub(99)}), code: 'P0001', message: /^invalid_submitter$/},
   {n: 'both a Google Doc and an upload', call: resolutionCall(f, {storage, fileName: 'x.pdf', sha: 'a'.repeat(64), size: 10}), code: 'P0001', message: /^invalid_source$/},
   {n: 'neither a Google Doc nor an upload', call: resolutionCall(f, {doc: null}), code: 'P0001', message: /^invalid_source$/},
   {n: 'malformed Google Doc id', call: resolutionCall(f, {doc: 'short'}), code: 'P0001', message: /^invalid_google_doc$/},
   {n: 'title too short', call: resolutionCall(f, {title: 'ab'}), code: 'P0001', message: /^invalid_title$/},
   {n: 'upload outside the committee\'s storage prefix', call: resolutionCall(f, {doc: null, storage: `${f.confA}/${f.committee.who}/${uploadId(sub(1))}/x.pdf`, fileName: 'x.pdf', sha: 'a'.repeat(64), size: 10}), code: 'P0001', message: /^invalid_storage_key$/},
  ];
  const problems: string[] = [];
  for (const c of cases) for (const key of SERVICE) {
   const o = await attempt(engine, {actor: ACTORS[key], call: c.call, pre: c.pre});
   const cell = `${c.n} :: ${ACTORS[key].name}`;
   if (o.code !== c.code) { problems.push(`${cell}: expected ${c.code}, got ${o.code} ${o.message}`); continue; }
   if (c.status && json(o).status !== c.status) problems.push(`${cell}: expected ${c.status}, got ${o.message}`);
   if (c.message && !c.message.test(o.message)) problems.push(`${cell}: unexpected message ${o.message}`);
   if (c.code !== 'ok' && o.delta !== 0) problems.push(`${cell}: refused but changed ${o.delta} rows`);
  }
  assertNone('submit_resolution', problems);
 });

 await t.test('submit_resolution is idempotent per submission id: replay, conflicting payload, duplicate document', async () => {
  const seen: string[] = [];
  await sequence(engine, async step => {
   const svc = ACTORS.service;
   const run = async (call: string) => { const o = await step({actor: svc, call}); return o.code === 'ok' ? `${json(o).status}${o.delta > 0 ? '+' : '0'}` : `${o.code}:${o.message}`; };
   seen.push(await run(resolutionCall(f)));                                          // first
   seen.push(await run(resolutionCall(f)));                                          // retry of the same request
   seen.push(await run(resolutionCall(f, {title: 'A different title'})));            // same id, different request
   seen.push(await run(resolutionCall(f, {submission: sub(3)})));                    // new id, same Google Doc: not a second resolution
   seen.push(await run(resolutionCall(f, {submission: null})));                      // no idempotency key at all
  });
  assert.deepEqual(seen.slice(0, 4), ['created+', 'replayed0', '22023:idempotency_conflict', 'duplicate+']);
  assert.match(seen[4], /^23502:/, 'a missing submission id is refused by a NOT NULL violation (submit_amendment answers idempotency_conflict)');
 });

 await t.test('submit_amendment as the server: needs an open debate; invalid / revoked / archived link, wrong-committee submitter and malformed amendment are refused', async () => {
  const cases: {n: string; call: string; pre?: string; code: string; status?: string; message?: RegExp}[] = [
   {n: 'valid amendment during debate', call: amendmentCall(f), pre: openCommittee(f), code: 'ok', status: 'created'},
   {n: 'no current session selected (debate not open)', call: amendmentCall(f), code: '22023', message: /^not_open$/},
   {n: 'resolution not in debate', call: amendmentCall(f), pre: `${openCommittee(f)} update public.documents set status='Closed', outcome='Withdrawn' where id=${q(f.resolution)};`, code: '22023', message: /^not_open$/},
   {n: 'unknown link token', call: amendmentCall(f, {token: 'nope_nope_nope_nope_nope_nope'}), pre: openCommittee(f), code: '22023', message: /^invalid_link$/},
   {n: 'revoked link token', call: amendmentCall(f), pre: `${openCommittee(f)} update public.amendment_links set revoked_at=now() where token=${q(f.amendmentToken)};`, code: '22023', message: /^invalid_link$/},
   {n: 'committee archived', call: amendmentCall(f), pre: `${openCommittee(f)} ${archiveCommittee(f)}`, code: '22023', message: /^invalid_link$/},
   {n: 'submitter from ANOTHER committee', call: amendmentCall(f, {submitter: f.brazilWho}), pre: openCommittee(f), code: '22023', message: /^invalid_submitter$/},
   {n: 'unknown amendment type', call: amendmentCall(f, {type: 'Delete'}), pre: openCommittee(f), code: '22023', message: /^invalid_amendment$/},
   {n: 'empty wording', call: amendmentCall(f, {wording: '   '}), pre: openCommittee(f), code: '22023', message: /^invalid_amendment$/},
   {n: 'no idempotency key', call: amendmentCall(f, {submission: null}), pre: openCommittee(f), code: '22023', message: /^idempotency_conflict$/},
  ];
  const problems: string[] = [];
  for (const c of cases) for (const key of SERVICE) {
   const o = await attempt(engine, {actor: ACTORS[key], call: c.call, pre: c.pre});
   const cell = `${c.n} :: ${ACTORS[key].name}`;
   if (o.code !== c.code) { problems.push(`${cell}: expected ${c.code}, got ${o.code} ${o.message}`); continue; }
   if (c.status && json(o).status !== c.status) problems.push(`${cell}: expected ${c.status}, got ${o.message}`);
   if (c.message && !c.message.test(o.message)) problems.push(`${cell}: unexpected message ${o.message}`);
   if (c.code !== 'ok' && o.delta !== 0) problems.push(`${cell}: refused but changed ${o.delta} rows`);
  }
  assertNone('submit_amendment', problems);
  const seen: string[] = [];
  await sequence(engine, async (step, owner) => {
   await owner(openCommittee(f));
   const run = async (call: string) => { const o = await step({actor: ACTORS.service, call}); return o.code === 'ok' ? `${json(o).status}${o.delta > 0 ? '+' : '0'}` : `${o.code}:${o.message}`; };
   seen.push(await run(amendmentCall(f)));
   seen.push(await run(amendmentCall(f)));
   seen.push(await run(amendmentCall(f, {wording: 'Something else entirely.'})));
   seen.push(await run(amendmentCall(f, {submission: sub(4)})));
  });
  assert.deepEqual(seen, ['created+', 'replayed0', '22023:idempotency_conflict', 'duplicate0']);
 });

 await t.test('submission_link_info and amendment_link_info: service_role only; valid links resolve, revoked / unknown / archived links resolve to nothing', async () => {
  const problems: string[] = [];
  const reads: [string, (token: string) => string, string, string, string][] = [
   ['submission_link_info', t => `public.submission_link_info(${q(t)})`, f.submissionToken, f.revokedSubmissionToken, 'committeeCode'],
   ['amendment_link_info', t => `public.amendment_link_info(${q(t)})`, f.amendmentToken, 'nope_nope_nope_nope_nope_nope', 'committee'],
  ];
  for (const [name, call, good, bad, field] of reads) {
   for (const key of ACTOR_KEYS.filter(k => !SERVICE.includes(k))) {
    const o = await attempt(engine, {actor: ACTORS[key], call: call(good)});
    if (o.code !== '42501' || !/permission denied for function/.test(o.message)) problems.push(`${name} as ${ACTORS[key].name}: expected a privilege denial, got ${o.code} ${o.message}`);
   }
   for (const key of SERVICE) {
    const ok = await attempt(engine, {actor: ACTORS[key], call: call(good)});
    if (ok.code !== 'ok' || !ok.message.includes(field)) problems.push(`${name} valid link as ${ACTORS[key].name}: ${ok.code} ${ok.message.slice(0, 120)}`);
    const none = await attempt(engine, {actor: ACTORS[key], call: call(bad)});
    if (none.code !== 'ok' || none.message !== '') problems.push(`${name} bad link as ${ACTORS[key].name}: expected nothing, got ${none.message.slice(0, 120)}`);
    const archived = await attempt(engine, {actor: ACTORS[key], call: call(good), pre: archiveCommittee(f)});
    if (archived.code !== 'ok' || archived.message !== '') problems.push(`${name} archived committee as ${ACTORS[key].name}: expected nothing, got ${archived.message.slice(0, 120)}`);
   }
  }
  assertNone('link_info', problems);
 });
}

// ---- helper functions executable by authenticated -----------------------------------------------------------------

type Doc = {id: string; committee: string; status: string};
/** The documented read rule of private.document_submitter_countries, restated independently. */
function visibleDocuments(actor: Actor, docs: Doc[], f: Fixture): string[] {
 const g = actor.grant;
 if (actor.db !== 'authenticated' || !actor.sub || !g || g.conf !== 'A' || g.state !== 'active') return [];
 const reaches = (committee: string) => g.scope === null || f.committee[g.scope] === committee;
 return docs.filter(d => reaches(d.committee) && (
  ['chair', 'admin', 'observer'].includes(g.role)
  || (g.role === 'approval' && ['Submitted', 'Review', 'Approved'].includes(d.status))
  || (g.role === 'logistics' && ['Approved', 'Printed', 'In Debate', 'Closed'].includes(d.status)))).map(d => d.id);
}

export async function helperSection(t: TestContext, {engine, f}: Ctx) {
 const docs = JSON.parse(await engine.run(`select json_agg(json_build_object('id', id, 'committee', committee_id, 'status', status))::text from public.documents`)) as Doc[];
 const NOT_SIGNED_IN = (a: Actor) => a.db !== 'authenticated';

 await t.test('private.access_grants() and private.has_access(): callable only by authenticated, and only ever describe the CALLER (revoked, expired and other-conference grants never count)', async () => {
  const problems: string[] = [];
  for (const key of ACTOR_KEYS) {
   const a = ACTORS[key];
   const grants = await attempt(engine, {actor: a, call: 'private.access_grants()'});
   if (NOT_SIGNED_IN(a)) {
    if (grants.code !== '42501') problems.push(`access_grants as ${a.name}: expected a privilege denial, got ${grants.code}`);
   } else {
    const rows = (JSON.parse(grants.message || '[]') as {conference_id: string; role: string}[]);
    const live = !!a.sub && !!a.grant && a.grant.state === 'active';
    if (rows.length !== (live ? 1 : 0)) problems.push(`access_grants as ${a.name}: ${rows.length} rows, expected ${live ? 1 : 0}`);
    if (live && (rows[0].role !== a.grant!.role || rows[0].conference_id !== (a.grant!.conf === 'A' ? f.confA : f.confB))) problems.push(`access_grants as ${a.name}: wrong row ${grants.message}`);
   }
   for (const role of ['chair', 'admin', 'approval', 'logistics', 'observer'] as const) {
    const o = await attempt(engine, {actor: a, call: `private.has_access(${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, array['${role}']::public.conference_role[])`});
    if (NOT_SIGNED_IN(a)) { if (o.code !== '42501') problems.push(`has_access(${role}) as ${a.name}: expected a privilege denial, got ${o.code}`); continue; }
    const g = a.grant;
    const want = !!a.sub && !!g && g.conf === 'A' && g.state === 'active' && g.role === role && (g.scope === null || g.scope === 'ga1');
    if (o.code !== 'ok' || o.message !== (want ? 'true' : 'false')) problems.push(`has_access(${role}, GA1) as ${a.name}: expected ${want}, got ${o.code} ${o.message}`);
   }
  }
  assertNone('access_grants / has_access', problems);
 });

 await t.test('private.document_submitter_countries(): each role sees only the documents its read rule allows; nobody else sees anything', async () => {
  const problems: string[] = [];
  for (const key of ACTOR_KEYS) {
   const a = ACTORS[key];
   const o = await attempt(engine, {actor: a, call: `private.document_submitter_countries(${q(f.confA)}::uuid)`});
   if (NOT_SIGNED_IN(a)) { if (o.code !== '42501') problems.push(`as ${a.name}: expected a privilege denial, got ${o.code}`); continue; }
   if (o.code !== 'ok') { problems.push(`as ${a.name}: ${o.code} ${o.message}`); continue; }
   const got = Object.keys(JSON.parse(o.message) as object).sort();
   const want = visibleDocuments(a, docs, f).sort();
   if (got.join() !== want.join()) problems.push(`as ${a.name}: sees ${got.length} documents, documented rule says ${want.length}`);
  }
  assertNone('document_submitter_countries', problems);
 });

 await t.test('private.decision_history() and private.photo_chairs(): committee-scoped reads, empty for everyone without a live grant', async () => {
  const pre = `insert into public.document_comments(conference_id,committee_id,"documentId",text) values
    (${q(f.confA)},${q(f.committee.ga1)},${q(f.docReview)},'GA1 comment'), (${q(f.confA)},${q(f.committee.who)},${q(f.docApproved)},'WHO comment');
   update public.staff set "schoolId"=${q(f.schoolA)} where id=${q(f.chairStaff)};
   insert into public.committee_staff(conference_id,committee_id,staff_id) values (${q(f.confA)},${q(f.committee.ga1)},${q(f.chairStaff)}),(${q(f.confA)},${q(f.committee.who)},${q(f.chairStaff)}) on conflict do nothing;`;
  const problems: string[] = [];
  const reach = (a: Actor, committee: 'ga1' | 'who', roles: string[]) => {
   const g = a.grant;
   return a.db === 'authenticated' && !!a.sub && !!g && g.conf === 'A' && g.state === 'active' && roles.includes(g.role) && (g.scope === null || g.scope === committee);
  };
  for (const key of ACTOR_KEYS) {
   const a = ACTORS[key];
   const history = await attempt(engine, {actor: a, pre, call: `private.decision_history(${q(f.confA)}::uuid)`});
   const photo = await attempt(engine, {actor: a, pre, call: `private.photo_chairs(${q(f.confA)}::uuid)`});
   if (NOT_SIGNED_IN(a)) {
    if (history.code !== '42501' || photo.code !== '42501') problems.push(`as ${a.name}: expected privilege denials, got ${history.code}/${photo.code}`);
    continue;
   }
   const wantHistory = (['ga1', 'who'] as const).filter(c => reach(a, c, ['approval', 'chair', 'admin', 'observer'])).length;
   const wantPhoto = (['ga1', 'who'] as const).filter(c => reach(a, c, ['admin', 'chair', 'observer'])).length;
   if (history.code !== 'ok' || (JSON.parse(history.message) as unknown[]).length !== wantHistory) problems.push(`decision_history as ${a.name}: expected ${wantHistory} entries, got ${history.code} ${history.message.slice(0, 100)}`);
   if (photo.code !== 'ok' || (JSON.parse(photo.message) as unknown[]).length !== wantPhoto) problems.push(`photo_chairs as ${a.name}: expected ${wantPhoto} rows, got ${photo.code} ${photo.message.slice(0, 100)}`);
  }
  assertNone('decision_history / photo_chairs', problems);
 });

 await t.test('private.permitted() and private.uuid_or_null(): pure helpers, callable by authenticated only', async () => {
  const problems: string[] = [];
  const grants = (list: object[]) => q(JSON.stringify(list));
  const cases: [string, boolean][] = [
   [`private.permitted(${grants([{conference_id: f.confA, committee_id: null, role: 'admin'}])}::jsonb, ${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, array['admin']::public.conference_role[])`, true],
   [`private.permitted(${grants([{conference_id: f.confA, committee_id: f.committee.ga1, role: 'chair'}])}::jsonb, ${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, array['chair']::public.conference_role[])`, true],
   [`private.permitted(${grants([{conference_id: f.confA, committee_id: f.committee.ga1, role: 'chair'}])}::jsonb, ${q(f.confA)}::uuid, ${q(f.committee.who)}::uuid, array['chair']::public.conference_role[])`, false],
   [`private.permitted(${grants([{conference_id: f.confA, committee_id: f.committee.ga1, role: 'chair'}])}::jsonb, ${q(f.confA)}::uuid, null, array['chair']::public.conference_role[])`, false],
   [`private.permitted(${grants([{conference_id: f.confB, committee_id: null, role: 'admin'}])}::jsonb, ${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, array['admin']::public.conference_role[])`, false],
   [`private.permitted(${grants([{conference_id: f.confA, committee_id: null, role: 'approval'}])}::jsonb, ${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, array['admin','chair']::public.conference_role[])`, false],
   [`private.uuid_or_null(${q(f.session)}) is not null`, true],
   [`private.uuid_or_null('not-a-uuid') is null`, true],
   [`private.uuid_or_null('${f.session}; drop table x') is null`, true],
  ];
  for (const [call, want] of cases) {
   const o = await attempt(engine, {actor: ACTORS.chairGa1, call});
   if (o.code !== 'ok' || o.message !== String(want)) problems.push(`${call.slice(0, 90)}: expected ${want}, got ${o.code} ${o.message}`);
   for (const key of ['anon', 'service', 'serviceModel'] as const) {
    const denied = await attempt(engine, {actor: ACTORS[key], call});
    if (denied.code !== '42501') problems.push(`${call.slice(0, 60)} as ${ACTORS[key].name}: expected a privilege denial, got ${denied.code}`);
   }
  }
  assertNone('permitted / uuid_or_null', problems);
 });

 await t.test('private helpers that authenticated does NOT hold (id allocation, print copies, photo epochs) refuse every principal', async () => {
  const calls = [
   `private.next_resolution_code(${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid)`,
   `private.print_copies(${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid)`,
   `private.advance_photo_epoch(${q(f.confA)}::uuid, array[]::uuid[], array[]::uuid[])`,
   `private.submitter_country(${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, ${q(f.france)}::uuid)`,
   `private.ops_point_adjustment(${q(f.confA)}::uuid, ${q(f.committee.ga1)}::uuid, ${q(ACTORS.chairGa1.sub!)}::uuid, gen_random_uuid(), '{}'::jsonb)`,
   `private.require_operational_session(${q(f.confA)}::uuid, ${q(f.session)}::uuid)`,
  ];
  const problems: string[] = [];
  for (const call of calls) for (const key of ['anon', 'authNoSub', 'noGrant', 'exec', 'chairGa1', 'service', 'serviceModel'] as const) {
   const o = await attempt(engine, {actor: ACTORS[key], call});
   if (o.code !== '42501' || !/permission denied/.test(o.message)) problems.push(`${call.slice(0, 50)} as ${ACTORS[key].name}: expected a privilege denial, got ${o.code} ${o.message}`);
  }
  assertNone('non-executable helpers', problems);
 });
}
