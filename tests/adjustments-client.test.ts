import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, participationSummary, adjustmentTotal, decisionFor } from "../lib/commands";
import { pointsLeaderboard } from "../lib/participation-view";
import { createSeed } from "../lib/seed";
import { deductionProblem } from "../lib/operations/commands";

const session = () => {
  const data = createSeed();
  const s = data.sessions[0];
  const delegates = data.delegates.filter((d) => d.committeeId === s.committeeId);
  return { data, s, delegates };
};
const deduct = (delegateId: string, sessionId: string, amount: unknown, reason = "Disrupted the session") => ({ type: "pointAdjustment", action: "deduct", delegateId, sessionId, amount, reason }) as never;

test("a deduction changes the total, keeps the events, and records amount, reason, chair and time", () => {
  const { data, s, delegates } = session();
  const [a] = delegates;
  let d = applyCommand(data, { type: "participation", delegateId: a.id, sessionId: s.id, resolutionId: null, categoryId: "speech", points: 3 } as never, "chair");
  const events = JSON.stringify(d.events);
  const before = participationSummary(d, a.id).points;
  d = applyCommand(d, deduct(a.id, s.id, 4), "chair");
  assert.equal(participationSummary(d, a.id).points, before - 4);
  assert.equal(JSON.stringify(d.events), events, "original events are untouched");
  const [adj] = d.pointAdjustments!;
  assert.equal(adj.points, -4);
  assert.equal(adj.reason, "Disrupted the session");
  assert.ok(adj.chairId && adj.createdAt);
});
test("amount and reason are validated like the server", () => {
  for (const amount of [0, -1, 21, 1.5, "5", null, undefined, NaN]) assert.ok(deductionProblem(amount, "valid reason"), String(amount));
  for (const reason of ["", "  ", "ab", "x".repeat(301), undefined, 5]) assert.ok(deductionProblem(3, reason), String(reason));
  assert.equal(deductionProblem(20, "abc"), null);
  const { data, s, delegates } = session();
  assert.throws(() => applyCommand(data, deduct(delegates[0].id, s.id, 0), "chair"), /whole number/);
  assert.throws(() => applyCommand(data, deduct(delegates[0].id, s.id, 3, "no"), "chair"), /reason/);
  assert.throws(() => applyCommand(data, deduct("missing", s.id, 3), "chair"), /Delegate unavailable|outside this committee/);
  assert.throws(() => applyCommand(data, deduct(delegates[0].id, "missing", 3), "chair"), /valid session|Session unavailable/);
});
test("only Chairs deduct", () => {
  const { data, s, delegates } = session();
  for (const role of ["approval", "logistics", "admin"] as const) assert.throws(() => applyCommand(data, deduct(delegates[0].id, s.id, 2), role));
});
test("a restore is a new row that references the deduction and works once", () => {
  const { data, s, delegates } = session();
  let d = applyCommand(data, deduct(delegates[0].id, s.id, 5), "chair");
  const original = d.pointAdjustments![0];
  const restore = { type: "pointAdjustment", action: "restore", delegateId: delegates[0].id, adjustmentId: original.id } as never;
  d = applyCommand(d, restore, "chair");
  assert.equal(d.pointAdjustments!.length, 2);
  assert.equal(d.pointAdjustments![0].points, -5, "the deduction stays in the record");
  assert.equal(d.pointAdjustments![1].reverses, original.id);
  assert.equal(adjustmentTotal(d, delegates[0].id), 0);
  assert.throws(() => applyCommand(d, restore, "chair"), /already restored/);
  assert.throws(() => applyCommand(d, { type: "pointAdjustment", action: "restore", delegateId: delegates[0].id, adjustmentId: d.pointAdjustments![1].id } as never, "chair"), /Only a deduction/);
});
test("points leaderboard sorts by highest total first, ties by country then id, stable as totals change", () => {
  const { data, s, delegates } = session();
  const [a, b, c] = delegates;
  let d = data;
  const grant = (id: string, points: number) => (d = applyCommand(d, { type: "participation", delegateId: id, sessionId: s.id, resolutionId: null, categoryId: "speech", points } as never, "chair"));
  grant(b.id, 3);
  grant(c.id, 3);
  const top = pointsLeaderboard(d, delegates).map(row => row.delegate).map((x) => x.id);
  assert.deepEqual(top.slice(0, 2), [b, c].sort((x, y) => x.country.localeCompare(y.country, "en")).map((x) => x.id), "equal totals fall back to country");
  assert.equal(top.includes(a.id), true);
  const shuffled = pointsLeaderboard(d, [...delegates].reverse()).map(row => row.delegate).map((x) => x.id);
  assert.deepEqual(shuffled, top, "input order does not matter");
  d = applyCommand(d, deduct(b.id, s.id, 2), "chair");
  assert.ok(pointsLeaderboard(d, delegates).map(row => row.delegate).findIndex((x) => x.id === c.id) < pointsLeaderboard(d, delegates).map(row => row.delegate).findIndex((x) => x.id === b.id), "a deduction moves a delegate down");
  // A total of zero or below stays ordered after everyone with more.
  const order = pointsLeaderboard(d, delegates).map(row => row.delegate).map((x) => participationSummary(d, x.id).points);
  assert.deepEqual(order, [...order].sort((x, y) => y - x));
});
test("decisions are the Approval Panel transitions only", () => {
  assert.equal(decisionFor("Submitted", "Review"), "review_started");
  assert.equal(decisionFor("Review", "Approved"), "approved");
  assert.equal(decisionFor("Submitted", "Approved"), "approved");
  assert.equal(decisionFor("Review", "Draft"), "changes_requested");
  for (const [from, to] of [["Draft", "Submitted"], ["Approved", "Printed"], ["Printed", "In Debate"], ["In Debate", "Closed"], ["Approved", "Draft"]] as const) assert.equal(decisionFor(from, to), null);
});
test("a comment-free approval records a decision with no comment; a change request links its comment", () => {
  let { data } = session();
  const r = data.documents.find((x) => x.status === "Review" || x.status === "Submitted")!;
  data = applyCommand(data, { type: "document", id: r.id, status: "Draft", comment: "Needs a funding source." } as never, "approval");
  const [first] = data.documentDecisions!.filter((x) => x.documentId === r.id);
  assert.equal(first.decision, "changes_requested");
  assert.ok(first.commentId);
  assert.equal(data.documents.find((x) => x.id === r.id)!.comments.at(-1)!.id, first.commentId);
  data = applyCommand(data, { type: "document", id: r.id, status: "Submitted" } as never, "chair");
  data = applyCommand(data, { type: "document", id: r.id, status: "Approved" } as never, "approval");
  const all = data.documentDecisions!.filter((x) => x.documentId === r.id);
  assert.deepEqual(all.map((x) => [x.decision, x.round]), [["changes_requested", 1], ["approved", 2]]);
  assert.equal(all[1].commentId, null);
  assert.equal(data.documents.find((x) => x.id === r.id)!.comments.length, 1, "no empty feedback was created");
});
test("adjustments travel through the operations boundary and its idempotent outbox path, chair only", async () => {
  const { isOperationsCommand, operationsRoles } = await import("../lib/operations/commands");
  const { operationsFingerprint } = await import("../lib/operations/fingerprint");
  assert.equal(isOperationsCommand({ type: "pointAdjustment" }), true);
  assert.deepEqual(operationsRoles.pointAdjustment, ["chair"]);
  assert.equal(operationsFingerprint(createSeed(), { type: "pointAdjustment", action: "deduct", delegateId: "x", sessionId: "y", amount: 1, reason: "abc" }), null, "append-only: no precondition to go stale");
});
test("a held order keeps the row under the person's hands and appends newcomers last", async () => {
  const { frozenOrder } = await import("../lib/commands");
  const { data, delegates } = session();
  const live = delegates;
  const held = [...live].reverse().map((d) => d.id);
  assert.deepEqual(frozenOrder(live, held).map((d) => d.id), held);
  assert.deepEqual(frozenOrder(live, null), live);
  assert.equal(frozenOrder(live, held.slice(1)).at(-1)!.id, held[0], "a delegate missing from the held order goes last");
  assert.equal(data.delegates.length > 0, true);
});
test("a session whose only history is a deduction or restore is in use, so the client does not offer to delete it", async () => {
  const { sessionUsed } = await import("../lib/batch/commands");
  const { data, s, delegates } = session();
  // Start from a session with no other history.
  const clean = { ...data, attendance: [], documents: [], events: [], queue: [], votes: [], speeches: [], debateStates: [], amendments: [] } as typeof data;
  assert.equal(sessionUsed(clean, s.id), false);
  const d = applyCommand(clean, deduct(delegates[0].id, s.id, 3), "chair");
  assert.equal(sessionUsed(d, s.id), true);
  const restored = applyCommand(d, { type: "pointAdjustment", action: "restore", delegateId: delegates[0].id, adjustmentId: d.pointAdjustments![0].id } as never, "chair");
  assert.equal(sessionUsed(restored, s.id), true, "the restore row references the session too");
});
