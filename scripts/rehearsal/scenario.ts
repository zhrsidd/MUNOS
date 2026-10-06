// Human-paced conference scenario. Pure and deterministic (seeded) so it can be planned, reviewed and tested
// without touching a network. Intervals reflect real conference behaviour; nothing runs at machine speed.
//
// Two separate populations:
//  * STAFF (Chairs, Approval, Admins, Executive): the people who use Conference OS with a staff session.
//  * DELEGATES: not app users. They only load the public QR submission page and POST a submission;
//    no session, no dashboard, no Supabase Auth.
// A 100-person conference is NOT 100 simultaneous staff users; size each population separately.
//
// Chair actions use the chair-procedure commands on main (#7): a shared Current session, lane queues,
// speeches started from the queue, scored, optional POIs, then finished. One Chair device per committee
// holds the floor (speeches/POIs/reorder); the others take roll call, add to queues and watch.
export type StaffRole = "chair" | "approval" | "admins" | "executive";
export type Role = StaffRole | "delegate";
export type Action =
  | "open" | "read" | "refocus" | "health"
  | "currentSession" | "attendance" | "queueAdd" | "queueOrder"
  | "speechStart" | "speechScore" | "poiAllowance" | "poiAdd" | "poiRecognize" | "speechFinish"
  | "timer" | "photoAck" | "sendToApproval" | "approve" | "print"
  | "submitPage" | "submit";
/** periodic: the app's own recovery refresh (modelled by the client timer at run time, not as a human step). */
export interface Step { at: number; action: Action; retry?: boolean; periodic?: boolean }
export interface SimUser { id: number; role: Role; committee: number; floor?: boolean; start: number; steps: Step[] }
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
export const READS: Action[] = ["open", "read", "refocus", "health", "submitPage"];
/** LEGACY upper-bound model (kept for before/after comparison only): every write = 3 writer reads + one refresh on every
 *  other subscribed device, with no one-in-flight limit. The run-time model is scripts/rehearsal/client-model.ts. */
export const WRITER_READS_PER_WRITE = 3;


// ---- Realtime topics -------------------------------------------------------------------------------------------
// operational_changes.topic emitted by the server for each simulated write, from the function definitions:
//  * private.apply_procedure (20261006023111_chair_procedure.sql): every procedure command → 'chair'.
//  * private.apply_mutation (20261006073442_staff_chair_contacts.sql): default 'chair' (attendance, participation,
//    queue, vote …); document/version/newDocument → 'documents'; setup/staff commands → 'configuration';
//    kind = 'timer' emits NOTHING (`if kind<>'timer' then insert …`).
//  * private.apply_operations_mutation (20261006023108_operations_review_hardening.sql): photoAck → 'chair',
//    resolutionLink → 'documents', submissionLink/sessionImport/photo* → 'configuration'.
//  * public.submit_resolution (QR form) → 'documents'.
// The committee_id of the event is the writer's committee (documents: the document's committee).
export type Topic = "chair" | "documents" | "configuration";
export const TOPIC_OF: Partial<Record<Action, Topic | null>> = {
  currentSession: "chair", attendance: "chair", queueAdd: "chair", queueOrder: "chair",
  speechStart: "chair", speechScore: "chair", poiAllowance: "chair", poiAdd: "chair", poiRecognize: "chair", speechFinish: "chair",
  photoAck: "chair", timer: null,
  sendToApproval: "documents", approve: "documents", print: "documents", submit: "documents",
};
/**
 * Which devices refresh when an operational change lands.
 *  * "topic-aware" (core read-path change in progress): Chairs subscribe to their own committee (every topic for that
 *    committee); Approval and Admins/Logistics ignore 'chair'; Executive/Admin keeps every topic.
 *  * "current" (main today): Chairs as above; every non-Chair role refreshes on every conference-wide change.
 * The writer itself is included when it is subscribed (production does not suppress its own notification).
 * Documents events written by Approval/Admins are attributed to that device's simulated committee index.
 */
export type RealtimeModel = "topic-aware" | "current";
/** An operational change: its topic and the (simulated) committee it belongs to. */
export interface ChangeEvent { topic: Topic; committee: number }
export function receives(model: RealtimeModel, device: SimUser, event: ChangeEvent) {
  if (device.role === "delegate") return false;
  if (device.role === "chair") return device.committee === event.committee;
  if (model === "current") return true;
  return device.role === "executive" || event.topic !== "chair";
}
export function recipients(model: RealtimeModel, users: SimUser[], event: ChangeEvent) {
  return users.filter((u) => receives(model, u, event));
}
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
  const committees = Math.max(1, o.committees);
  const between = (min: number, max: number) => (min + random() * (max - min)) * 1000;
  const pick = <T,>(weighted: [T, number][]) => { let r = random() * weighted.reduce((n, [, w]) => n + w, 0); for (const [v, w] of weighted) if ((r -= w) <= 0) return v; return weighted[0][0]; };
  const staff: SimUser[] = assignStaffRoles(o.staff).map((role, id) => {
    const start = Math.floor(random() * window);
    const steps: Step[] = [{ at: start, action: "open" }];
    const committee = id % committees;
    // The first Chair device of each committee holds the floor; Chairs are assigned first so ids < committees.
    const floor = role === "chair" && id < committees;
    let t = start;
    const push = (gapMs: number, action: Action) => {
      t += Math.max(HUMAN_FLOOR_SECONDS * 1000, gapMs);
      if (t >= end) return false;
      steps.push({ at: t, action, retry: !READS.includes(action) && random() < (o.retryFraction ?? 0.1) ? true : undefined });
      return true;
    };
    if (role === "chair") {
      if (floor && !push(between(3, 6), "currentSession")) return { id, role, committee, floor, start, steps };
      // Roll call at the start of the session: a handful of delegates, a few seconds apart.
      for (let i = 0; i < 8 && push(between(3, 8), "attendance"); i++);
      if (floor) {
        // The floor: add speakers, call them from the queue, score, sometimes POIs, finish. Speeches last 30–90 s.
        let ok = true;
        while (ok) {
          const next = pick<Action | "speech">([["queueAdd", 30], ["speech", 40], ["queueOrder", 8], ["timer", 8], ["refocus", 6], ["sendToApproval", 4], ["photoAck", 4]]);
          if (next !== "speech") { ok = push(between(15, 45), next); continue; }
          ok = push(between(10, 30), "speechStart");
          if (ok && random() < 0.4) ok = push(between(20, 40), "poiAllowance") && push(between(3, 10), "poiAdd") && push(between(10, 30), "poiRecognize");
          ok = ok && push(between(30, 60), "speechScore") && push(between(3, 8), "speechFinish");
        }
      } else while (push(between(20, 60), pick<Action>([["queueAdd", 45], ["attendance", 20], ["refocus", 25], ["timer", 5], ["photoAck", 5]])));
    } else if (role === "approval") while (push(between(30, 90), pick<Action>([["read", 70], ["approve", 30]])));
    else if (role === "admins") while (push(between(45, 120), pick<Action>([["read", 70], ["print", 30]])));
    else while (push(between(45, 90), pick<Action>([["read", 60], ["health", 40]])));
    // Every staff device also does the app's periodic recovery flush (~60 s, jittered).
    for (let r = start + 60_000; r < end; r += 60_000 + random() * 1000) steps.push({ at: r, action: "read", periodic: true });
    steps.sort((a, b) => a.at - b.at);
    return { id, role, committee, floor: floor || undefined, start, steps };
  });
  // Delegates: one page load inside their window; some submit a little later. No staff session.
  const delegateWindow = (o.delegateWindowSeconds ?? 120) * 1000;
  const delegates: SimUser[] = Array.from({ length: o.delegates ?? 0 }, (_, i) => {
    const start = Math.floor(random() * delegateWindow);
    const steps: Step[] = [{ at: start, action: "submitPage" }];
    const submitAt = start + Math.max(HUMAN_FLOOR_SECONDS * 1000, between(30, 180));
    if (random() < (o.submitFraction ?? 0) && submitAt < end) steps.push({ at: submitAt, action: "submit" });
    return { id: o.staff + i, role: "delegate" as const, committee: i % committees, start, steps };
  });
  return [...staff, ...delegates];
}
/** LEGACY: other devices refreshed per write under the old harness model (no topics, writer excluded). */
export function subscribers(users: SimUser[], writer: SimUser): SimUser[] {
  return users.filter((u) => u !== writer && u.role !== "delegate" && (u.role !== "chair" || u.committee === writer.committee));
}
export function summarize(users: SimUser[], minutes: number) {
  const counts: Record<string, number> = {};
  const roles: Record<string, number> = {};
  let maxPerUserPerMinute = 0, writes = 0, fanoutReads = 0;
  for (const u of users) {
    roles[u.role] = (roles[u.role] ?? 0) + 1;
    for (const s of u.steps) counts[s.action] = (counts[s.action] ?? 0) + 1 + (s.retry ? 1 : 0);
    const w = u.role === "delegate" ? 0 : u.steps.filter((s) => !READS.includes(s.action)).length;
    writes += w;
    if (w) fanoutReads += w * subscribers(users, u).length;
    maxPerUserPerMinute = Math.max(maxPerUserPerMinute, w / Math.max(1, minutes));
  }
  const staffSteps = Object.entries(counts).filter(([k]) => k !== "submitPage" && k !== "submit").reduce((n, [, v]) => n + v, 0);
  const staffReads = ["open", "read", "refocus"].reduce((n, k) => n + (counts[k] ?? 0), 0);
  // LEGACY harness model (before the one-in-flight client model): kept so before/after estimates stay comparable.
  const snapshotReads = staffReads + writes * WRITER_READS_PER_WRITE + fanoutReads;
  return {
    roles,
    counts,
    staffApp: { steps: staffSteps, writes, writesPerMinute: Math.round(writes / minutes) },
    legacyHarnessModel: {
      note: "Old harness: 3 writer reads + a refresh on every other subscribed device per write, scheduled reads, no one-in-flight limit, no topics.",
      refreshes: snapshotReads,
      snapshotReadsPerMinute: Math.round(snapshotReads / minutes),
      readAmplification: writes ? Number(((writes * WRITER_READS_PER_WRITE + fanoutReads) / writes).toFixed(1)) : 0,
    },
    delegatePublicForm: { pageLoads: counts.submitPage ?? 0, submissions: counts.submit ?? 0, authSessions: 0 },
    maxWritesPerUserPerMinute: Number(maxPerUserPerMinute.toFixed(2)),
  };
}
