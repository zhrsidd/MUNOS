// Data owned by the Claude operations extensions. Read through public.operations_snapshot
// and merged into ConferenceData as optional fields (absent until the migration is applied).
export interface SubmissionLink {
  id: string;
  committeeId: string;
  token: string;
  /** Who delegates share their Google Doc with (normally the committee Chair's account). */
  shareWith: string;
  createdAt: string;
}
/**
 * The workflow's pointers to the resolution's Google Docs. Conference OS stores ids only and
 * never reads document text: the working Google Doc is the editable resolution.
 */
export interface ResolutionLink {
  documentId: string;
  workingDocId: string | null;
  /** The Chair's copy in the Approval Panel folder (made manually in Google Drive). */
  approvalCopyDocId: string | null;
  /** The Chair's check that the shared document opens. */
  access: "unchecked" | "ok" | "problem";
  /** Set when a delegate submitted through the committee link. */
  submittedAt: string | null;
  revision: number;
}
export interface PhotoSlot {
  id: string;
  schoolId: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  note: string;
  enabled: boolean;
  warnMinutes: number;
  /** Increments on every change; acknowledgements of an older revision no longer silence reminders. */
  revision: number;
}
/** A Chair with a school, one row per assigned committee: the only staff data a Chair device receives. */
export interface PhotoChair {
  staffId: string;
  name: string;
  committeeId: string;
  schoolId: string;
}
export interface PhotoAck {
  slotId: string;
  committeeId: string;
  stage: "warning" | "due";
  revision: number;
  at: string;
}
/** A Chair's traceable change to a delegate's total. Signed: a deduction is negative, a restore is positive. */
export interface PointAdjustment {
  id: string;
  delegateId: string;
  sessionId: string;
  points: number;
  reason: string;
  chairId: string;
  chairName: string | null;
  /** Set on a restore: the deduction it undoes. */
  reverses: string | null;
  createdAt: string;
}
export type DecisionKind = "review_started" | "changes_requested" | "approved";
/** One Approval Panel decision. Separate from feedback text: `commentId` is null for a comment-free decision. */
export interface DocumentDecision {
  id: string;
  documentId: string;
  /** Safe resolution identity, carried so history still renders after the resolution leaves the reader's lifecycle view. */
  committeeId?: string;
  code?: string;
  title?: string;
  /** The feedback text linked to this decision; null for a comment-free decision. */
  comment?: string | null;
  /** "comment" is a note written before decisions were recorded (no known decision). */
  decision: DecisionKind | "comment";
  round: number;
  versionId: string | null;
  versionNumber: number | null;
  reviewerId: string | null;
  reviewerName: string | null;
  commentId: string | null;
  decidedAt: string;
}
export interface OperationsData {
  pointAdjustments?: PointAdjustment[];
  documentDecisions?: DocumentDecision[];
  submissionLinks?: SubmissionLink[];
  resolutionLinks?: ResolutionLink[];
  photoSlots?: PhotoSlot[];
  photoAcks?: PhotoAck[];
  photoChairs?: PhotoChair[];
}
