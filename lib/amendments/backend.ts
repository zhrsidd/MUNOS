import { createClient } from '@supabase/supabase-js';
import { AMENDMENT_TOKEN, type AmendmentError, type AmendmentLinkInfo } from './rules';
import { AmendmentRejected, type AmendmentBackend } from './service';
// Server route/page imports only. No browser Auth session and no staff/private data in responses.
export function amendmentBackend(env: Record<string, string | undefined> = process.env): AmendmentBackend | null {
  if (env.NEXT_PUBLIC_DATA_BACKEND !== 'supabase' || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    async linkInfo(token) {
      const { data, error } = await client.rpc('amendment_link_info', { link_token: token });
      if (error) throw error;
      return data as AmendmentLinkInfo | null;
    },
    async submit(a) {
      const { data, error } = await client.rpc('submit_amendment', { link_token: a.token, submission: a.submissionId, submitter: a.submitterId, resolution: a.resolutionId, amendment_type: a.type, clause: a.clause, wording: a.wording });
      if (error) {
        const known: AmendmentError[] = ['invalid_link', 'invalid_submitter', 'not_open', 'invalid_amendment', 'rate_limited', 'idempotency_conflict'];
        const reason = known.find(key => error.message.includes(key));
        if (reason) throw new AmendmentRejected(reason);
        throw error;
      }
      return data as { status: 'created' | 'replayed' | 'duplicate'; id: string };
    },
  };
}
export async function findAmendmentLink(token: string): Promise<AmendmentLinkInfo | null | 'unavailable'> {
  if (!AMENDMENT_TOKEN.test(token)) return null;
  const backend = amendmentBackend();
  if (!backend) return 'unavailable';
  try { return await backend.linkInfo(token); } catch { return 'unavailable'; }
}
