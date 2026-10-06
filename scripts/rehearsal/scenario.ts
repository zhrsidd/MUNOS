// Human-paced conference scenario. Pure and deterministic (seeded) so it can be planned, reviewed and tested
// without touching a network. Intervals reflect real conference behaviour; nothing runs at machine speed.
//
// Two separate populations:
//  * STAFF (Chairs, Approval, Admins, Executive): the people who use Conference OS with a staff session.
//  * DELEGATES: not app users. They only load the public QR submission page and POST a submission;
//    no session, no dashboard, no Supabase Auth.
// A 100-person conference is NOT 100 simultaneous staff users; size each population separately.
export type StaffRole = "chair" | "approval" | "admins" | "executive";
export type Role = StaffRole | "delegate";
export type Action =
  | "open" | "read" | "attendance" | "queue" | "queueAdvance" | "participation" | "timer" | "photoAck"
  | "sendToApproval" | "approve" | "print" | "health" | "submitPage" | "submit" | "refocus";
export interface Step { at: number; action: Action; retry?: boolean }
export interface SimUser { id: number; role: Role; committee: number; start: number; steps: Step[] }
export interface ScenarioOptions {
  /** Simulated staff devices (Chairs, Approval, Admins, Executive). */
  staff: number;
  /** Simulated delegates using only the public QR submission page. */
  delegates?: number;
  minutes: number;
  committees: number;
  /** All staff open Conference OS within this window (the burst start). */
  startWindowSeconds?: number;
  /** Delegates open the QR page within this window (e.g. right after "submissions are open"). */
  delegateWindowSeconds?: number;
  /** Fraction of staff writes immediately re-sent with the same id (simulated lost response). */
  retryFraction?: number;
  /** Delegates who also POST a Google Doc submission after reading the page (needs a rehearsal link). */
  submitFraction?: number;
  seed?: number;
}
/** Minimum seconds between two actions of one simulated person — the anti-spam floor. */
export const HUMAN_FLOOR_SECONDS = 3;
/** Staff mix, e.g. 14 committees × 2–3 Chair devices + ~4 Approval + ~4 Admins + ~3 Executive ≈ 45–55 devices. */
export const STAFF_MIX: Record<StaffRole, number> = { chair: 0.7, approval: 0.1, admins: 0.1, executive: 0.1 };
const READS: Action[] = ["read", "health", "submitPage", "refocus", "open"];
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
export function assignStaffRoles(staff: number): StaffRole[] {
  const support: StaffRole[] = [];
  for (const role of ["approval", "admins", "executive"] as const) for (let i = 0; i < Math.round(staff * STAFF_MIX[role]); i++) support.push(role);
  const kept = support.slice(0, Math.max(0, staff - 1)); // always at least one Chair
  return [...Array<StaffRole>(staff - kept.length).fill("chair"), ...kept];
}
export function buildScenario(o: ScenarioOptions): SimUser[] {
  const random = rng(o.seed ?? 42);
  const window = (o.startWindowSeconds ?? 150) * 1000;
  const end = o.minutes * 60_000;
  const between = (min: number, max: number) => (min + random() * (max - min)) * 1000;
  const pick = <T,>(weighted: [T, number][]) => { let r = random() * weighted.reduce((n, [, w]) => n + w, 0); for (const [v, w] of weighted) if ((r -= w) <= 0) return v; return weighted[0][0]; };
  const staff: SimUser[] = assignStaffRoles(o.staff).map((role, id) => {
    const start = Math.floor(random() * window);
    const steps: Step[] = [{ at: start, action: "open" }];
    let t = start;
    const push = (gapMs: number, action: Action) => {
      t += Math.max(HUMAN_FLOOR_SECONDS * 1000, gapMs);
      if (t >= end) return false;
      steps.push({ at: t, action, retry: !READS.includes(action) && random() < (o.retryFraction ?? 0.1) ? true : undefined });
      return true;
    };
    if (role === "chair") {
      // Roll call at the start of the session: a handful of delegates, a few seconds apart.
      for (let i = 0; i < 8 && push(between(3, 8), "attendance"); i++);
      while (push(between(20, 60), pick<Action>([["queue", 33], ["participation", 33], ["queueAdvance", 12], ["timer", 8], ["refocus", 6], ["sendToApproval", 4], ["photoAck", 4]])));
    } else if (role === "approval") while (push(between(30, 90), pick<Action>([["read", 70], ["approve", 30]])));
    else if (role === "admins") while (push(between(45, 120), pick<Action>([["read", 70], ["print", 30]])));
    else while (push(between(45, 90), pick<Action>([["read", 60], ["health", 40]])));
    // Every staff device also does the app's periodic recovery read (~60 s, jittered).
    for (let r = start + 60_000; r < end; r += 60_000 + random() * 1000) steps.push({ at: r, action: "read" });
    steps.sort((a, b) => a.at - b.at);
    return { id, role, committee: id % Math.max(1, o.committees), start, steps };
  });
  // Delegates: one page load inside their window; some submit a little later. No staff session.
  const delegateWindow = (o.delegateWindowSeconds ?? 120) * 1000;
  const delegates: SimUser[] = Array.from({ length: o.delegates ?? 0 }, (_, i) => {
    const start = Math.floor(random() * delegateWindow);
    const steps: Step[] = [{ at: start, action: "submitPage" }];
    const submitAt = start + Math.max(HUMAN_FLOOR_SECONDS * 1000, between(30, 180));
    if (random() < (o.submitFraction ?? 0) && submitAt < end) steps.push({ at: submitAt, action: "submit" });
    return { id: o.staff + i, role: "delegate" as const, committee: i % Math.max(1, o.committees), start, steps };
  });
  return [...staff, ...delegates];
}
export function summarize(users: SimUser[], minutes: number) {
  const counts: Record<string, number> = {};
  const roles: Record<string, number> = {};
  let maxPerUserPerMinute = 0;
  for (const u of users) {
    roles[u.role] = (roles[u.role] ?? 0) + 1;
    for (const s of u.steps) counts[s.action] = (counts[s.action] ?? 0) + 1 + (s.retry ? 1 : 0);
    const writes = u.steps.filter((s) => !READS.includes(s.action)).length;
    maxPerUserPerMinute = Math.max(maxPerUserPerMinute, writes / Math.max(1, minutes));
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const publicRequests = (counts.submitPage ?? 0) + (counts.submit ?? 0);
  const staffRequests = total - publicRequests;
  const staffWrites = staffRequests - ["read", "health", "refocus", "open"].reduce((n, k) => n + (counts[k] ?? 0), 0);
  return {
    roles,
    counts,
    staffApp: { requests: staffRequests, perMinute: Math.round(staffRequests / minutes), writesPerMinute: Math.round(staffWrites / minutes) },
    delegatePublicForm: { pageLoads: counts.submitPage ?? 0, submissions: counts.submit ?? 0, authSessions: 0 },
    maxWritesPerUserPerMinute: Number(maxPerUserPerMinute.toFixed(2)),
  };
}
