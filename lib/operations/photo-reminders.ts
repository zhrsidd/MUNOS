import type { ConferenceData, Delegate, School } from "../domain";
import type { PhotoSlot } from "./types";
// Reminders are DERIVED from authoritative slot timestamps and the local clock, never delivered as
// one-off events. A refreshed, reconnected or late-opened Chair Console computes the same answer.
export type PhotoStage = "upcoming" | "warning" | "due" | "past" | "cancelled";
export interface PhotoReminder {
  slot: PhotoSlot;
  school: School | undefined;
  delegates: Delegate[];
  stage: PhotoStage;
  /** Whole minutes until the start (rounded up), negative once started. */
  minutesUntil: number;
  acknowledged: { warning: boolean; due: boolean };
  /** True when the Chair should see a banner right now. */
  attention: boolean;
}
/** How long "GROUP PHOTO NOW" stays up when no end time is given. */
export const DUE_WINDOW_MINUTES = 15;
const minute = 60_000;
export function dueUntil(slot: PhotoSlot) {
  return slot.endsAt ? Date.parse(slot.endsAt) : Date.parse(slot.startsAt) + DUE_WINDOW_MINUTES * minute;
}
export function stageAt(slot: PhotoSlot, now: number): Exclude<PhotoStage, "cancelled"> {
  const start = Date.parse(slot.startsAt);
  if (now < start - slot.warnMinutes * minute) return "upcoming";
  if (now < start) return "warning";
  if (now < dueUntil(slot)) return "due";
  return "past";
}
/** Reminders for one committee: only slots for schools with delegates in that committee. */
export function committeePhotoReminders(data: ConferenceData, committeeId: string, now: number): PhotoReminder[] {
  const acks = (data.photoAcks ?? []).filter((a) => a.committeeId === committeeId);
  return (data.photoSlots ?? [])
    .map((slot) => {
      const delegates = data.delegates.filter((d) => d.committeeId === committeeId && d.schoolId === slot.schoolId).sort((a, b) => a.country.localeCompare(b.country));
      const live = stageAt(slot, now);
      const acked = (stage: "warning" | "due") => acks.some((a) => a.slotId === slot.id && a.stage === stage && a.revision === slot.revision);
      const acknowledged = { warning: acked("warning"), due: acked("due") };
      // A cancelled slot is announced only during the window in which its reminder would have shown.
      const stage: PhotoStage = slot.enabled ? live : "cancelled";
      const attention = slot.enabled
        ? (live === "warning" && !acknowledged.warning) || (live === "due" && !acknowledged.due)
        : (live === "warning" || live === "due") && !acknowledged.warning && !acknowledged.due;
      return { slot, school: data.schools.find((s) => s.id === slot.schoolId), delegates, stage, minutesUntil: Math.ceil((Date.parse(slot.startsAt) - now) / minute), acknowledged, attention };
    })
    .filter((r) => r.delegates.length > 0)
    .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));
}
/** Executive overview: how many delegates each committee must send to a slot. */
export function affectedCommittees(data: ConferenceData, slot: PhotoSlot) {
  const counts = new Map<string, number>();
  for (const d of data.delegates) if (d.schoolId === slot.schoolId) counts.set(d.committeeId, (counts.get(d.committeeId) ?? 0) + 1);
  return data.committees
    .filter((c) => counts.has(c.id))
    .map((c) => {
      const acked = (stage: "warning" | "due") => (data.photoAcks ?? []).some((a) => a.slotId === slot.id && a.committeeId === c.id && a.stage === stage && a.revision === slot.revision);
      return { committee: c, delegates: counts.get(c.id)!, warningAcknowledged: acked("warning"), dueAcknowledged: acked("due") };
    });
}
