// Presence and ballot eligibility on the device, mirroring private.presence_at / private.eligible / private.open_ballot
// (docs/SESSION_MODEL.md section 6). Live state is keyed by committee: a live row has committeeId and no sessionId.
import type { AttendanceStatus, BallotEntry, ConferenceData, RollCall } from "../domain";

export const isLive = (row: { committeeId?: string; sessionId?: string | null }, committeeId: string) => row.committeeId === committeeId && !row.sessionId;

const order = (a: RollCall, b: RollCall) => a.effectiveAt.localeCompare(b.effectiveAt) || a.id.localeCompare(b.id) || a.revision - b.revision;

/** The committed roll call effective at `at` (absent: the live one): the greatest effective time, ties by id then revision. */
export function rollCallAt(d: Pick<ConferenceData, "rollCalls">, committeeId: string, at?: string): RollCall | undefined {
  const list = (d.rollCalls ?? []).filter((r) => r.committeeId === committeeId && (!at || r.effectiveAt <= at));
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
