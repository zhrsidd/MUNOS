// Plain-language text for held actions (docs/SESSION_MODEL.md section 5). Pure, so the wording is tested without the UI.
import type { ConferenceData } from "../domain";
import type { HeldAction } from "../operations/types";

const REASONS: Record<string, string> = {
  uncertain_time: "The device clock could not be verified",
  outside_window: "Made outside every scheduled session",
  stale: "Arrived too long after it was made to apply live",
  behind_held: "Waiting behind an earlier held action from the same device",
  day_closed: "Arrived after the day was closed",
  revision_mismatch: "The record changed since, so it could not be applied",
  actor_not_authorised: "The Chair who made it no longer has access",
  not_applicable: "It could not be applied",
};
export const reasonText = (reason: string) => REASONS[reason] ?? "Held for review";

const OUTCOMES: Record<string, string> = {
  participation: "Score",
  event: "Score correction",
  vote: "Ballot",
  speechScore: "Speech score",
  poiScore: "Point of information score",
  pointAdjustment: "Point adjustment",
  queue: "Speaker queue change",
  queueAdd: "Added to the speaker queue",
  queueOrder: "Speaker queue reordered",
  queueRemove: "Removed from the speaker queue",
  debateMode: "Debate mode changed",
  speechStart: "Speech started",
  speechYield: "Speech yielded",
  speechFinish: "Speech finished",
  poiAllowance: "Points of information allowance",
  poiAdd: "Point of information added",
  poiOrder: "Points of information reordered",
  poiRecognize: "Point of information recognised",
  poiRemove: "Point of information removed",
  voteMode: "Voting mode changed",
  document: "Resolution status changed",
};

/** One line saying what the held command would do, with the delegation when it names one. */
export function describeHeld(held: Pick<HeldAction, "command">, data: ConferenceData): string {
  const c = held.command as Record<string, unknown>;
  const name = OUTCOMES[held.command.type] ?? held.command.type;
  const parts = [name];
  if (typeof c.points === "number") parts.push(`${c.points > 0 ? "+" : ""}${c.points}`);
  if (typeof c.amount === "number") parts.push(`−${c.amount}`);
  if (typeof c.choice === "string") parts.push(c.choice);
  if (typeof c.status === "string") parts.push(`→ ${c.status}`);
  if (typeof c.delegateId === "string") {
    const delegate = data.delegates.find((d) => d.id === c.delegateId);
    if (delegate) parts.push(delegate.country);
  }
  return parts.join(" · ");
}

/** Open items grouped by device (null = the device did not say), each group in the order the device made them. */
export function heldByDevice(held: HeldAction[]): { deviceId: string | null; items: HeldAction[] }[] {
  const groups = new Map<string | null, HeldAction[]>();
  for (const h of held.filter((x) => x.state === "held")) groups.set(h.deviceId, [...(groups.get(h.deviceId) ?? []), h]);
  return [...groups].map(([deviceId, items]) => ({ deviceId, items: items.sort((a, b) => (a.deviceSeq ?? Infinity) - (b.deviceSeq ?? Infinity) || a.receivedAt.localeCompare(b.receivedAt)) }));
}

/** Items the Executive can approve together once the device's clock error is confirmed (the clock is the only problem). */
export const clockItems = (items: HeldAction[]) => items.filter((h) => h.reason === "uncertain_time" || h.reason === "behind_held");

/** The signed clock error the Executive states, in milliseconds. `minutes` is how far the device is AHEAD of real time (negative: behind). */
export function clockOffsetMs(minutes: number): number | null {
  if (!Number.isFinite(minutes) || Math.abs(minutes) > 24 * 60) return null;
  return Math.round(minutes * 60_000);
}
