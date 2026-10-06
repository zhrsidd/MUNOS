import { googleDocMessages, parseGoogleDocLink } from "./google-doc";
import { contentTypes, kindFromBytes, MAX_SUBMISSION_BYTES, SUBMISSION_TOKEN, cleanTitle, submissionMessages, type LinkInfo, type SubmissionError, type SubmissionResponse } from "./rules";
export interface SubmitArgs {
  token: string; submissionId: string; submitterId: string; title: string;
  /** Normal path: the working Google Doc (id only). */
  googleDocId?: string;
  /** Fallback path: an already stored file. */
  file?: { fileName: string; storageKey: string; sha256: string; size: number };
}
/** Thrown by a backend when the database rejects a submission for a known reason. */
export class SubmissionRejected extends Error {
  constructor(public reason: SubmissionError) { super(reason); }
}
export interface SubmissionBackend {
  linkInfo(token: string): Promise<LinkInfo | null>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  submit(args: SubmitArgs): Promise<{ status: "created" | "duplicate" | "replayed"; code: string; storageKey?: string | null }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: SubmissionError, message = submissionMessages[error]) => ({ status, body: { ok: false, error, message } as SubmissionResponse });
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Stable IDs derived from the client's submission UUID, matching public.submit_resolution. */
export function derivedIds(submissionId: string) {
  return { documentId: `${submissionId.slice(0, 24)}000000000001`, versionId: `${submissionId.slice(0, 24)}000000000002` };
}
const rejected = (error: unknown) => {
  if (error instanceof SubmissionRejected) {
    const status = error.reason === "invalid_link" ? 404 : error.reason === "rate_limited" ? 429 : error.reason === "no_session" || error.reason === "idempotency_conflict" ? 409 : 400;
    return fail(status, error.reason);
  }
  return fail(500, "server_error");
};
/**
 * Registers a delegate's resolution with the committee Chair (the workflow's Draft state).
 * Normal path: a Google Doc link — validated, reduced to its document id, never fetched.
 * Fallback path: a PDF/Word file — stored first, so a failed upload creates nothing.
 * Retries with the same submissionId are safe (idempotent database call, same storage path).
 */
export async function handleSubmission(form: FormData, backend: SubmissionBackend | null): Promise<{ status: number; body: SubmissionResponse }> {
  const token = String(form.get("token") ?? "");
  const submissionId = String(form.get("submissionId") ?? "");
  const submitterId = String(form.get("submitterId") ?? "");
  const title = cleanTitle(String(form.get("title") ?? ""));
  const docLink = String(form.get("googleDoc") ?? "").trim();
  const file = form.get("file");
  if (!SUBMISSION_TOKEN.test(token)) return fail(404, "invalid_link");
  if (!backend) return fail(503, "not_configured");
  if (!UUID.test(submissionId)) return fail(400, "server_error");
  if (title.length < 3 || title.length > 200) return fail(400, "invalid_title");
  if (!UUID.test(submitterId) && !/^[A-Za-z0-9_-]{1,64}$/.test(submitterId)) return fail(400, "invalid_submitter");
  const hasFile = file instanceof File && file.size > 0;
  if (!docLink && !hasFile) return fail(400, file instanceof File ? "invalid_file" : "missing_source");
  const doc = docLink ? parseGoogleDocLink(docLink) : null;
  if (doc && !doc.ok) return fail(400, "invalid_google_doc", googleDocMessages[doc.problem]);
  if (!doc && (file as File).size > MAX_SUBMISSION_BYTES) return fail(413, "too_large");
  let link: LinkInfo | null;
  try { link = await backend.linkInfo(token); } catch { return fail(503, "server_error"); }
  if (!link) return fail(404, "invalid_link");
  if (!link.submitters.some((s) => s.id === submitterId)) return fail(400, "invalid_submitter");
  if (doc?.ok) {
    try {
      const result = await backend.submit({ token, submissionId, submitterId, title, googleDocId: doc.id });
      return { status: result.status === "created" ? 201 : 200, body: { ok: true, status: result.status, code: result.code } };
    } catch (error) { return rejected(error); }
  }
  const upload = file as File;
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const kind = kindFromBytes(upload.name, bytes.subarray(0, 8));
  if (!kind) return fail(400, "invalid_file");
  const { documentId, versionId } = derivedIds(submissionId);
  // Content-bound names prevent a changed retry from silently reusing different stored bytes.
  const digest = await sha256(bytes);
  const storageKey = `${link.conferenceId}/${link.committeeId}/${documentId}/${versionId}-${digest}.${kind}`;
  try { await backend.upload(storageKey, bytes, contentTypes[kind]); } catch { return fail(503, "storage_unavailable"); }
  try {
    const result = await backend.submit({ token, submissionId, submitterId, title, file: { fileName: upload.name.slice(0, 200), storageKey, sha256: digest, size: upload.size } });
    // Only a committed duplicate with a DIFFERENT canonical key proves this upload is redundant.
    // Derived document ids intentionally omit the UUID suffix, so two request ids can share a path.
    if (result.status === "duplicate" && result.storageKey && result.storageKey !== storageKey)
      await backend.remove(storageKey).catch(() => undefined);
    return { status: result.status === "created" ? 201 : 200, body: { ok: true, status: result.status, code: result.code } };
  } catch (error) {
    // An RPC error can mean the response was lost AFTER commit. Even a rejected changed retry
    // may point to an earlier accepted upload, so never delete here. Retained unreferenced files
    // are inaccessible to staff under Storage RLS; later reconciliation may remove true orphans.
    return rejected(error);
  }
}
