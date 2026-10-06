export interface Sample { action: string; role?: string; ms: number; outcome: "ok" | "conflict" | "rate_limited" | "error"; detail?: string }
/** Every full client refresh (each = conference_snapshot + operations_snapshot RPCs). */
export const READ_ACTIONS = ["open", "read", "refocus", "postWriteRead", "realtimeRefresh"];
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
  const writes = samples.filter((s) => !READ_ACTIONS.includes(s.action) && !["health", "submitPage", "submit"].includes(s.action) && !s.action.endsWith("(retry)"));
  const readsByRole = Object.fromEntries([...new Set(reads.map((s) => s.role ?? "unknown"))].map((role) => [role, stats(reads.filter((s) => (s.role ?? "unknown") === role))]));
  const summary = { writes: stats(writes), reads: stats(reads), readsByRole, snapshotRpcCalls: reads.length * 2, readsPerWrite: writes.length ? Number((reads.length / writes.length).toFixed(1)) : 0 };
  const total = samples.length;
  const errors = samples.filter((s) => s.outcome === "error").length;
  const rateLimited = samples.filter((s) => s.outcome === "rate_limited").length;
  return { total, errors, rateLimited, conflicts: samples.filter((s) => s.outcome === "conflict").length, errorRate: total ? errors / total : 0, summary, actions };
}
/** Readiness thresholds from docs/STAGING_REHEARSAL.md (100-user stage). */
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
