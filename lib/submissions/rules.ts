// Shared by the public submission page (instant feedback) and the server route (authoritative).
// The normal path is a Google Doc link; a PDF/Word upload is the optional fallback.
export const MAX_SUBMISSION_BYTES = 4 * 1024 * 1024; // below Vercel's 4.5 MB function body limit
export const SUBMISSION_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
export const ACCEPT = ".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword";
export type FileKind = "pdf" | "docx" | "doc";
export const contentTypes: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};
export function kindFromName(name: string): FileKind | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "pdf" || ext === "docx" || ext === "doc" ? ext : null;
}
/** Checks the file's leading bytes agree with its extension (a renamed image is rejected). */
export function kindFromBytes(name: string, head: Uint8Array): FileKind | null {
  const kind = kindFromName(name);
  const starts = (...b: number[]) => b.every((x, i) => head[i] === x);
  if (kind === "pdf" && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf"; // %PDF-
  if (kind === "docx" && starts(0x50, 0x4b, 0x03, 0x04)) return "docx"; // ZIP container
  if (kind === "doc" && starts(0xd0, 0xcf, 0x11, 0xe0)) return "doc"; // OLE2
  return null;
}
export function cleanTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}
export type SubmissionError =
  | "invalid_link"
  | "missing_source"
  | "invalid_google_doc"
  | "invalid_file"
  | "too_large"
  | "invalid_title"
  | "invalid_submitter"
  | "rate_limited"
  | "idempotency_conflict"
  | "no_session"
  | "storage_unavailable"
  | "not_configured"
  | "server_error";
export const submissionMessages: Record<SubmissionError, string> = {
  invalid_link: "This submission link is not valid or has been replaced. Scan the QR code in your committee room again.",
  missing_source: "Paste the link to your Google Doc (or tap “Upload a file instead”).",
  invalid_google_doc: "That is not a Google Docs link. Open your resolution in Google Docs, press Share → Copy link, and paste it here.",
  invalid_file: "Upload a PDF or Word document (.pdf or .docx).",
  too_large: "The file is larger than 4 MB. Save it as a PDF and try again.",
  invalid_title: "Enter the resolution title (3 to 200 characters).",
  invalid_submitter: "Choose your country from the list.",
  rate_limited: "Too many submissions for this committee in the last few minutes. Wait a few minutes and try again.",
  idempotency_conflict: "This submission reference was already used for different details. Check the original submission with your Chair before sending a new one.",
  no_session: "This committee has no session yet. Ask your Chair.",
  storage_unavailable: "File upload is temporarily unavailable. Your resolution was NOT submitted. Submit your Google Doc link instead, or try again in a minute.",
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
