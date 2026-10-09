// Chair scoping for the rehearsal run and the readiness gate. Pure; no I/O.
//
// Readiness requires a REALISTIC MULTI-COMMITTEE run: every simulated committee is a real public.committees row with
// its own normal session and its own Chair identity/grant. Chair devices of committee k use committee k's identity,
// committee row and session; several devices in the same committee may share that committee's identity.
// The legacy single-committee "floor" fixture (one Chair identity, floors = extra sessions in one committee) overstated
// shared-row contention: every Chair write took the same committees row lock. It is kept for historical comparison
// only and can never produce a readiness PASS.
import type { ChairIdentity, Identity, IdentityMode } from "./identities";
import type { SimUser } from "./scenario";
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
