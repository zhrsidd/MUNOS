import { googleDocMessages, parseGoogleDocLink } from "./google-doc";
import { SUBMISSION_TOKEN, submissionMessages, type LinkInfo, type SubmissionError, type SubmissionResponse } from "./rules";
export interface SubmitArgs {
  token: string; submissionId: string; submitterId: string;
  /** The working Google Doc (id only). */
  googleDocId: string;
}
/** Thrown by a backend when the database rejects a submission for a known reason. */
export class SubmissionRejected extends Error {
  constructor(public reason: SubmissionError) { super(reason); }
}
export interface SubmissionBackend {
  linkInfo(token: string): Promise<LinkInfo | null>;
  submit(args: SubmitArgs): Promise<{ status: "created" | "duplicate" | "replayed"; code: string }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: SubmissionError, message = submissionMessages[error]) => ({ status, body: { ok: false, error, message } as SubmissionResponse });
const rejected = (error: unknown) => {
  if (error instanceof SubmissionRejected) {
    const status = error.reason === "invalid_link" ? 404 : error.reason === "rate_limited" ? 429 : error.reason === "no_session" || error.reason === "idempotency_conflict" ? 409 : 400;
    return fail(status, error.reason);
  }
  return fail(500, "server_error");
};
/**
 * Registers a delegate's resolution with the committee Chair (the workflow's Draft state).
 * Resolutions are not named: the form has no title, and a `title` field posted by an older client is never read, trusted
 * or stored (the backend fills the legacy column with the compatibility title, lib/resolution-title.ts).
 * Google Docs links only: validated, reduced to the document id, never fetched. A request carrying a file is refused
 * before anything is stored or created; historical uploads remain readable by staff through Storage RLS.
 * Retries with the same submissionId are safe (idempotent database call).
 */
export async function handleSubmission(form: FormData, backend: SubmissionBackend | null): Promise<{ status: number; body: SubmissionResponse }> {
  const token = String(form.get("token") ?? "");
  const submissionId = String(form.get("submissionId") ?? "");
  const submitterId = String(form.get("submitterId") ?? "");
  const docLink = String(form.get("googleDoc") ?? "").trim();
  if (!SUBMISSION_TOKEN.test(token)) return fail(404, "invalid_link");
  if (form.has("file")) return fail(400, "docs_only");
  if (!backend) return fail(503, "not_configured");
  if (!UUID.test(submissionId)) return fail(400, "server_error");
  if (!UUID.test(submitterId) && !/^[A-Za-z0-9_-]{1,64}$/.test(submitterId)) return fail(400, "invalid_submitter");
  if (!docLink) return fail(400, "missing_source");
  const doc = parseGoogleDocLink(docLink);
  if (!doc.ok) return fail(400, "invalid_google_doc", googleDocMessages[doc.problem]);
  let link: LinkInfo | null;
  try { link = await backend.linkInfo(token); } catch { return fail(503, "server_error"); }
  if (!link) return fail(404, "invalid_link");
  if (!link.submitters.some((s) => s.id === submitterId)) return fail(400, "invalid_submitter");
  try {
    const result = await backend.submit({ token, submissionId, submitterId, googleDocId: doc.id });
    return { status: result.status === "created" ? 201 : 200, body: { ok: true, status: result.status, code: result.code } };
  } catch (error) { return rejected(error); }
}
