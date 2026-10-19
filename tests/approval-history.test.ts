import test from "node:test";
import assert from "node:assert/strict";
import { approvalHistory, decisionLabel } from "../lib/approval-history";
import { createSeed } from "../lib/seed";
import type { DocumentDecision } from "../lib/operations/types";

const dec = (id: string, documentId: string, decision: DocumentDecision["decision"], decidedAt: string, extra: Partial<DocumentDecision> = {}): DocumentDecision => ({ id, documentId, decision, round: 1, versionId: null, versionNumber: 1, reviewerId: "u", reviewerName: "Priya Nair", commentId: null, decidedAt, ...extra });

test("history is newest first with reviewer, round, version and linked comment", () => {
  const data = createSeed();
  const r = data.documents[0];
  r.comments.push({ id: "c1", text: "Cite the treaty.", authorId: "u", createdAt: "2026-10-19T09:00:00Z" });
  data.documentDecisions = [
    dec("1", r.id, "review_started", "2026-10-19T08:00:00Z"),
    dec("2", r.id, "changes_requested", "2026-10-19T09:00:00Z", { commentId: "c1" }),
    dec("3", r.id, "approved", "2026-10-19T11:00:00Z", { round: 2, reviewerName: null }),
  ];
  const h = approvalHistory(data, r.id);
  assert.deepEqual(h.map((x) => x.id), ["3", "2", "1"]);
  assert.equal(h[0].reviewer, "Approval Panel member");
  assert.equal(h[0].comment, null, "a comment-free approval carries no feedback text");
  assert.equal(h[1].comment, "Cite the treaty.");
  assert.equal(h[1].reviewer, "Priya Nair");
  assert.deepEqual([h[0].round, h[0].version, h[0].label], [2, 1, decisionLabel.approved]);
});
test("history can span resolutions, ignores unknown documents and breaks time ties by id", () => {
  const data = createSeed();
  const [a, b] = data.documents;
  data.documentDecisions = [dec("a", a.id, "approved", "t"), dec("b", b.id, "approved", "t"), dec("z", "gone", "approved", "t")];
  assert.deepEqual(approvalHistory(data).map((x) => x.id), ["b", "a"]);
  assert.deepEqual(approvalHistory(data, a.id).map((x) => x.id), ["a"]);
  assert.deepEqual(approvalHistory(createSeed()), []);
});
