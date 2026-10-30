// Presence and ballot eligibility on the device, mirroring private.presence_at / private.eligible / private.open_ballot
// (docs/SESSION_MODEL.md section 6). Live state is keyed by committee: a live row has committeeId and no sessionId.
import type { AttendanceStatus, BallotEntry, ConferenceData, RollCall } from "../domain";

export const isLive = (row: { committeeId?: string; sessionId?: string | null }, committeeId: string) => row.committeeId === committeeId && !row.sessionId;

/**
 * Instants from the database ("2026-10-05T05:00:00+00:00") and from this device ("2026-10-05T05:00:00.000Z") are different strings for the
 * same moment, so they are compared as milliseconds, never as text. An unreadable time is NaN and never matches.
 */
export const instant = (value: string | null | undefined): number => (value ? Date.parse(value) : Number.NaN);
/** `a` is strictly before `b`; false when either is unreadable. */
export const before = (a: string | null | undefined, b: string | null | undefined) => instant(a) < instant(b);
/** `a` is at or after `b`; true when `b` is absent. */
export const atOrAfter = (a: string | null | undefined, b: string | null | undefined) => !b || instant(a) >= instant(b);

const order = (a: RollCall, b: RollCall) => (instant(a.effectiveAt) - instant(b.effectiveAt)) || a.id.localeCompare(b.id) || a.revision - b.revision;

/** The committed roll call effective at `at` (absent: the live one): the greatest effective time, ties by id then revision. */
export function rollCallAt(d: Pick<ConferenceData, "rollCalls">, committeeId: string, at?: string): RollCall | undefined {
  const list = (d.rollCalls ?? []).filter((r) => r.committeeId === committeeId && (!at || instant(r.effectiveAt) <= instant(at)));
  return list.sort(order).at(-1);
}

/** A delegate's status in that roll call; null when the committee has no roll call yet. */
export function presenceAt(d: Pick<ConferenceData, "rollCalls">, committeeId: string, delegateId: string, at?: string): AttendanceStatus | null {
  const call = rollCallAt(d, committeeId, at);
  if (!call) return null;
  return call.rows.find((r) => r.delegateId === delegateId)?.status ?? "Absent";
}

export const isPresent = (d: Pick<ConferenceData, "rollCalls">, committeeId: string, delegateId: string, at?: string) =>
  (presenceAt(d, committeeId, delegateId, at) ?? "Absent") !== "Absent";

/** Commands that need their delegate present: the server checks them against the roll call effective at the action's time. */
const presenceGated = new Set(["queueAdd", "speechStart", "speechYield", "poiAdd", "poiRecognize"]);

/** The roll call an action cited, `{id, revision}`; absent when the action cites none. */
export const citedRollCall = (c: object): { id: string; revision: number } | undefined => {
  const cited = (c as { rollCall?: { id?: unknown; revision?: unknown } }).rollCall;
  return cited && typeof cited.id === "string" && Number.isInteger(cited.revision) ? { id: cited.id, revision: cited.revision as number } : undefined;
};

/**
 * Mirrors private.eligible: a presence-gated action is checked against the roll call it cited, so projection, reload and replay show what
 * the server will accept, unless a LATER Trusted revision effective at or before the action supersedes it (then, as on the server, the roll
 * call in force at the action's time decides). A cited roll call this device does not hold is refused, as on the server.
 */
export function isEligible(d: Pick<ConferenceData, "rollCalls">, committeeId: string, delegateId: string, cited: { id: string; revision: number } | undefined, at: string): boolean {
  if (cited) {
    const calls = (d.rollCalls ?? []).filter((r) => r.committeeId === committeeId);
    const call = calls.find((r) => r.id === cited.id && r.revision === cited.revision);
    if (!call) return false;
    const superseded = calls.some((r) => r.timeConfidence === "trusted" && order(r, call) > 0 && instant(r.effectiveAt) <= instant(at));
    if (!superseded) return (call.rows.find((r) => r.delegateId === delegateId)?.status ?? "Absent") !== "Absent";
  }
  return isPresent(d, committeeId, delegateId, at);
}

/**
 * The roll call a presence-gated action relied on, saved with the action (docs/SESSION_MODEL.md section 6). Offline work that reaches the
 * server after another device uploaded a roll call is then judged against the roll call the Chair actually saw, not whichever the server
 * holds when the action finally arrives. Unchanged when no roll call is live, the command needs no presence, or it already cites one.
 */
export function withRollCallReference<C extends { type: string }>(d: Pick<ConferenceData, "rollCalls">, committeeId: string | null, c: C, at: string): C {
  const gated = presenceGated.has(c.type) || (c.type === "queue" && !(c as { advance?: boolean }).advance);
  if (!gated || !committeeId || "rollCall" in c) return c;
  const live = rollCallAt(d, committeeId, at);
  return live ? { ...c, rollCall: { id: live.id, revision: live.revision } } : c;
}

/** The latest committed roll call that a "Copy last roll call" draft starts from. */
export const lastRollCall = (d: Pick<ConferenceData, "rollCalls">, committeeId: string) => rollCallAt(d, committeeId);

export function ballotStatus(d: Pick<ConferenceData, "ballots">, resolutionId: string, delegateId: string): AttendanceStatus | null {
  return d.ballots?.find((b) => b.resolutionId === resolutionId && b.delegateId === delegateId)?.status ?? null;
}
export const ballotOpen = (d: Pick<ConferenceData, "ballots">, resolutionId: string) => !!d.ballots?.some((b) => b.resolutionId === resolutionId);
export const eligibleBallots = (d: Pick<ConferenceData, "ballots">, resolutionId: string) => (d.ballots ?? []).filter((b) => b.resolutionId === resolutionId && b.status !== "Absent");

/** Open (or restart) a ballot: every delegate's status in the roll call effective now. */
export function openBallot(d: ConferenceData, committeeId: string, resolutionId: string, at: string) {
  const call = rollCallAt(d, committeeId, at);
  const entries: BallotEntry[] = d.delegates.filter((x) => x.committeeId === committeeId)
    .map((x) => ({ resolutionId, delegateId: x.id, committeeId, status: call?.rows.find((r) => r.delegateId === x.id)?.status ?? "Absent" }));
  d.ballots = [...(d.ballots ?? []).filter((b) => b.resolutionId !== resolutionId), ...entries];
}
