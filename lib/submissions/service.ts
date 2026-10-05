import { contentTypes, kindFromBytes, MAX_SUBMISSION_BYTES, SUBMISSION_TOKEN, cleanTitle, submissionMessages, type LinkInfo, type SubmissionError, type SubmissionResponse } from "./rules";
export interface SubmitArgs {
  token: string; submissionId: string; submitterId: string; title: string;
  fileName: string; storageKey: string; sha256: string; size: number;
}
/** Thrown by a backend when the database rejects a submission for a known reason. */
export class SubmissionRejected extends Error {
  constructor(public reason: SubmissionError) { super(reason); }
}
export interface SubmissionBackend {
  linkInfo(token: string): Promise<LinkInfo | null>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  submit(args: SubmitArgs): Promise<{ status: "created" | "duplicate" | "replayed"; code: string }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: SubmissionError) => ({ status, body: { ok: false, error, message: submissionMessages[error] } as SubmissionResponse });
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Stable IDs derived from the client's submission UUID, matching public.submit_resolution. */
export function derivedIds(submissionId: string) {
  return { documentId: `${submissionId.slice(0, 24)}000000000001`, versionId: `${submissionId.slice(0, 24)}000000000002` };
}
/**
 * Validate → store the file → create the Submitted resolution. The workflow only advances
 * after the file is stored; a failed upload creates nothing. Retries with the same
 * submissionId are safe (same storage path, idempotent database call).
 */
export async function handleSubmission(form: FormData, backend: SubmissionBackend | null): Promise<{ status: number; body: SubmissionResponse }> {
  const token = String(form.get("token") ?? "");
  const submissionId = String(form.get("submissionId") ?? "");
  const submitterId = String(form.get("submitterId") ?? "");
  const title = cleanTitle(String(form.get("title") ?? ""));
  const file = form.get("file");
  if (!SUBMISSION_TOKEN.test(token)) return fail(404, "invalid_link");
  if (!backend) return fail(503, "not_configured");
  if (!UUID.test(submissionId)) return fail(400, "server_error");
  if (title.length < 3 || title.length > 200) return fail(400, "invalid_title");
  if (!UUID.test(submitterId) && !/^[A-Za-z0-9_-]{1,64}$/.test(submitterId)) return fail(400, "invalid_submitter");
  if (!(file instanceof File) || file.size === 0) return fail(400, "invalid_file");
  if (file.size > MAX_SUBMISSION_BYTES) return fail(413, "too_large");
  let link: LinkInfo | null;
  try { link = await backend.linkInfo(token); } catch { return fail(503, "server_error"); }
  if (!link) return fail(404, "invalid_link");
  if (!link.submitters.some((s) => s.id === submitterId)) return fail(400, "invalid_submitter");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = kindFromBytes(file.name, bytes.subarray(0, 8));
  if (!kind) return fail(400, "invalid_file");
  const { documentId, versionId } = derivedIds(submissionId);
  const storageKey = `${link.conferenceId}/${link.committeeId}/${documentId}/${versionId}.${kind}`;
  try { await backend.upload(storageKey, bytes, contentTypes[kind]); } catch { return fail(503, "storage_unavailable"); }
  try {
    const result = await backend.submit({ token, submissionId, submitterId, title, fileName: file.name.slice(0, 200), storageKey, sha256: await sha256(bytes), size: file.size });
    if (result.status === "duplicate") await backend.remove(storageKey).catch(() => undefined);
    return { status: result.status === "created" ? 201 : 200, body: { ok: true, ...result } };
  } catch (error) {
    // Nothing was created: remove the orphaned file (best effort) so storage holds only submitted resolutions.
    await backend.remove(storageKey).catch(() => undefined);
    if (error instanceof SubmissionRejected) {
      const status = error.reason === "invalid_link" ? 404 : error.reason === "rate_limited" ? 429 : error.reason === "no_session" ? 409 : 400;
      return fail(status, error.reason);
    }
    return fail(500, "server_error");
  }
}
