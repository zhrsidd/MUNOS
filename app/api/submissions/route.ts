import { readBoundedBody } from "@/lib/http/bounded-body";
import { submissionBackend } from "@/lib/submissions/backend";
import { MAX_SUBMISSION_BODY, submissionMessages } from "@/lib/submissions/rules";
import { handleSubmission } from "@/lib/submissions/service";
// Public endpoint for delegates (no account). Authorization is possession of an active,
// unguessable committee submission link; the database enforces it again (service_role only).
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  // Counted before multipart parsing: Content-Length alone is not trusted.
  const body = await readBoundedBody(request, MAX_SUBMISSION_BODY);
  if (!body.ok && body.reason === "too_large")
    return Response.json({ ok: false, error: "too_large", message: submissionMessages.too_large }, { status: 413, headers });
  let form: FormData;
  try {
    if (!body.ok) throw Error(body.reason);
    form = await new Response(body.bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return Response.json({ ok: false, error: "missing_source", message: submissionMessages.missing_source }, { status: 400, headers });
  }
  const result = await handleSubmission(form, submissionBackend());
  return Response.json(result.body, { status: result.status, headers });
}
