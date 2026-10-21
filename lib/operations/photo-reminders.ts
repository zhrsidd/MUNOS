import type { ConferenceData, Delegate, School } from "../domain";
import type { PhotoAck, PhotoChair, PhotoSlot } from "./types";
// Reminders are DERIVED from authoritative slot timestamps and the local clock, never delivered as
// one-off events. A refreshed, reconnected or late-opened Chair Console computes the same answer.
export type PhotoStage = "upcoming" | "warning" | "due" | "past" | "cancelled";
export interface PhotoReminder {
  slot: PhotoSlot;
  school: School | undefined;
  delegates: Delegate[];
  /** This committee's Chairs from the slot's school. */
  chairs: PhotoChair[];
  /** photoChairsVersion(chairs): sent with an acknowledgement so it silences only this Chair list. */
  chairsVersion: string;
  /** photoEpoch for this committee and school: sent with an acknowledgement so it silences only this epoch. */
  epoch: number;
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
/** The participant list's current epoch for one committee and school (0 until a Chair change ever happened). */
export function photoEpoch(data: ConferenceData, committeeId: string, schoolId: string): number {
  return data.photoEpochs?.find((e) => e.committeeId === committeeId && e.schoolId === schoolId)?.epoch ?? 0;
}
/** Advances the epoch of each committee x school pair. PostgreSQL does this in triggers on the staff, assignment and
 *  role tables (private.advance_photo_epoch); the local demo does it when a Chair's school changes. */
export function advancePhotoEpochs(data: ConferenceData, committeeIds: readonly string[], schoolIds: readonly (string | null | undefined)[]) {
  const epochs = (data.photoEpochs ??= []);
  for (const committeeId of new Set(committeeIds))
    for (const schoolId of new Set(schoolIds)) {
      if (!schoolId) continue;
      const row = epochs.find((e) => e.committeeId === committeeId && e.schoolId === schoolId);
      if (row) row.epoch += 1;
      else epochs.push({ committeeId, schoolId, epoch: 1 });
    }
}
/** The participant version an acknowledgement is for: one committee's Chairs in one photo, as sorted staff ids
 *  ("" when none). It is a second guard behind the epoch: it also changes with any change to the Chair list. Must
 *  match the format private.ops_photo_ack accepts. */
export function photoChairsVersion(chairs: readonly Pick<PhotoChair, "staffId">[]): string {
  return [...new Set(chairs.map((c) => c.staffId))].sort().join(",");
}
/** Silenced only by an acknowledgement of this slot revision given at the CURRENT participant-list epoch (and for the
 *  same Chair list). The epoch only ever advances, so an acknowledgement recorded before the list last changed can
 *  never silence it again, even when the list returns to an earlier state (clear then restore a school, A→B→A, a
 *  Chair removed and re-added, a role changed away and back). Older acknowledgements, and stale ones queued offline,
 *  stay as history. */
function silenced(acks: readonly PhotoAck[], slot: PhotoSlot, committeeId: string, chairsVersion: string, epoch: number, stage: "warning" | "due") {
  return acks.some(
    (a) => a.slotId === slot.id && a.committeeId === committeeId && a.stage === stage && a.revision === slot.revision && (a.epoch ?? 0) === epoch && (a.chairs ?? "") === chairsVersion,
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
      const chairsVersion = photoChairsVersion(chairs);
      const epoch = photoEpoch(data, committeeId, slot.schoolId);
      const live = stageAt(slot, now);
      const acked = (stage: "warning" | "due") => silenced(acks, slot, committeeId, chairsVersion, epoch, stage);
      const acknowledged = { warning: acked("warning"), due: acked("due") };
      // A cancelled slot is announced only during the window in which its reminder would have shown.
      const stage: PhotoStage = slot.enabled ? live : "cancelled";
      const attention = slot.enabled
        ? (live === "warning" && !acknowledged.warning) || (live === "due" && !acknowledged.due)
        : (live === "warning" || live === "due") && !acknowledged.warning && !acknowledged.due;
      return { slot, school: data.schools.find((s) => s.id === slot.schoolId), delegates, chairs, chairsVersion, epoch, stage, minutesUntil: Math.ceil((Date.parse(slot.startsAt) - now) / minute), acknowledged, attention };
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
      const assigned = data.staff.filter((s) => s.role === "chair" && s.committeeIds.includes(c.id));
      const leaving = chairs.filter((x) => x.committeeId === c.id);
      const version = photoChairsVersion(leaving);
      const epoch = photoEpoch(data, c.id, slot.schoolId);
      const acked = (stage: "warning" | "due") => silenced(data.photoAcks ?? [], slot, c.id, version, epoch, stage);
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
