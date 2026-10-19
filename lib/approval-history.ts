import type { ConferenceData } from "./domain";
import type { DecisionKind } from "./operations/types";

export type HistoryKind = DecisionKind | "comment";
export const decisionLabel: Record<HistoryKind, string> = {
  comment: "Comment",
  review_started: "Review started",
  changes_requested: "Changes requested",
  approved: "Approved",
};
export const decisionTone: Record<HistoryKind, string> = { comment: "neutral", review_started: "neutral", changes_requested: "review", approved: "green" };

export interface HistoryEntry {
  id: string;
  documentId: string;
  code: string;
  title: string;
  kind: HistoryKind;
  label: string;
  /** 0 for a legacy comment with no recorded decision. */
  round: number;
  version: number | null;
  reviewer: string;
  at: string;
  /** Feedback written with this decision, if any. A comment-free decision has none. */
  comment: string | null;
}
/** Decisions newest first (ties by id), for one resolution or all of them. */
export function approvalHistory(data: ConferenceData, documentId?: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const x of data.documentDecisions ?? []) {
    if (documentId && x.documentId !== documentId) continue;
    const doc = data.documents.find((r) => r.id === x.documentId);
    if (!doc) continue;
    entries.push({
      id: x.id,
      documentId: doc.id,
      code: doc.code,
      title: doc.title,
      kind: x.decision,
      label: decisionLabel[x.decision],
      round: x.round,
      version: x.versionNumber,
      reviewer: x.reviewerName?.trim() || "Approval Panel member",
      at: x.decidedAt,
      comment: (x.commentId && doc.comments.find((c) => c.id === x.commentId)?.text) || null,
    });
  }
  // Comments from before decisions were recorded have no known decision: keep them, honestly labelled.
  const linked = new Set((data.documentDecisions ?? []).map((x) => x.commentId).filter(Boolean));
  for (const doc of data.documents) {
    if (documentId && doc.id !== documentId) continue;
    for (const c of doc.comments) {
      if (linked.has(c.id)) continue;
      entries.push({ id: `comment-${c.id}`, documentId: doc.id, code: doc.code, title: doc.title, kind: "comment", label: decisionLabel.comment, round: 0, version: null, reviewer: "Approval Panel", at: c.createdAt, comment: c.text });
    }
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}
/** The newest substantive feedback on a resolution, with who wrote it and when. */
export function latestFeedback(data: ConferenceData, documentId: string): HistoryEntry | null {
  return approvalHistory(data, documentId).find((e) => e.comment) ?? null;
}
