// Data owned by the Claude operations extensions. Read through public.operations_snapshot
// and merged into ConferenceData as optional fields (absent until the migration is applied).
export interface SubmissionLink {
  id: string;
  committeeId: string;
  token: string;
  contact: string;
  createdAt: string;
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
  photoSlots?: PhotoSlot[];
  photoAcks?: PhotoAck[];
}
