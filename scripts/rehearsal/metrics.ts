/** source: for "refresh" samples, which client trigger caused the full refresh (see client-model.ts).
 *  rpcs: snapshot RPCs that refresh actually sent (rpc-counter.ts) — 1 on bundled core, 2 only on the fallback path. */
export interface Sample { action: string; role?: string; source?: string; ms: number; outcome: "ok" | "conflict" | "rate_limited" | "error"; rpcs?: number; detail?: string }
/** Every full client refresh (one logical refresh; see Sample.rpcs for the RPCs it took). Older reports used per-trigger
 *  action names; they are still recognised so earlier result files can be re-summarised. */
export const READ_ACTIONS = ["refresh", "open", "read", "refocus", "postWriteRead", "realtimeRefresh"];
const NOT_WRITES = ["health", "submitPage", "submit"];
export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]);
}
export function report(samples: Sample[]) {
  const by: Record<string, Sample[]> = {};
  for (const s of samples) (by[s.action] ??= []).push(s);
  const actions = Object.fromEntries(Object.entries(by).map(([action, list]) => {
    const ok = list.filter((s) => s.outcome === "ok").map((s) => s.ms).sort((a, b) => a - b);
    return [action, { requests: list.length, ok: ok.length, conflicts: list.filter((s) => s.outcome === "conflict").length, rateLimited: list.filter((s) => s.outcome === "rate_limited").length, errors: list.filter((s) => s.outcome === "error").length, p50_ms: percentile(ok, 0.5), p95_ms: percentile(ok, 0.95), p99_ms: percentile(ok, 0.99) }];
  }));
  const stats = (list: Sample[]) => { const ok = list.filter((s) => s.outcome === "ok").map((s) => s.ms).sort((a, b) => a - b); return { requests: list.length, errors: list.filter((s) => s.outcome === "error").length, p50_ms: percentile(ok, 0.5), p95_ms: percentile(ok, 0.95), p99_ms: percentile(ok, 0.99) }; };
  const reads = samples.filter((s) => READ_ACTIONS.includes(s.action));
  // First attempt of each write only (lost-response retries and re-sends of the same mutation id are separate).
  const writes = samples.filter((s) => !READ_ACTIONS.includes(s.action) && !NOT_WRITES.includes(s.action) && !/\((retry|resend)\)$/.test(s.action));
  const snapshotRpcCalls = reads.reduce((n, s) => n + (s.rpcs ?? 1), 0);
  const group = (key: (s: Sample) => string) => Object.fromEntries([...new Set(reads.map(key))].map((k) => [k, stats(reads.filter((s) => key(s) === k))]));
  const summary = {
    writes: stats(writes), reads: stats(reads),
    readsByRole: group((s) => s.role ?? "unknown"), readsBySource: group((s) => s.source ?? s.action),
    // Measured, not assumed: each refresh sample carries the snapshot RPCs it sent. Samples without a count (result files
    // written before the counter existed) are counted as 1, the bundled-core behaviour; those older runs actually made 2.
    snapshotRpcCalls, snapshotRpcsPerRefresh: reads.length ? Number((snapshotRpcCalls / reads.length).toFixed(2)) : 0, readsPerWrite: writes.length ? Number((reads.length / writes.length).toFixed(1)) : 0,
  };
  const total = samples.length;
  const errors = samples.filter((s) => s.outcome === "error").length;
  const rateLimited = samples.filter((s) => s.outcome === "rate_limited").length;
  return { total, errors, rateLimited, conflicts: samples.filter((s) => s.outcome === "conflict").length, errorRate: total ? errors / total : 0, summary, actions };
}
/** Readiness thresholds from docs/STAGING_REHEARSAL.md (the required 50-staff C2 gate; also applied to optional stress runs). */
export function evaluate(r: ReturnType<typeof report>, duplicates: number, lostWrites: number) {
  const writeActions = ["currentSession", "attendance", "queueAdd", "queueOrder", "speechStart", "speechScore", "poiAllowance", "poiAdd", "poiRecognize", "speechFinish", "timer", "approve", "print", "photoAck", "sendToApproval", "submit"];
  const writeP95 = Math.max(0, ...writeActions.map((a) => r.actions[a]?.p95_ms ?? 0));
  // Every full refresh a device makes: explicit reads, reads after its own writes, and Realtime-triggered refreshes.
  const readP95 = Math.max(0, ...READ_ACTIONS.map((a) => r.actions[a]?.p95_ms ?? 0));
  const checks = [
    { check: "no duplicate writes after retries", pass: duplicates === 0 },
    { check: "no lost acknowledged writes", pass: lostWrites === 0 },
    { check: "error rate below 1% (conflicts excluded)", pass: r.errorRate < 0.01 },
    { check: "no rate-limit responses", pass: r.rateLimited === 0 },
    { check: `write p95 ≤ 1500 ms (was ${writeP95})`, pass: writeP95 <= 1500 },
    { check: `read p95 ≤ 2500 ms (was ${readP95})`, pass: readP95 <= 2500 },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}
