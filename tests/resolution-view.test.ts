import assert from "node:assert/strict";
import test from "node:test";
import { resolutionFeedback, resolutionNextAction, resolutionOrder, sentBack } from "../lib/resolution-view";

const c = (id: string, createdAt: string, text = id) => ({ id, text, authorId: "a", createdAt });

test("latest feedback is the newest comment, earlier ones follow newest first", () => {
  const f = resolutionFeedback({ comments: [c("1", "2026-10-17T09:00:00Z"), c("3", "2026-10-17T11:00:00Z"), c("2", "2026-10-17T10:00:00Z")] });
  assert.equal(f.latest?.id, "3");
  assert.deepEqual(f.earlier.map((x) => x.id), ["2", "1"]);
  assert.deepEqual(resolutionFeedback({ comments: [] }), { latest: null, earlier: [] });
});
test("equal timestamps resolve deterministically", () => {
  const f = resolutionFeedback({ comments: [c("a", "t"), c("b", "t")] });
  assert.equal(f.latest?.id, "b");
});
test("a draft with feedback is sent back and asks to fix and resubmit", () => {
  assert.equal(sentBack({ status: "Draft", comments: [c("1", "t")] }), true);
  assert.equal(sentBack({ status: "Draft", comments: [] }), false);
  assert.equal(sentBack({ status: "Approved", comments: [c("1", "t")] }), false);
  assert.equal(resolutionNextAction({ status: "Draft", comments: [c("1", "t")] }).label, "Fix and resubmit");
  assert.equal(resolutionNextAction({ status: "Draft", comments: [] }).label, "Submit for review");
});
test("next action names who acts and only offers a command to the Chair's own steps", () => {
  const s = (status: Parameters<typeof resolutionNextAction>[0]["status"]) => resolutionNextAction({ status, comments: [] });
  assert.deepEqual([s("Submitted").owner, s("Review").owner, s("Approved").owner, s("Closed").owner], ["approval", "approval", "logistics", "none"]);
  assert.equal(s("Submitted").status, undefined);
  assert.equal(s("Printed").status, "In Debate");
  assert.equal(s("In Debate").href, "/chair/voting");
});
test("resolutions needing the Chair sort first, closed last, codes numerically", () => {
  const r = (status: Parameters<typeof resolutionNextAction>[0]["status"], code: string) => ({ status, code, id: code });
  const sorted = [r("Closed", "R1"), r("Approved", "R2"), r("Draft", "R10"), r("Draft", "R9"), r("Printed", "R3")].sort(resolutionOrder);
  assert.deepEqual(sorted.map((x) => x.code), ["R9", "R10", "R3", "R2", "R1"]);
});
