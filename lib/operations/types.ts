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
  /** The Chair's copy in the Approval Panel folder (made manually in Google Drive for now). */
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
export interface PhotoAck {
  slotId: string;
  committeeId: string;
  stage: "warning" | "due";
  revision: number;
  at: string;
}
export interface OperationsData {
  submissionLinks?: SubmissionLink[];
  resolutionLinks?: ResolutionLink[];
  photoSlots?: PhotoSlot[];
  photoAcks?: PhotoAck[];
}
