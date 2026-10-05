import { submissionBackend } from "@/lib/submissions/backend";
import { MAX_SUBMISSION_BYTES, submissionMessages } from "@/lib/submissions/rules";
import { handleSubmission } from "@/lib/submissions/service";
// Public endpoint for delegates (no account). Authorization is possession of an active,
// unguessable committee submission link; the database enforces it again (service_role only).
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_SUBMISSION_BYTES + 64 * 1024)
    return Response.json({ ok: false, error: "too_large", message: submissionMessages.too_large }, { status: 413, headers });
  let form: FormData;
  try { form = await request.formData(); } catch {
    return Response.json({ ok: false, error: "invalid_file", message: submissionMessages.invalid_file }, { status: 400, headers });
  }
  const { status, body } = await handleSubmission(form, submissionBackend());
  return Response.json(body, { status, headers });
}
