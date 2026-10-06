import { createClient } from "@supabase/supabase-js";
import type { LinkInfo, SubmissionError } from "./rules";
import { SubmissionRejected, type SubmissionBackend } from "./service";
// SERVER ONLY. Uses SUPABASE_SECRET_KEY, which must never reach the browser. It is used for exactly
// three things: resolve a submission link, store a fallback file in the private "resolutions" bucket,
// and call public.submit_resolution (all executable only by service_role). Google Docs are never fetched.
const known: SubmissionError[] = ["invalid_link", "invalid_submitter", "invalid_title", "invalid_google_doc", "rate_limited", "no_session", "idempotency_conflict"];
export function supabaseSubmissionBackend(url: string, secret: string): SubmissionBackend {
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = client.storage.from("resolutions");
  return {
    async linkInfo(token) {
      const { data, error } = await client.rpc("submission_link_info", { link_token: token });
      if (error) throw error;
      return (data as LinkInfo | null) ?? null;
    },
    async upload(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
      // A retry of the same submission writes the same path: an existing object is the earlier attempt.
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    },
    async remove(path) {
      await bucket.remove([path]);
    },
    async submit(a) {
      const { data, error } = await client.rpc("submit_resolution", {
        link_token: a.token, submission: a.submissionId, submitter: a.submitterId, title: a.title,
        google_doc_id: a.googleDocId ?? null, file_name: a.file?.fileName ?? null, storage_key: a.file?.storageKey ?? null,
        file_sha256: a.file?.sha256 ?? null, file_size: a.file?.size ?? null,
      });
      if (error) {
        const reason = known.find((k) => error.message.includes(k));
        if (reason) throw new SubmissionRejected(reason);
        throw error;
      }
      return data as { status: "created" | "duplicate" | "replayed"; code: string; storageKey?: string | null };
    },
  };
}
