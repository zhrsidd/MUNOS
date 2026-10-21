import type { ConferenceData } from "./domain";
import type { DecisionKind } from "./operations/types";
import { resolutionIdentities, type ResolutionIdentity } from "./resolution-identity";

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
  /**
   * The shared resolution identity (`GA1/01 — France`). The submitter is read from this reader's own documents and
   * delegates when the resolution is in view; otherwise it is the code with "Main submitter unavailable".
   * The server projection's title is deliberately not carried: it is no longer a label.
   */
  identity: ResolutionIdentity;
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
  const identify = resolutionIdentities(data.delegates);
  const entries = new Map<string, HistoryEntry>();
  for (const x of data.documentDecisions ?? []) {
    if (documentId && x.documentId !== documentId) continue;
    const doc = data.documents.find((r) => r.id === x.documentId);
    // The server projection carries the code (and committee), so history survives the resolution leaving this reader's view.
    // It also carries the Main Submitter's country, so the identity resolves even when the document and delegates are out of view.
    if (!doc && !x.code) continue;
    const code = x.code ?? doc?.code ?? "";
    entries.set(x.id, {
      id: x.id,
      documentId: x.documentId,
      code,
      identity: identify({ code, submitterId: doc?.submitterId, committeeId: doc?.committeeId ?? x.committeeId, submitterCountry: x.submitterCountry ?? doc?.submitterCountry }),
      kind: x.decision,
      label: decisionLabel[x.decision],
      round: x.decision === "comment" ? 0 : x.round,
      version: x.versionNumber,
      reviewer: x.reviewerName?.trim() || (x.decision === "comment" ? "Approval Panel" : "Approval Panel member"),
      at: x.decidedAt,
      comment: x.comment ?? (x.commentId && doc?.comments.find((c) => c.id === x.commentId)?.text) ?? null,
    });
  }
  // Comments from before decisions were recorded have no known decision: keep them, honestly labelled.
  const linked = new Set((data.documentDecisions ?? []).map((x) => x.commentId).filter(Boolean));
  for (const doc of data.documents) {
    if (documentId && doc.id !== documentId) continue;
    for (const c of doc.comments) {
      const id = `comment-${c.id}`;
      if (linked.has(c.id) || entries.has(id)) continue;
      entries.set(id, { id, documentId: doc.id, code: doc.code, identity: identify(doc), kind: "comment", label: decisionLabel.comment, round: 0, version: null, reviewer: "Approval Panel", at: c.createdAt, comment: c.text });
    }
  }
  return [...entries.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}
/** The newest substantive feedback on a resolution, with who wrote it and when. */
export function latestFeedback(data: ConferenceData, documentId: string): HistoryEntry | null {
  return approvalHistory(data, documentId).find((e) => e.comment) ?? null;
}
