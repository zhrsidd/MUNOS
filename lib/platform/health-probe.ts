import { buildInfo } from "./build-info";
// Server-side reachability probe used by /api/health. It never sends a secret
// to the browser and never returns or changes conference data.
export type ProbeStatus = "ok" | "degraded" | "down" | "not_configured";
export interface ProbeResult { status: ProbeStatus; latencyMs?: number; detail?: string }
export interface HealthReport {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  app: typeof buildInfo;
  checks: { supabase: ProbeResult; database: ProbeResult; storage: ProbeResult };
}
type Fetch = typeof fetch;
async function timed(fetcher: Fetch, url: string, headers: Record<string, string>, timeoutMs: number, method = "GET"): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const response = await fetcher(url, { method, headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const latencyMs = Date.now() - started;
    if (response.ok) return { status: latencyMs > 2500 ? "degraded" : "ok", latencyMs };
    return { status: response.status >= 500 ? "down" : "degraded", latencyMs, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { status: "down", latencyMs: Date.now() - started, detail: error instanceof Error ? error.name : "request failed" };
  }
}
export async function probe(env: Record<string, string | undefined> = process.env, fetcher: Fetch = fetch, timeoutMs = 3000): Promise<HealthReport> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = env.SUPABASE_SECRET_KEY;
  const expected = env.NEXT_PUBLIC_DATA_BACKEND === "supabase";
  const cloud = expected && url && publishable;
  const unchecked = Promise.resolve<ProbeResult>({ status: "not_configured" });
  const server = cloud && secret ? { apikey: secret, authorization: `Bearer ${secret}` } : null;
  const [supabase, database, storage] = await Promise.all([
    cloud ? timed(fetcher, `${url}/auth/v1/health`, { apikey: publishable! }, timeoutMs) : unchecked,
    // A real PostgREST query (HEAD: no body, so no conference record is ever returned).
    server ? timed(fetcher, `${url}/rest/v1/conferences?select=id&limit=1`, server, timeoutMs, "HEAD") : unchecked,
    // Storage is only checked when the server holds the key used for resolution uploads.
    server ? timed(fetcher, `${url}/storage/v1/bucket/resolutions`, server, timeoutMs) : unchecked,
  ]);
  const checks = { supabase, database, storage };
  return { status: overall(expected, checks), checkedAt: new Date().toISOString(), app: buildInfo, checks };
}
/** Local demo: nothing to check. Supabase mode: Auth or database down is down; anything else short of ok
 *  (including missing configuration such as SUPABASE_SECRET_KEY, which breaks QR submission) is degraded. */
function overall(expected: boolean, checks: HealthReport["checks"]): HealthReport["status"] {
  if (!expected) return "ok";
  if (checks.supabase.status === "down" || checks.database.status === "down") return "down";
  return Object.values(checks).every((check) => check.status === "ok") ? "ok" : "degraded";
}
