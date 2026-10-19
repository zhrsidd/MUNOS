import type { DocumentStatus, Resolution } from "@/lib/domain";

export interface Feedback {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
}
export interface NextAction {
  /** What the Chair can do from the row, or null when the next step belongs to someone else. */
  label: string;
  /** Command status to send, or a route the action opens. */
  status?: DocumentStatus;
  href?: string;
  /** Who acts next, for the status line. */
  owner: "chair" | "approval" | "logistics" | "none";
}

/** Approval Panel feedback, newest first. Comments are only ever written by Approval decisions. */
export function resolutionFeedback(r: Pick<Resolution, "comments">): { latest: Feedback | null; earlier: Feedback[] } {
  const all = [...r.comments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  return { latest: all[0] ?? null, earlier: all.slice(1) };
}
/** A Draft that has feedback was sent back by the Approval Panel; changes are required. */
export const sentBack = (r: Pick<Resolution, "status" | "comments">) => r.status === "Draft" && r.comments.length > 0;

export function resolutionNextAction(r: Pick<Resolution, "status" | "comments">): NextAction {
  switch (r.status) {
    case "Draft":
      return { label: sentBack(r) ? "Fix and resubmit" : "Submit for review", status: "Submitted", owner: "chair" };
    case "Submitted":
    case "Review":
      return { label: "Waiting for the Approval Panel", owner: "approval" };
    case "Approved":
      return { label: "Waiting for printing", owner: "logistics" };
    case "Printed":
      return { label: "Open debate", status: "In Debate", owner: "chair" };
    case "In Debate":
      return { label: "Go to voting", href: "/chair/voting", owner: "chair" };
    case "Closed":
      return { label: "Closed", owner: "none" };
  }
}
const PRIORITY: Record<DocumentStatus, number> = { Draft: 0, Printed: 1, "In Debate": 2, Submitted: 3, Review: 3, Approved: 4, Closed: 5 };
/** Resolutions that need the Chair first; closed last; stable by code. */
export function resolutionOrder(a: Pick<Resolution, "status" | "code" | "id">, b: Pick<Resolution, "status" | "code" | "id">) {
  return PRIORITY[a.status] - PRIORITY[b.status] || a.code.localeCompare(b.code, "en", { numeric: true }) || (a.id < b.id ? -1 : 1);
}
