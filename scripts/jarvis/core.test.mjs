import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState, evaluateSnapshot, canPlaceCall, recordCallAttempt, phoneScript,
  clearRecoveredIncidents, interpretHealthReport,
} from "./core.mjs";

const healthy = (delegates = 286, committees = 18) => ({
  databaseOk: true, conferenceExists: true, siteOk: true,
  counts: { delegates, committees },
});
const ids = result => result.incidents.map(x => x.id);

test("normal checks produce no incidents", () => {
  let state = initialState();
  for (let i = 0; i < 10; i++) {
    const result = evaluateSnapshot(healthy(), state);
    assert.deepEqual(ids(result), []);
    state = result.state;
  }
});
test("database outage requires three consecutive checks", () => {
  let state = evaluateSnapshot(healthy(), initialState()).state;
  for (let i = 1; i <= 3; i++) {
    const result = evaluateSnapshot({ databaseOk: false }, state);
    assert.deepEqual(ids(result), i < 3 ? [] : ["supabase-unreachable"]);
    state = result.state;
  }
  assert.deepEqual(ids(evaluateSnapshot(healthy(), state)), []);
});
test("unconfigured site check never triggers an alert", () => {
  let state = initialState();
  for (let i = 0; i < 5; i++) {
    const result = evaluateSnapshot({ ...healthy(), siteOk: null }, state);
    assert.deepEqual(ids(result), []);
    state = result.state;
  }
});
test("application outage requires three consecutive checks", () => {
  let state = initialState();
  for (let i = 1; i <= 3; i++) {
    const result = evaluateSnapshot({ ...healthy(), siteOk: false }, state);
    assert.deepEqual(ids(result), i < 3 ? [] : ["site-unreachable"]);
    state = result.state;
  }
});
test("normal count fluctuations do not trigger escalation", () => {
  let state = evaluateSnapshot(healthy(), initialState()).state;
  for (const num of [281, 280, 279, 286]) {
    const result = evaluateSnapshot(healthy(num), state);
    assert.deepEqual(ids(result), []);
    state = result.state;
  }
});
test("substantial delegate loss must persist for two checks", () => {
  let state = evaluateSnapshot(healthy(), initialState()).state;
  let result = evaluateSnapshot(healthy(220), state);
  assert.deepEqual(ids(result), []);
  result = evaluateSnapshot(healthy(220), result.state);
  assert.deepEqual(ids(result), ["mass-delegates-loss"]);
});
test("substantial committee loss must persist for two checks", () => {
  let state = evaluateSnapshot(healthy(), initialState()).state;
  let result = evaluateSnapshot(healthy(286, 12), state);
  assert.deepEqual(ids(result), []);
  result = evaluateSnapshot(healthy(286, 12), result.state);
  assert.deepEqual(ids(result), ["mass-committees-loss"]);
});
test("missing conference requires two reads", () => {
  const sample = { databaseOk: true, conferenceExists: false, siteOk: true };
  const one = evaluateSnapshot(sample, initialState());
  assert.deepEqual(ids(one), []);
  assert.deepEqual(ids(evaluateSnapshot(sample, one.state)), ["conference-missing"]);
});
test("call cooldown, rolling-day and total quotas", () => {
  const now = 2_000_000_000_000;
  const state = initialState();
  assert.equal(canPlaceCall(state, "a", now).allowed, true);
  recordCallAttempt(state, "a", now);
  assert.equal(canPlaceCall(state, "a", now + 60_000).allowed, false);
  assert.equal(canPlaceCall(state, "a", now + 31 * 60_000).allowed, false);
  for (let i = 0; i < 5; i++) recordCallAttempt(state, "id" + i, now);
  assert.equal(canPlaceCall(state, "something-new", now + 31 * 60_000).allowed, false);
  for (let i = 0; i < 6; i++) recordCallAttempt(state, "historical" + i, now - 25 * 60 * 60_000);
  assert.equal(canPlaceCall(state, "anything", now + 31 * 60_000).allowed, false);
});
test("an ongoing incident never calls twice until it has resolved", () => {
  const now = 2_000_000_000_000;
  const state = initialState();
  recordCallAttempt(state, "supabase-unreachable", now);
  assert.deepEqual(canPlaceCall(state, "supabase-unreachable", now + 24 * 60 * 60_000).allowed, false);
  delete state.notifiedActive["supabase-unreachable"];
  assert.deepEqual(canPlaceCall(state, "supabase-unreachable", now + 24 * 60 * 60_000).allowed, true);
});
test("spoken message is short and contains no personal data", () => {
  const item = evaluateSnapshot({ databaseOk: false },
    { ...initialState(), consecutive: { ...initialState().consecutive, db: 2 } }).incidents[0];
  const speech = phoneScript(item);
  assert.match(speech, /come to your laptop/);
  assert.ok(speech.length < 350);
});

test("an unverifiable database state is never a strike and never clears one", () => {
  let state = evaluateSnapshot(healthy(), initialState()).state;
  state = evaluateSnapshot({ databaseOk: false }, state).state;
  state = evaluateSnapshot({ databaseOk: false }, state).state;
  assert.equal(state.consecutive.db, 2);
  for (let i = 0; i < 5; i++) {
    const result = evaluateSnapshot({ databaseOk: null, siteOk: true }, state);
    assert.deepEqual(ids(result), []);
    assert.equal(result.state.consecutive.db, 2);
    state = result.state;
  }
  assert.deepEqual(ids(evaluateSnapshot({ databaseOk: false, siteOk: true }, state)), ["supabase-unreachable"]);
});
test("health-endpoint snapshots without counts or a conference record raise no population alerts", () => {
  let state = initialState();
  for (let i = 0; i < 6; i++) {
    const result = evaluateSnapshot({ databaseOk: true, siteOk: true }, state);
    assert.deepEqual(ids(result), []);
    state = result.state;
  }
});
test("site failure with unknown database still needs three consecutive checks", () => {
  let state = initialState();
  for (let i = 1; i <= 3; i++) {
    const result = evaluateSnapshot({ databaseOk: null, siteOk: false }, state);
    assert.deepEqual(ids(result), i < 3 ? [] : ["site-unreachable"]);
    state = result.state;
  }
});

const report = (database, extra = {}) => JSON.stringify({
  status: "ok", checks: { supabase: { status: "ok" }, database, storage: { status: "ok" }, ...extra },
});
test("health report: ok and slow-but-working are healthy; rejected or unconfigured are not verified", () => {
  assert.equal(interpretHealthReport(200, report({ status: "ok", latencyMs: 400 })).databaseOk, true);
  assert.equal(interpretHealthReport(200, report({ status: "degraded", latencyMs: 3100 })).databaseOk, true);
  // HTTP 401/403 from the database probe is reported as degraded with a detail: not verified healthy.
  for (const detail of ["HTTP 401", "HTTP 403", "HTTP 404"]) {
    const sample = interpretHealthReport(200, report({ status: "degraded", latencyMs: 90, detail }));
    assert.deepEqual(sample, { databaseOk: null, siteOk: true });
  }
  assert.equal(interpretHealthReport(200, report({ status: "not_configured" })).databaseOk, null);
});
test("health report: database or Supabase down is a failure; bad responses mean the site is failing", () => {
  assert.deepEqual(interpretHealthReport(503, report({ status: "down", detail: "HTTP 500" })), { databaseOk: false, siteOk: true });
  assert.equal(interpretHealthReport(200, report({ status: "ok" }, { supabase: { status: "down" } })).databaseOk, false);
  for (const [code, body] of [[200, "<html>login</html>"], [404, "{}"], [502, report({ status: "ok" })], [200, "{\"x\":1}"]]) {
    assert.deepEqual(interpretHealthReport(code, body), { databaseOk: null, siteOk: false });
  }
});
test("a responding site breaks the site-failure streak even while the database is failing", () => {
  let state = initialState();
  const run = sample => { const r = evaluateSnapshot(sample, state); state = r.state; return r.incidents.map(x => x.id); };
  assert.deepEqual(run({ databaseOk: null, siteOk: false }), []);
  assert.deepEqual(run({ databaseOk: null, siteOk: false }), []);
  assert.deepEqual(run({ databaseOk: false, siteOk: true }), []);
  assert.equal(state.consecutive.site, 0);
  assert.deepEqual(run({ databaseOk: null, siteOk: false }), []); // streak restarted at 1, no site incident
  assert.equal(state.consecutive.site, 1);
});
test("a database failure and an unreachable site can both be reported in one check", () => {
  const state = { ...initialState(), consecutive: { ...initialState().consecutive, db: 2, site: 2 } };
  const found = evaluateSnapshot({ databaseOk: false, siteOk: false }, state).incidents.map(x => x.id);
  assert.deepEqual(found, ["supabase-unreachable", "site-unreachable"]);
});
test("a notified incident is only forgotten when its own signal confirms recovery", () => {
  const now = 2_000_000_000_000;
  const state = initialState();
  recordCallAttempt(state, "supabase-unreachable", now);
  // Endpoint unreachable: the database signal is unknown, so the call stays suppressed.
  clearRecoveredIncidents(state, { databaseOk: null, siteOk: false });
  assert.equal(state.notifiedActive["supabase-unreachable"], true);
  clearRecoveredIncidents(state, { databaseOk: null, siteOk: true });
  assert.equal(state.notifiedActive["supabase-unreachable"], true);
  clearRecoveredIncidents(state, { databaseOk: false, siteOk: true });
  assert.equal(state.notifiedActive["supabase-unreachable"], true);
  assert.equal(canPlaceCall(state, "supabase-unreachable", now + 24 * 60 * 60_000).allowed, false);
  clearRecoveredIncidents(state, { databaseOk: true, siteOk: true });
  assert.equal(state.notifiedActive["supabase-unreachable"], undefined);
});
test("recovery of each incident kind uses its own signal", () => {
  const state = initialState();
  for (const id of ["site-unreachable", "conference-missing", "mass-delegates-loss", "mass-committees-loss", "unknown-id"]) {
    recordCallAttempt(state, id, 1);
  }
  clearRecoveredIncidents(state, { databaseOk: true });
  assert.equal(Object.keys(state.notifiedActive).length, 5);
  clearRecoveredIncidents(state, { siteOk: true, conferenceExists: true, counts: { delegates: 280, committees: 18 } });
  assert.deepEqual(Object.keys(state.notifiedActive), ["unknown-id"]);
});
