import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DeliveryLog, allowedRequest, checkBaseOrigin, checkBundles, checkHealthIdentity, rpcAccepted, stateDigest } from "../scripts/rehearsal/delivery-audit.mjs";

const body = (mutation: string, extra = "") => JSON.stringify({ conf: "c", mutation, command: { type: "participation", points: 2 }, client_time: "t" + extra });

test("rpcAccepted requires 2xx and no RPC error object", () => {
  assert.equal(rpcAccepted(200, ""), true);
  assert.equal(rpcAccepted(204, ""), true);
  assert.equal(rpcAccepted(200, "null"), true);
  assert.equal(rpcAccepted(200, '{"ok":true}'), true);
  assert.equal(rpcAccepted(409, '{"code":"PT409","message":"stale"}'), false);
  assert.equal(rpcAccepted(500, ""), false);
  assert.equal(rpcAccepted(200, '{"code":"23505","message":"duplicate"}'), false);
  assert.equal(rpcAccepted(200, "not json"), false);
});

test("a replay answered 200 then 409 fails the acceptance check", () => {
  const log = new DeliveryLog();
  log.record("delivery 1", body("m1"), 200, "");
  log.record("delivery 2", body("m1"), 409, '{"code":"PT409","message":"stale"}');
  assert.throws(() => log.assertAccepted(), /delivery 2 was not an accepted commit/);
  const ok = new DeliveryLog();
  ok.record("delivery 1", body("m1"), 200, "");
  ok.record("delivery 2", body("m1"), 200, "");
  assert.doesNotThrow(() => ok.assertAccepted());
});

test("a lost response must follow an accepted commit; a request that never arrived does not count", () => {
  const log = new DeliveryLog();
  log.record("attempt 1", body("m1"), undefined, undefined);
  assert.throws(() => log.assertAccepted("attempt 2"), /no upstream replies/);
  log.record("attempt 2", body("m1"), 500, "");
  assert.throws(() => log.assertAccepted("attempt 2"), /not an accepted commit/);
});

test("retries must carry the same mutation uuid and full payload", () => {
  const same = new DeliveryLog();
  same.record("a", body("m1"), undefined, undefined);
  same.record("b", body("m1"), 200, "");
  assert.doesNotThrow(() => same.assertIdentical(2));
  const otherId = new DeliveryLog();
  otherId.record("a", body("m1"), 200, "");
  otherId.record("b", body("m2"), 200, "");
  assert.throws(() => otherId.assertIdentical(), /different mutation uuid/);
  const otherPayload = new DeliveryLog();
  otherPayload.record("a", body("m1"), 200, "");
  otherPayload.record("b", body("m1", "x"), 200, "");
  assert.throws(() => otherPayload.assertIdentical(), /different payload/);
  assert.throws(() => new DeliveryLog().record("x", "{}", 200, ""), /no mutation uuid/);
});

const fixture = () => ({
  committees: [{ id: "c1", code: "TST" }],
  delegates: [{ id: "d1", committeeId: "c1" }, { id: "d2", committeeId: "c1" }],
  documents: [{ id: "r1", committeeId: "c1", status: "In Debate" }],
  rollCalls: [{ id: "rc1", revision: 1, committeeId: "c1", observedAt: "t0", committedAt: "t0", effectiveAt: "t0", rows: [{ delegateId: "d1", status: "Present" }, { delegateId: "d2", status: "Present & Voting" }] }],
  events: [{ id: "e1", delegateId: "d1", categoryId: "speech", points: 2, committeeId: "c1", resolutionId: null, createdAt: "t1" }],
  votes: [{ id: "v1", delegateId: "d1", resolutionId: "r1", committeeId: "c1", choice: "For", revision: 0, createdAt: "t1" }],
  queue: [{ id: "q1", delegateId: "d1", committeeId: "c1", position: 1 }, { id: "q2", delegateId: "d2", committeeId: "c1", position: 2 }],
  speeches: [{ id: "sp1", committeeId: "c1", delegateId: "d1", resolutionId: null, classification: "Other", yieldedFrom: null, state: "finished", poiLimit: null, poiCount: 0, revision: 2, createdAt: "t1" }],
});
const digest = (d: unknown) => stateDigest(d, "TST");

test("stateDigest ignores timestamps and key order but detects every meaningful divergence", () => {
  const base = digest(fixture());
  const reordered = fixture();
  reordered.events[0] = { createdAt: "other", points: 2, categoryId: "speech", delegateId: "d1", id: "e1", committeeId: "c1", resolutionId: null } as never;
  reordered.queue.reverse();
  reordered.rollCalls[0].rows.reverse();
  assert.equal(digest(reordered), base, "timestamps, key order and row order are not divergence");
  const mutate = (change: (d: ReturnType<typeof fixture>) => void) => { const d = fixture(); change(d); return digest(d); };
  assert.notEqual(mutate(d => { d.votes[0].choice = "Against"; }), base, "vote For -> Against, same ids");
  assert.notEqual(mutate(d => { d.queue[0].position = 2; d.queue[1].position = 1; }), base, "queue order reversed, same ids");
  assert.notEqual(mutate(d => { d.speeches[0].state = "speaking"; }), base, "speech finished -> speaking");
  assert.notEqual(mutate(d => { d.rollCalls[0].rows[0].status = "Absent"; }), base, "roll call status change");
  assert.notEqual(mutate(d => { d.events[0].points = 3; }), base, "points change");
  assert.notEqual(mutate(d => { d.rollCalls.push({ ...d.rollCalls[0], revision: 2 }); }), base, "a roll call correction");
  assert.equal(mutate(d => { d.queue.push({ id: "old", delegateId: "d2", committeeId: "c1", sessionId: "s-old", position: 9 } as never); }), base, "a pre-rekey row is history, not live state");
});

test("allowedRequest admits only the app origin and the validated Supabase origin", () => {
  const o = { baseOrigin: "https://app.example", supabaseOrigin: "https://abcdefghijklmnopqrst.supabase.co" };
  assert.equal(allowedRequest("https://app.example/chair", o), true);
  assert.equal(allowedRequest("https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/x", o), true);
  assert.equal(allowedRequest("https://tttttttttttttttttttt.supabase.co/rest/v1/rpc/x", o), false);
  assert.equal(allowedRequest("https://evil.example/collect", o), false);
  assert.equal(allowedRequest("https://app.example.evil.example/", o), false);
  assert.equal(allowedRequest("https://abcdefghijklmnopqrst.supabase.co/", { baseOrigin: "http://127.0.0.1:1", supabaseOrigin: null }), false);
});

test("checkBaseOrigin requires https or localhost and an independently supplied matching origin", () => {
  assert.equal(checkBaseOrigin("https://app.example/", "https://app.example"), "https://app.example");
  assert.equal(checkBaseOrigin("http://localhost:3192", "http://localhost:3192"), "http://localhost:3192");
  assert.throws(() => checkBaseOrigin("http://app.example", "http://app.example"), /https/);
  assert.throws(() => checkBaseOrigin("https://app.example", undefined), /EXPECTED_ORIGIN is required/);
  assert.throws(() => checkBaseOrigin("https://app.example", "https://other.example"), /does not equal/);
  assert.throws(() => checkBaseOrigin("https://u:p@app.example", "https://app.example"), /credentials/);
});

test("checkBundles refuses a deployment built for another project or conference", () => {
  const target = { supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", conferenceId: "conf-1" };
  const good = 'a="https://abcdefghijklmnopqrst.supabase.co";b="conf-1"';
  assert.doesNotThrow(() => checkBundles([good], target));
  assert.throws(() => checkBundles(['a="https://tttttttttttttttttttt.supabase.co";b="conf-1"'], target), /does not embed the validated Supabase/);
  assert.throws(() => checkBundles([good + 'c="https://tttttttttttttttttttt.supabase.co"'], target), /another Supabase project/);
  assert.throws(() => checkBundles(['a="https://abcdefghijklmnopqrst.supabase.co"'], target), /conference id/);
  assert.throws(() => checkBundles([], target), /no client bundles/);
  assert.throws(() => checkHealthIdentity({ app: { commit: "abc" } }, "def"), /expected one/);
  assert.doesNotThrow(() => checkHealthIdentity({ app: { commit: "abc" } }, undefined));
});

test("hosted run refuses a mismatched origin before any network or code use", () => {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, REHEARSAL_MODE: "hosted",
    REHEARSAL_BASE_URL: "https://app.example", REHEARSAL_EXPECTED_ORIGIN: "https://other.example",
    HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", // any network attempt would fail differently
    REHEARSAL_EXEC_CODE: "SECRET-EXEC-CODE-DO-NOT-PRINT", REHEARSAL_CHAIR_CODE: "SECRET-CHAIR-CODE-DO-NOT-PRINT",
  };
  const run = spawnSync(process.execPath, ["--import", "tsx", path.join(process.cwd(), "scripts/rehearsal/offline-multi-device.mjs")], { env: env as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /REHEARSAL ABORTED: REHEARSAL_BASE_URL origin does not equal REHEARSAL_EXPECTED_ORIGIN/);
  assert.doesNotMatch(run.stdout + run.stderr, /SECRET-/);
  assert.doesNotMatch(run.stdout, /HOSTED mode|Deployment identity/);
});
