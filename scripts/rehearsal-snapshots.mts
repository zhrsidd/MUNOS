// Measures the RLS payload each staff role actually receives: bytes and sequential (unloaded) latency of the ONE bundled
// snapshot RPC the app sends per refresh (conference_state_snapshot; executive_state_snapshot for an Admin-only identity).
//   npx tsx scripts/rehearsal-snapshots.mts --identities .test-sessions/rehearsal-identities.json [--reads 20] [--worst-case]
//        [--fixture .test-sessions/load-fixtures.json] [--components] [--all-chairs]
//   --components also measures the bundle's parts (conference_snapshot/executive_snapshot, operations_snapshot,
//   staff_batch_snapshot) for comparison only; the app reads them separately only on its missing-function fallback.
// Read-only. Locked to the development project by remote-context.mts. Uses pre-authorized sessions; creates no Auth sessions.
import { readFile } from "node:fs/promises";
import { percentile } from "./rehearsal/metrics";
import { loadIdentities } from "./rehearsal/identities";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const { env, session, ref } = await import("./remote-context.mts");
const fixture = JSON.parse(await readFile(value("--fixture") ?? ".test-sessions/load-fixtures.json", "utf8")) as { conference: string; committees?: { id: string; code: string }[] };
const file = value("--identities");
if (!file) { console.error("Pass --identities <file> (see docs/STAGING_REHEARSAL.md)."); process.exit(2); }
const { identities, chairs, mode } = await loadIdentities(file, env);
const reads = Number(value("--reads") ?? 20);
// Each Chair identity is scoped to ONE committee, so its payload is that committee's. --all-chairs probes every
// committee's Chair (realistic multi-committee fixtures); the default probes the first.
const chairCode = (committee: string) => fixture.committees?.find((c) => c.id === committee)?.code ?? committee.slice(0, 8);
const probedChairs = args.includes("--all-chairs") ? chairs : chairs.slice(0, 1);
const who: [string, string][] = [...probedChairs.map((c): [string, string] => [`chair (${chairCode(c.committee)})`, c.token]), ...(["approval", "admins", "executive"] as const).map((role): [string, string] => [role, identities[role].token])];
if (args.includes("--worst-case")) who.push(["worst-case (all roles, one identity)", session.access_token]);
const results: Record<string, unknown> = {};
for (const [role, token] of who) {
  const row: Record<string, unknown> = {};
  // Same routing as lib/supabase/repository.ts: an Admin-only identity reads executive_state_snapshot, everyone else
  // conference_state_snapshot. A missing function (older core) is reported as failures, not silently replaced.
  const executive = role === "executive";
  const rpcs = [executive ? "executive_state_snapshot" : "conference_state_snapshot"];
  if (args.includes("--components")) rpcs.push(executive ? "executive_snapshot" : "conference_snapshot", "operations_snapshot", "staff_batch_snapshot");
  for (const rpc of rpcs) {
    const ms: number[] = []; let bytes = 0; let failures = 0;
    // staff_batch_snapshot mirrors the bundle's own call: amendments are omitted from the Executive projection.
    const body = rpc === "staff_batch_snapshot" ? { conf: fixture.conference, include_amendments: !executive } : { conf: fixture.conference };
    for (let i = 0; i < reads; i++) {
      const t = performance.now();
      const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${rpc}`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await r.text();
      if (!r.ok) { failures++; continue; }
      ms.push(performance.now() - t); bytes = Buffer.byteLength(text);
    }
    ms.sort((a, b) => a - b);
    row[rpc] = { bytes, p50_ms: percentile(ms, 0.5), p95_ms: percentile(ms, 0.95), failures };
  }
  results[role] = row;
}
console.log(JSON.stringify({ date: new Date().toISOString(), supabaseProject: ref, conference: fixture.conference, identityMode: mode, chairIdentities: chairs.length, sequentialReadsPerRpc: reads, results }, null, 2));
