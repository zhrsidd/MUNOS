import type { ConferenceData } from "./domain";
import type { DecisionKind } from "./operations/types";

export const decisionLabel: Record<DecisionKind, string> = {
  review_started: "Review started",
  changes_requested: "Changes requested",
  approved: "Approved",
};
export const decisionTone: Record<DecisionKind, string> = { review_started: "neutral", changes_requested: "review", approved: "green" };

export interface HistoryEntry {
  id: string;
  documentId: string;
  code: string;
  title: string;
  kind: DecisionKind;
  label: string;
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
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}
