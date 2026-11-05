import test from "node:test";
import assert from "node:assert/strict";
import { initialState, evaluateSnapshot, canPlaceCall, recordCallAttempt, phoneScript } from "./core.mjs";

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
  assert.equal(canPlaceCall(state, "a", now + 31 * 60_000).allowed, true);
  for (let i = 0; i < 5; i++) recordCallAttempt(state, "id" + i, now);
  assert.equal(canPlaceCall(state, "something-new", now + 31 * 60_000).allowed, false);
  for (let i = 0; i < 6; i++) recordCallAttempt(state, "historical" + i, now - 25 * 60 * 60_000);
  assert.equal(canPlaceCall(state, "anything", now + 31 * 60_000).allowed, false);
});
test("spoken message is short and contains no personal data", () => {
  const item = evaluateSnapshot({ databaseOk: false },
    { ...initialState(), consecutive: { ...initialState().consecutive, db: 2 } }).incidents[0];
  const speech = phoneScript(item);
  assert.match(speech, /come to your laptop/);
  assert.ok(speech.length < 350);
});
