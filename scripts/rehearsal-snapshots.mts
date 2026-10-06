// Measures the RLS payload each staff role actually receives: bytes and sequential (unloaded) latency of both snapshot RPCs.
//   npx tsx scripts/rehearsal-snapshots.mts --identities .test-sessions/rehearsal-identities.json [--reads 20] [--worst-case]
//        [--fixture .test-sessions/load-fixtures.json] [--executive-snapshot]  (core PR #10: Executive reads executive_snapshot)
// Read-only. Locked to the development project by remote-context.mts. Uses pre-authorized sessions; creates no Auth sessions.
import { readFile } from "node:fs/promises";
import { percentile } from "./rehearsal/metrics";
import { loadIdentities } from "./rehearsal/identities";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const { env, session, ref } = await import("./remote-context.mts");
const fixture = JSON.parse(await readFile(value("--fixture") ?? ".test-sessions/load-fixtures.json", "utf8")) as { conference: string };
const file = value("--identities");
if (!file) { console.error("Pass --identities <file> (see docs/STAGING_REHEARSAL.md)."); process.exit(2); }
const { identities } = await loadIdentities(file, env);
const reads = Number(value("--reads") ?? 20);
const who: [string, string][] = (["chair", "approval", "admins", "executive"] as const).map((role) => [role, identities[role].token]);
if (args.includes("--worst-case")) who.push(["worst-case (all roles, one identity)", session.access_token]);
const results: Record<string, unknown> = {};
for (const [role, token] of who) {
  const row: Record<string, unknown> = {};
  // Core PR #10 routes an Admin-only identity to executive_snapshot; conference_snapshot is kept for comparison.
  // A missing function (older core) is reported as failures, not silently replaced.
  const rpcs = role === "executive" && args.includes("--executive-snapshot") ? ["executive_snapshot", "conference_snapshot", "operations_snapshot"] : ["conference_snapshot", "operations_snapshot"];
  for (const rpc of rpcs) {
    const ms: number[] = []; let bytes = 0; let failures = 0;
    for (let i = 0; i < reads; i++) {
      const t = performance.now();
      const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${rpc}`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ conf: fixture.conference }) });
      const body = await r.text();
      if (!r.ok) { failures++; continue; }
      ms.push(performance.now() - t); bytes = Buffer.byteLength(body);
    }
    ms.sort((a, b) => a - b);
    row[rpc] = { bytes, p50_ms: percentile(ms, 0.5), p95_ms: percentile(ms, 0.95), failures };
  }
  results[role] = row;
}
console.log(JSON.stringify({ date: new Date().toISOString(), supabaseProject: ref, conference: fixture.conference, sequentialReadsPerRpc: reads, results }, null, 2));
