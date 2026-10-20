// Shared by the public submission page (instant feedback) and the server route (authoritative).
// New submissions are native Google Docs links only. Files uploaded before this rule stay readable by staff.
/** A Docs-only submission is a few hundred bytes of form fields; anything larger is refused unread. */
export const MAX_SUBMISSION_BODY = 64 * 1024;
export const SUBMISSION_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
export function cleanTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}
export type SubmissionError =
  | "invalid_link"
  | "missing_source"
  | "invalid_google_doc"
  | "docs_only"
  | "too_large"
  | "invalid_title"
  | "invalid_submitter"
  | "rate_limited"
  | "idempotency_conflict"
  | "no_session"
  | "not_configured"
  | "server_error";
export const submissionMessages: Record<SubmissionError, string> = {
  invalid_link: "This submission link is not valid or has been replaced. Scan the QR code in your committee room again.",
  missing_source: "Paste the link to your Google Doc.",
  invalid_google_doc: "That is not a Google Docs link. Open your resolution in Google Docs, press Share → Copy link, and paste it here.",
  docs_only: "Resolutions are submitted as Google Docs links only, not files. Open your resolution in Google Docs, press Share → Copy link, and paste it here.",
  too_large: "This submission is too large. Paste only the link to your Google Doc.",
  invalid_title: "Enter the resolution title (3 to 200 characters).",
  invalid_submitter: "Choose your country from the list.",
  rate_limited: "Too many submissions for this committee in the last few minutes. Wait a few minutes and try again.",
  idempotency_conflict: "This submission reference was already used for different details. Check the original submission with your Chair before sending a new one.",
  no_session: "This committee has no session yet. Ask your Chair.",
  not_configured: "Online submission is not available right now. Your resolution was NOT submitted.",
  server_error: "We could not confirm whether your resolution was received. Retry with the same details; the same submission will not be created twice.",
};
export interface Submitter { id: string; country: string; flag: string }
export interface LinkInfo {
  linkId: string;
  conferenceId: string;
  committeeId: string;
  conferenceName: string;
  committeeCode: string;
  committeeName: string;
  /** Legacy field retained for rolling compatibility; never presented as Chair access. */
  shareWith: string;
  chairs?: { name: string; email: string }[];
  submitters: Submitter[];
}
export type SubmissionResponse =
  | { ok: true; status: "created" | "duplicate" | "replayed"; code: string }
  | { ok: false; error: SubmissionError; message: string };
