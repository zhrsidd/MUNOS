// Pure helpers for the hosted rehearsal's request-fault scenarios (S5, S6). No browser, no network: unit-tested in
// tests/rehearsal-delivery-audit.test.ts. They exist so a fault rule cannot pass while hiding a rejected delivery.
import assert from 'node:assert/strict';

/** A PostgREST RPC reply is an accepted commit only if the status is 2xx and the body is not an error object. */
export function rpcAccepted(status, bodyText) {
  if (!(status >= 200 && status < 300)) return false;
  if (!bodyText || !bodyText.trim()) return true;
  let body;
  try { body = JSON.parse(bodyText); } catch { return false; }
  if (body && typeof body === 'object' && !Array.isArray(body) && ('code' in body && 'message' in body || 'error' in body || 'error_description' in body)) return false;
  return true;
}

/** Mutation uuid and the exact payload of a captured apply_*_mutation request body. */
export function mutationOf(postData) {
  const payload = JSON.parse(postData ?? 'null');
  assert.ok(payload && typeof payload.mutation === 'string' && payload.mutation, 'request carries no mutation uuid');
  return {mutation: payload.mutation, payload: postData};
}

export class DeliveryLog {
  constructor() { this.records = []; }
  /** `status`/`body` are the UPSTREAM reply, or undefined when the request never reached the server. */
  record(label, postData, status, body) {
    const {mutation, payload} = mutationOf(postData);
    this.records.push({label, mutation, payload, status, body, accepted: status === undefined ? null : rpcAccepted(status, body)});
  }
  /** Every delivery or retry carries the same mutation uuid and the identical full payload. */
  assertIdentical(expected = 1) {
    assert.ok(this.records.length >= expected, `expected at least ${expected} delivery record(s), saw ${this.records.length}`);
    const [first, ...rest] = this.records;
    for (const r of rest) {
      assert.equal(r.mutation, first.mutation, `${r.label} used a different mutation uuid than ${first.label}`);
      assert.equal(r.payload, first.payload, `${r.label} carried a different payload than ${first.label}`);
    }
  }
  /** Every listed record reached the server and was an accepted commit (2xx, no RPC error). */
  assertAccepted(...labels) {
    const chosen = labels.length ? this.records.filter(r => labels.includes(r.label)) : this.records.filter(r => r.status !== undefined);
    assert.ok(chosen.length >= Math.max(1, labels.length), `no upstream replies recorded for ${labels.join(', ') || 'any delivery'}`);
    for (const r of chosen) assert.equal(r.accepted, true, `${r.label} was not an accepted commit (status ${r.status})`);
  }
}

// ------------------------------------------------------------------------------------------------ convergence digest
const byKey = (rows, key) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
export const pointsOf = (d, id) => d.events.filter(e => e.delegateId === id && !e.voidedAt).reduce((n, e) => n + e.points, 0)
  + (d.pointAdjustments ?? []).filter(a => a.delegateId === id).reduce((n, a) => n + a.points, 0);

/**
 * Deterministic, value-level view of everything the rehearsal touches in one committee, for A / B / server equality.
 * Every row is serialised as an explicit tuple in a fixed field order and sorted, so object key order never matters.
 * Excluded on purpose, because they differ per read and say nothing about convergence: createdAt, updatedAt, and the
 * timestamps voidedAt / recognizedAt (kept as booleans). Everything else a Chair can see or change is included:
 * statuses, choices, positions, states, points, revisions.
 */
export function stateDigest(d, committeeCode) {
  const committee = d.committees.find(c => c.code === committeeCode);
  assert.ok(committee, `committee ${committeeCode} not found`);
  const sessionId = committee.currentSessionId;
  const delegates = d.delegates.filter(x => x.committeeId === committee.id);
  const resolution = d.documents.find(r => r.committeeId === committee.id && r.status === 'In Debate');
  const speeches = (d.speeches ?? []).filter(s => s.sessionId === sessionId);
  const speechIds = new Set(speeches.map(s => s.id));
  return JSON.stringify({
    current: [committee.currentSessionId, committee.sessionRevision ?? 0],
    attendance: byKey(d.attendance.filter(a => a.sessionId === sessionId), a => a.delegateId).map(a => [a.delegateId, a.status, a.revision ?? 0]),
    events: byKey(d.events.filter(e => e.sessionId === sessionId), e => e.id).map(e => [e.id, e.delegateId, e.categoryId, e.points, e.sessionId, e.resolutionId ?? null, e.speechId ?? null, e.classification ?? null, Boolean(e.voidedAt), e.revision ?? 0]),
    points: byKey(delegates, x => x.id).map(x => [x.id, pointsOf(d, x.id)]),
    votes: byKey(d.votes.filter(v => v.resolutionId === resolution?.id && v.sessionId === sessionId), v => v.id).map(v => [v.id, v.delegateId, v.resolutionId, v.sessionId, v.choice, v.revision ?? 0]),
    queue: byKey(d.queue.filter(q => q.sessionId === sessionId), q => `${q.lane ?? 'open'}/${String(q.position).padStart(8, '0')}/${q.id}`).map(q => [q.id, q.delegateId, q.lane ?? 'open', q.position]),
    speeches: byKey(speeches, s => s.id).map(s => [s.id, s.delegateId, s.state, s.classification, s.resolutionId ?? null, s.amendmentId ?? null, s.yieldedFrom ?? null, s.poiLimit ?? null, s.poiCount ?? 0, s.revision ?? 0]),
    pois: byKey((d.poiQueue ?? []).filter(p => speechIds.has(p.speechId)), p => p.id).map(p => [p.id, p.speechId, p.delegateId, p.position, Boolean(p.recognizedAt)]),
    debate: (d.debateStates ?? []).filter(s => s.sessionId === sessionId).map(s => [s.mode, s.phase, s.revision ?? 0]),
  });
}

// ------------------------------------------------------------------------------------------- deployment under test
const SUPABASE_HOST = /https:\/\/[a-z0-9]{20}\.supabase\.co/g;

/** The browser may only open the base origin (the app) and the validated Supabase origin. Anything else could carry a code. */
export function allowedRequest(url, {baseOrigin, supabaseOrigin}) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  return u.origin === baseOrigin || (supabaseOrigin != null && u.origin === supabaseOrigin);
}

/**
 * Offline (zero network) check of the operator's inputs: REHEARSAL_BASE_URL must be https (or a localhost build) and its origin
 * must equal REHEARSAL_EXPECTED_ORIGIN, supplied independently of the URL. Throws before anything is contacted.
 */
export function checkBaseOrigin(baseUrl, expectedOrigin) {
  let u;
  try { u = new URL(baseUrl); } catch { throw Error('REHEARSAL_BASE_URL is not a valid URL'); }
  const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (!(u.protocol === 'https:' || local)) throw Error('REHEARSAL_BASE_URL must be https (or a localhost build)');
  if (u.username || u.password) throw Error('REHEARSAL_BASE_URL must not carry credentials');
  if (!expectedOrigin) throw Error('REHEARSAL_EXPECTED_ORIGIN is required and must equal the origin of REHEARSAL_BASE_URL');
  if (u.origin !== new URL(expectedOrigin).origin) throw Error('REHEARSAL_BASE_URL origin does not equal REHEARSAL_EXPECTED_ORIGIN');
  return u.origin;
}

/**
 * The deployment's own client bundles embed its NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_CONFERENCE_ID. Require both to be
 * those of the validated target and refuse if the bundles reference any other Supabase project.
 */
export function checkBundles(texts, {supabaseUrl, conferenceId}) {
  const origin = new URL(supabaseUrl).origin;
  const all = texts.join('\n');
  assert.ok(all.length > 0, 'no client bundles were read from the deployment');
  const hosts = new Set(all.match(SUPABASE_HOST) ?? []);
  assert.ok(hosts.has(origin), 'the deployment does not embed the validated Supabase project URL');
  const other = [...hosts].filter(h => h !== origin);
  assert.deepEqual(other, [], `the deployment references another Supabase project: ${other.map(h => new URL(h).hostname.split('.')[0]).join(', ')}`);
  assert.ok(all.includes(conferenceId), 'the deployment does not embed the validated conference id');
}

/** Optional pin of the app build: /api/health reports `app.commit`. */
export function checkHealthIdentity(report, expectedCommit) {
  if (!expectedCommit) return;
  assert.equal(report?.app?.commit, expectedCommit, 'the deployment build commit is not the expected one');
}
