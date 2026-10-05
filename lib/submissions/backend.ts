import { demoSubmissionBackend } from "./demo-backend";
import type { SubmissionBackend } from "./service";
import { supabaseSubmissionBackend } from "./supabase-backend";
/** null = cloud mode without SUPABASE_SECRET_KEY: submission is reported as not configured. */
export function submissionBackend(env: Record<string, string | undefined> = process.env): SubmissionBackend | null {
  if (env.NEXT_PUBLIC_DATA_BACKEND !== "supabase") return demoSubmissionBackend();
  const url = env.NEXT_PUBLIC_SUPABASE_URL, secret = env.SUPABASE_SECRET_KEY;
  return url && secret ? supabaseSubmissionBackend(url, secret) : null;
}
