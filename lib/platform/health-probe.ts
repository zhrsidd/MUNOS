import { buildInfo } from "./build-info";
// Server-side reachability probe used by /api/health. It never sends a secret
// to the browser and never touches conference data.
export type ProbeStatus = "ok" | "degraded" | "down" | "not_configured";
export interface ProbeResult { status: ProbeStatus; latencyMs?: number; detail?: string }
export interface HealthReport {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  app: typeof buildInfo;
  checks: { supabase: ProbeResult; storage: ProbeResult };
}
type Fetch = typeof fetch;
async function timed(fetcher: Fetch, url: string, headers: Record<string, string>, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
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
  const cloud = env.NEXT_PUBLIC_DATA_BACKEND === "supabase" && url && publishable;
  const [supabase, storage] = await Promise.all([
    cloud ? timed(fetcher, `${url}/auth/v1/health`, { apikey: publishable! }, timeoutMs) : Promise.resolve<ProbeResult>({ status: "not_configured" }),
    // Storage is only checked when the server holds the key used for resolution uploads.
    cloud && secret
      ? timed(fetcher, `${url}/storage/v1/bucket/resolutions`, { apikey: secret, authorization: `Bearer ${secret}` }, timeoutMs)
      : Promise.resolve<ProbeResult>({ status: "not_configured" }),
  ]);
  const statuses = [supabase.status, storage.status];
  const status = statuses.includes("down") ? (supabase.status === "down" ? "down" : "degraded") : statuses.includes("degraded") ? "degraded" : "ok";
  return { status, checkedAt: new Date().toISOString(), app: buildInfo, checks: { supabase, storage } };
}
