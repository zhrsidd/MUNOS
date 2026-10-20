import { demoSubmissionBackend } from "./demo-backend";
import type { SubmissionBackend } from "./service";
import { supabaseSubmissionBackend } from "./supabase-backend";
import { targetProblem } from "../platform/target-guard";
/** null = cloud mode without SUPABASE_SECRET_KEY, or a project this deployment may not use (target guard): submission is
 *  reported as not configured. */
export function submissionBackend(env: Record<string, string | undefined> = process.env): SubmissionBackend | null {
  if (env.NEXT_PUBLIC_DATA_BACKEND !== "supabase") return demoSubmissionBackend();
  const url = env.NEXT_PUBLIC_SUPABASE_URL, secret = env.SUPABASE_SECRET_KEY;
  return url && secret && !targetProblem(url, env) ? supabaseSubmissionBackend(url, secret) : null;
}
