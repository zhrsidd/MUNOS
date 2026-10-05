// Human-paced conference scenario. Pure and deterministic (seeded) so it can be planned, reviewed and tested
// without touching a network. Intervals reflect real conference behaviour; nothing runs at machine speed.
export type Role = "chair" | "approval" | "admins" | "executive" | "delegate";
export type Action =
  | "open" | "read" | "attendance" | "queue" | "queueAdvance" | "participation" | "timer" | "photoAck"
  | "sendToApproval" | "approve" | "print" | "health" | "submitPage" | "submit" | "refocus";
export interface Step { at: number; action: Action; retry?: boolean }
export interface SimUser { id: number; role: Role; committee: number; start: number; steps: Step[] }
export interface ScenarioOptions {
  users: number;
  minutes: number;
  committees: number;
  /** All users open Conference OS within this window (the burst start). */
  startWindowSeconds?: number;
  /** Fraction of writes immediately re-sent with the same id (simulated lost response). */
  retryFraction?: number;
  /** Delegates who also POST a Google Doc submission (needs a rehearsal submission link). */
  submitFraction?: number;
  seed?: number;
}
/** Minimum seconds between two actions of one simulated person — the anti-spam floor. */
export const HUMAN_FLOOR_SECONDS = 3;
export const ROLE_MIX: Record<Role, number> = { chair: 0.35, approval: 0.05, admins: 0.05, executive: 0.05, delegate: 0.5 };
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
export function assignRoles(users: number): Role[] {
  const roles: Role[] = [];
  const order: Role[] = ["chair", "approval", "admins", "executive", "delegate"];
  for (const role of order.slice(0, -1)) for (let i = 0; i < Math.max(role === "chair" ? 1 : 0, Math.round(users * ROLE_MIX[role])); i++) roles.push(role);
  while (roles.length < users) roles.push("delegate");
  return roles.slice(0, users);
}
export function buildScenario(o: ScenarioOptions): SimUser[] {
  const random = rng(o.seed ?? 42);
  const window = (o.startWindowSeconds ?? 150) * 1000;
  const end = o.minutes * 60_000;
  const between = (min: number, max: number) => (min + random() * (max - min)) * 1000;
  const pick = <T,>(weighted: [T, number][]) => { let r = random() * weighted.reduce((n, [, w]) => n + w, 0); for (const [v, w] of weighted) if ((r -= w) <= 0) return v; return weighted[0][0]; };
  return assignRoles(o.users).map((role, id) => {
    const start = Math.floor(random() * window);
    const steps: Step[] = [{ at: start, action: role === "delegate" ? "submitPage" : "open" }];
    let t = start;
    const push = (gapMs: number, action: Action) => {
      t += Math.max(HUMAN_FLOOR_SECONDS * 1000, gapMs);
      if (t >= end) return false;
      const write = !["read", "health", "submitPage", "refocus", "open"].includes(action);
      steps.push({ at: t, action, retry: write && random() < (o.retryFraction ?? 0.1) ? true : undefined });
      return true;
    };
    if (role === "chair") {
      // Roll call at the start of the session: a handful of delegates, a few seconds apart.
      for (let i = 0; i < 8 && push(between(3, 8), "attendance"); i++);
      while (push(between(20, 60), pick<Action>([["queue", 33], ["participation", 33], ["queueAdvance", 12], ["timer", 8], ["refocus", 6], ["sendToApproval", 4], ["photoAck", 4]])));
    } else if (role === "approval") while (push(between(30, 90), pick<Action>([["read", 70], ["approve", 30]])));
    else if (role === "admins") while (push(between(45, 120), pick<Action>([["read", 70], ["print", 30]])));
    else if (role === "executive") while (push(between(45, 90), pick<Action>([["read", 60], ["health", 40]])));
    else if (random() < (o.submitFraction ?? 0)) push(between(60, 240), "submit");
    // Every staff device also does the app's periodic recovery read (~60 s, jittered).
    if (role !== "delegate") for (let r = start + 60_000; r < end; r += 60_000 + random() * 1000) steps.push({ at: r, action: "read" });
    steps.sort((a, b) => a.at - b.at);
    return { id, role, committee: id % Math.max(1, o.committees), start, steps };
  });
}
export function summarize(users: SimUser[], minutes: number) {
  const counts: Record<string, number> = {};
  const roles: Record<string, number> = {};
  let maxPerUserPerMinute = 0;
  for (const u of users) {
    roles[u.role] = (roles[u.role] ?? 0) + 1;
    for (const s of u.steps) counts[s.action] = (counts[s.action] ?? 0) + 1 + (s.retry ? 1 : 0);
    const writes = u.steps.filter((s) => !["read", "health", "submitPage", "refocus", "open"].includes(s.action)).length;
    maxPerUserPerMinute = Math.max(maxPerUserPerMinute, writes / Math.max(1, minutes));
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const writes = total - ["read", "health", "submitPage", "refocus", "open"].reduce((n, k) => n + (counts[k] ?? 0), 0);
  return { roles, counts, totalRequests: total, perMinute: Math.round(total / minutes), writesPerMinute: Math.round(writes / minutes), maxWritesPerUserPerMinute: Number(maxPerUserPerMinute.toFixed(2)) };
}
