import { createClient } from "@supabase/supabase-js";
import type { LinkInfo, SubmissionError } from "./rules";
import { SubmissionRejected, type SubmissionBackend } from "./service";
// SERVER ONLY. Uses SUPABASE_SECRET_KEY, which must never reach the browser. It is used for exactly
// two things: resolve a submission link and call public.submit_resolution (both executable only by
// service_role). Google Docs are never fetched. New submissions never store files.
const known: SubmissionError[] = ["invalid_link", "invalid_submitter", "invalid_title", "invalid_google_doc", "rate_limited", "no_session", "idempotency_conflict"];
export function supabaseSubmissionBackend(url: string, secret: string): SubmissionBackend {
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async linkInfo(token) {
      const { data, error } = await client.rpc("submission_link_info", { link_token: token });
      if (error) throw error;
      return (data as LinkInfo | null) ?? null;
    },
    async submit(a) {
      const { data, error } = await client.rpc("submit_resolution", {
        link_token: a.token, submission: a.submissionId, submitter: a.submitterId, title: a.title,
        // The RPC keeps its file parameters for historical rows; new submissions never set them.
        google_doc_id: a.googleDocId, file_name: null, storage_key: null, file_sha256: null, file_size: null,
      });
      if (error) {
        const reason = known.find((k) => error.message.includes(k));
        if (reason) throw new SubmissionRejected(reason);
        throw error;
      }
      return data as { status: "created" | "duplicate" | "replayed"; code: string };
    },
  };
}
