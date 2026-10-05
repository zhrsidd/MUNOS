// Data owned by the Claude operations extensions. Read through public.operations_snapshot
// and merged into ConferenceData as optional fields (absent until the migration is applied).
export interface SubmissionLink {
  id: string;
  committeeId: string;
  token: string;
  contact: string;
  createdAt: string;
}
export interface OperationsData {
  submissionLinks?: SubmissionLink[];
}
