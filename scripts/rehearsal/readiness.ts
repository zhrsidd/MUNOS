// Chair scoping for the rehearsal run and the readiness gate. Pure; no I/O.
//
// Readiness requires a REALISTIC MULTI-COMMITTEE run: every simulated committee is a real public.committees row with
// its own normal session and its own Chair identity/grant. Chair devices of committee k use committee k's identity,
// committee row and session; several devices in the same committee may share that committee's identity.
// The legacy single-committee "floor" fixture (one Chair identity, floors = extra sessions in one committee) overstated
// shared-row contention: every Chair write took the same committees row lock. It is kept for historical comparison
// only and can never produce a readiness PASS.
import type { ChairIdentity, Identity, IdentityMode } from "./identities";
import { DCMUN_STAFF_MAXIMA, type SimUser, type StaffRole } from "./scenario";
export interface RunCommittee { id: string; session: string; code: string }
export type RunMode = IdentityMode | "worst-case-superuser";
export interface ChairAssignment { committee: RunCommittee; identity: Identity; chairIndex: number | null }

/**
 * Where a simulated Chair device's traffic goes.
 *  * realistic-multi-committee: committee k = fixture.committees[k], its session, and Chair identity mapping[k].
 *  * legacy-single-committee: the one scoped committee and floor session k (historical only).
 *  * worst-case-superuser: fixture committee k with the shared all-roles identity (historical only).
 */
export function assignChair(user: SimUser, o: {
  mode: RunMode; committees: RunCommittee[]; chairs: ChairIdentity[]; mapping?: number[];
  legacy?: { committee: string; sessions: string[] }; superuser?: Identity;
}): ChairAssignment {
  if (user.role !== "chair") throw Error("assignChair is for Chair devices only.");
  if (o.mode === "realistic-multi-committee") {
    if (!o.mapping) throw Error("Realistic mode requires a resolved committee → Chair mapping.");
    const k = user.committee;
    if (k < 0 || k >= o.committees.length) throw Error(`Simulated committee ${k} does not exist in the fixture (${o.committees.length} committees).`);
    const chairIndex = o.mapping[k];
    const identity = o.chairs[chairIndex];
    if (!identity || identity.committee !== o.committees[k].id) throw Error(`Committee ${o.committees[k].code} has no Chair identity scoped to it.`);
    return { committee: o.committees[k], identity, chairIndex };
  }
  if (o.mode === "legacy-single-committee") {
    if (!o.legacy) throw Error("Legacy mode requires the scoped Chair committee and floor sessions.");
    const floor = user.committee % o.legacy.sessions.length;
    return { committee: { id: o.legacy.committee, session: o.legacy.sessions[floor], code: `floor-${floor}` }, identity: o.chairs[0], chairIndex: 0 };
  }
  if (!o.superuser) throw Error("Worst-case mode requires the shared session.");
  return { committee: o.committees[user.committee % o.committees.length], identity: o.superuser, chairIndex: null };
}

export interface ChairTraffic { committeeId: string; committeeCode: string; identity: string }
export interface ReadinessReport {
  mode: RunMode;
  label: "READINESS RUN" | "NOT A READINESS RUN";
  qualifiesForReadiness: boolean;
  reasons: string[];
  simulatedCommittees: number;
  actualCommitteesWithChairTraffic: number;
  distinctChairIdentities: number;
  chairDevices: number;
  committees: { code: string; committeeId: string; chairIdentity: string | null; chairIdentities: number; chairDevices: number }[];
}
/** Readiness distribution check. Identities are reported as short ids (first 8 chars of the Auth user id). */
export function assessReadiness(o: { mode: RunMode; committees: RunCommittee[]; chairTraffic: ChairTraffic[] }): ReadinessReport {
  const reasons: string[] = [];
  const byCommittee = new Map<string, ChairTraffic[]>();
  for (const t of o.chairTraffic) byCommittee.set(t.committeeId, [...(byCommittee.get(t.committeeId) ?? []), t]);
  const identities = new Set(o.chairTraffic.map((t) => t.identity));
  const committeeOf = new Map<string, Set<string>>();
  for (const t of o.chairTraffic) committeeOf.set(t.identity, new Set([...(committeeOf.get(t.identity) ?? []), t.committeeId]));
  if (o.mode !== "realistic-multi-committee") reasons.push(`mode is ${o.mode}, not realistic-multi-committee`);
  if (identities.size < o.committees.length) reasons.push(`${identities.size} distinct Chair identities for ${o.committees.length} simulated committees`);
  if (byCommittee.size <= 1) reasons.push("all Chair traffic resolves to one actual committee");
  const missing = o.committees.filter((c) => !byCommittee.has(c.id));
  if (missing.length) reasons.push(`no Chair traffic for ${missing.length} committee(s): ${missing.map((c) => c.code).join(", ")}`);
  const foreign = [...byCommittee.keys()].filter((id) => !o.committees.some((c) => c.id === id));
  if (foreign.length) reasons.push(`Chair traffic to ${foreign.length} committee(s) outside the fixture`);
  const shared = [...committeeOf.entries()].filter(([, set]) => set.size > 1);
  if (shared.length) reasons.push(`${shared.length} Chair identit${shared.length === 1 ? "y serves" : "ies serve"} more than one committee`);
  const mixed = [...byCommittee.values()].filter((list) => new Set(list.map((t) => t.identity)).size > 1);
  if (mixed.length) reasons.push(`${mixed.length} committee(s) use more than one Chair identity`);
  const qualifies = reasons.length === 0;
  const short = (id: string) => id.slice(0, 8);
  return {
    mode: o.mode, label: qualifies ? "READINESS RUN" : "NOT A READINESS RUN", qualifiesForReadiness: qualifies, reasons,
    simulatedCommittees: o.committees.length,
    actualCommitteesWithChairTraffic: byCommittee.size,
    distinctChairIdentities: identities.size,
    chairDevices: o.chairTraffic.length,
    committees: o.committees.map((c) => {
      const list = byCommittee.get(c.id) ?? [];
      const ids = [...new Set(list.map((t) => t.identity))];
      return { code: c.code, committeeId: c.id, chairIdentity: ids.length === 1 ? short(ids[0]) : ids.length ? ids.map(short).join("+") : null, chairIdentities: ids.length, chairDevices: list.length };
    }),
  };
}
/** The final verdict: metric checks AND the readiness distribution. A non-qualifying run can never PASS. */
export function readinessVerdict(metrics: { pass: boolean; checks: { check: string; pass: boolean }[] }, readiness: ReadinessReport) {
  const checks = [...metrics.checks, { check: `realistic multi-committee distribution (${readiness.label}${readiness.reasons.length ? `: ${readiness.reasons.join("; ")}` : ""})`, pass: readiness.qualifiesForReadiness }];
  return { pass: metrics.pass && readiness.qualifiesForReadiness, label: readiness.label, checks };
}

// ---- Single-link submission preflight ------------------------------------------------------------------------------
// The resolution QR endpoint accepts at most 20 submissions per link per 10 minutes (production rate limit, by design).
// A capacity run must stay BELOW it with headroom: hitting it would be an intentional 429, and the readiness verdict
// (correctly) fails on any rate-limit response. Rate-limit behaviour is tested separately, not in the capacity run.
export const RESOLUTION_LINK_LIMIT_PER_10_MIN = 20;
export const MAX_SINGLE_LINK_SUBMISSIONS = 18;
/** Submission fraction used by the documented conference-week C2 command (50 staff + 150 delegates, one link). */
export const DOCUMENTED_SUBMIT_FRACTION = 0.1;
/** Resolution submissions the scenario will POST (delegate "submit" steps); page loads are not counted. */
export function plannedSubmissions(users: SimUser[]) {
  return users.reduce((n, u) => n + (u.role === "delegate" ? u.steps.filter((s) => s.action === "submit").length : 0), 0);
}
export function checkSingleLinkSubmissions(users: SimUser[], singleLink: boolean) {
  const planned = plannedSubmissions(users);
  const pageLoads = users.reduce((n, u) => n + (u.role === "delegate" ? u.steps.filter((s) => s.action === "submitPage").length : 0), 0);
  if (singleLink && planned > MAX_SINGLE_LINK_SUBMISSIONS)
    return { ok: false as const, planned, pageLoads, reason: `Single-link readiness run plans ${planned} submissions; maximum is ${MAX_SINGLE_LINK_SUBMISSIONS} to stay below the designed ${RESOLUTION_LINK_LIMIT_PER_10_MIN}/10min link limit. Lower --submit-fraction or use a separate rate-limit test.` };
  return { ok: true as const, planned, pageLoads, reason: "" };
}

/** The release gate this run's peak stage corresponds to (root AGENTS.md: 110 devices across 19 real committees). A multi-stage run is labelled by its LARGEST stage only. */
export const GATE_STAFF_DEVICES = 110;
export function capacityGateLabel(peakStaff: number) {
  if (peakStaff >= GATE_STAFF_DEVICES) return `CURRENT capacity gate size (${GATE_STAFF_DEVICES} devices; it counts only if the report is also a READINESS RUN across all 19 committees)`;
  if (peakStaff >= 100) return "OPTIONAL STRESS / HEADROOM (100 staff) — not a release requirement";
  if (peakStaff >= 50) return "BELOW the current 110-device gate (historical 50-staff C2 comparison / ramp step)";
  return "BELOW the 50-staff comparison (smoke / warm-up only)";
}

/** Configured assignments are insufficient: require observed successful work and a completely settled core outbox. */
export function observedWorkVerdict(o: {
  expectedDevices: number; openedDevices: number;
  expectedRoles: string[]; reads: Record<string, number>; writes: Record<string, number>;
  expectedChairCommittees: string[]; observedChairCommittees: string[];
  pending: number; conflicts: number; unconfirmed: number;
  closeTimedOut?: boolean; localRefusals?: number;
  expectedActions?: string[]; actions?: Record<string, number>;
  expectedPages?: number; completedPages?: number; expectedSubmissions?: number; createdSubmissions?: number;
}) {
  const checks = [
    { check: 'every configured staff device completed a successful snapshot', pass: o.expectedDevices>0 && o.openedDevices===o.expectedDevices },
    { check: 'at least one successful snapshot per configured role', pass: o.expectedRoles.length > 0 && o.expectedRoles.every(r => (o.reads[r] ?? 0) > 0) },
    { check: 'at least one accepted mutation per configured writing role', pass: o.expectedRoles.filter(r => r !== 'executive').length > 0 && o.expectedRoles.filter(r => r !== 'executive').every(r => (o.writes[r] ?? 0) > 0) },
    { check: 'accepted Chair traffic matches every configured committee', pass: o.expectedChairCommittees.length > 0 && o.expectedChairCommittees.every(c => o.observedChairCommittees.includes(c)) && o.observedChairCommittees.every(c => o.expectedChairCommittees.includes(c)) },
    { check: 'zero pending, conflicting or unconfirmed actions at a settled close', pass: !o.closeTimedOut && o.pending === 0 && o.conflicts === 0 && o.unconfirmed === 0 },
    { check: 'no scripted intent was rejected locally', pass: (o.localRefusals??0)===0 },
    { check: 'declared critical operations were observed', pass: (o.expectedActions ?? []).every(a => (o.actions?.[a] ?? 0) > 0) },
    { check: 'every configured public page and submission completed successfully', pass: (o.completedPages ?? 0) === (o.expectedPages ?? 0) && (o.createdSubmissions ?? 0) === (o.expectedSubmissions ?? 0) },
  ];
  return { pass: checks.every(c => c.pass), checks };
}

/** Warm-ups may cover fewer committees; they still require real scoped identities, metrics and all configured work. */
export function rampVerdict(metrics: {checks:{check:string;pass:boolean}[]}, workChecks:{check:string;pass:boolean}[], mode:RunMode) {
  const checks=[...metrics.checks,...workChecks,{check:'role-scoped multi-committee fixture',pass:mode==='realistic-multi-committee'}];
  return {label:'RAMP / DIAGNOSTIC ONLY' as const,pass:checks.every(c=>c.pass),checks};
}

/** Validate the public bearer link through the fixture Executive's authorized snapshot, without printing it. */
export function assertSubmissionBinding(links: { token: string; committeeId: string }[] | undefined, token: string, committeeId: string) {
  if (!links?.some(link => link.token === token && link.committeeId === committeeId))
    throw Error('Submission token is not bound to the selected synthetic fixture committee. No delegate traffic was started.');
}

/** Passing a small diagnostic is not the approved 110-device conference capacity gate. */
export function conferenceGateProfile(o:{staffStages:number[];minutes:number;committees:number;delegates:number;submissionsPerStage:number[];staffRolesPerStage?:Record<StaffRole,number>[]}) {
 const mixes=o.staffRolesPerStage??[];
 const checks=[
  {check:'every capacity stage has at least 110 staff devices',pass:o.staffStages.length>0&&o.staffStages.every(n=>n>=110)},
  {check:'at least 30 minutes across 19 real committees',pass:o.minutes>=30&&o.committees===19},
  {check:'at least 150 public page loads and 16 planned creates per stage',pass:o.delegates>=150&&o.submissionsPerStage.length===o.staffStages.length&&o.submissionsPerStage.every(n=>n>=16)},
  {check:'every capacity stage covers 57 Chairs, 20 Approval, 10 printing/Admins and 5 Executives',pass:
    mixes.length===o.staffStages.length && mixes.every((mix,i)=>
      Object.values(mix).reduce((sum,n)=>sum+n,0)===o.staffStages[i] &&
      (Object.keys(DCMUN_STAFF_MAXIMA) as StaffRole[]).every(role=>Number.isInteger(mix[role])&&mix[role]>=DCMUN_STAFF_MAXIMA[role]))},
 ];
 return {eligible:checks.every(c=>c.pass),checks};
}
