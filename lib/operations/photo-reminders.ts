import type { ConferenceData, Delegate, School } from "../domain";
import type { PhotoChair, PhotoSlot } from "./types";
// Reminders are DERIVED from authoritative slot timestamps and the local clock, never delivered as
// one-off events. A refreshed, reconnected or late-opened Chair Console computes the same answer.
export type PhotoStage = "upcoming" | "warning" | "due" | "past" | "cancelled";
export interface PhotoReminder {
  slot: PhotoSlot;
  school: School | undefined;
  delegates: Delegate[];
  /** This committee's Chairs from the slot's school. */
  chairs: PhotoChair[];
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
/** Chairs with a school, one row per assigned committee. Server snapshots provide them (Chairs cannot read the
 *  staff table); the local demo derives them from its staff list. */
export function photoChairs(data: ConferenceData): PhotoChair[] {
  return (
    data.photoChairs ??
    data.staff.filter((s) => s.role === "chair" && s.schoolId).flatMap((s) => s.committeeIds.map((committeeId) => ({ staffId: s.id, name: s.name, committeeId, schoolId: s.schoolId! })))
  );
}
/** Reminders for one committee: only slots for schools with delegates or Chairs in that committee. */
export function committeePhotoReminders(data: ConferenceData, committeeId: string, now: number): PhotoReminder[] {
  const committeeChairs = photoChairs(data).filter((c) => c.committeeId === committeeId);
  const acks = (data.photoAcks ?? []).filter((a) => a.committeeId === committeeId);
  return (data.photoSlots ?? [])
    .map((slot) => {
      const delegates = data.delegates.filter((d) => d.committeeId === committeeId && d.schoolId === slot.schoolId).sort((a, b) => a.country.localeCompare(b.country));
      const chairs = committeeChairs.filter((c) => c.schoolId === slot.schoolId).sort((a, b) => a.name.localeCompare(b.name));
      const live = stageAt(slot, now);
      const acked = (stage: "warning" | "due") => acks.some((a) => a.slotId === slot.id && a.stage === stage && a.revision === slot.revision);
      const acknowledged = { warning: acked("warning"), due: acked("due") };
      // A cancelled slot is announced only during the window in which its reminder would have shown.
      const stage: PhotoStage = slot.enabled ? live : "cancelled";
      const attention = slot.enabled
        ? (live === "warning" && !acknowledged.warning) || (live === "due" && !acknowledged.due)
        : (live === "warning" || live === "due") && !acknowledged.warning && !acknowledged.due;
      return { slot, school: data.schools.find((s) => s.id === slot.schoolId), delegates, chairs, stage, minutesUntil: Math.ceil((Date.parse(slot.startsAt) - now) / minute), acknowledged, attention };
    })
    .filter((r) => r.delegates.length > 0 || r.chairs.length > 0)
    .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));
}
/** Executive overview: how many delegates and Chairs each committee must send to a slot. `noChairLeft` is true
 *  when every Chair assigned to the committee belongs to the slot's school (organisers arrange cover). */
export function affectedCommittees(data: ConferenceData, slot: PhotoSlot) {
  const delegates = new Map<string, number>();
  for (const d of data.delegates) if (d.schoolId === slot.schoolId) delegates.set(d.committeeId, (delegates.get(d.committeeId) ?? 0) + 1);
  const chairs = photoChairs(data).filter((c) => c.schoolId === slot.schoolId);
  return data.committees
    .filter((c) => delegates.has(c.id) || chairs.some((x) => x.committeeId === c.id))
    .map((c) => {
      const acked = (stage: "warning" | "due") => (data.photoAcks ?? []).some((a) => a.slotId === slot.id && a.committeeId === c.id && a.stage === stage && a.revision === slot.revision);
      const assigned = data.staff.filter((s) => s.role === "chair" && s.committeeIds.includes(c.id));
      const leaving = chairs.filter((x) => x.committeeId === c.id);
      return {
        committee: c,
        delegates: delegates.get(c.id) ?? 0,
        chairs: leaving.length,
        noChairLeft: leaving.length > 0 && assigned.length > 0 && assigned.every((s) => s.schoolId === slot.schoolId),
        warningAcknowledged: acked("warning"),
        dueAcknowledged: acked("due"),
      };
    });
}
