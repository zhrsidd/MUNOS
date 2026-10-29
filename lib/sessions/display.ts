// The session a device DISPLAYS (docs/SESSION_MODEL.md section 7): the schedule resolved at a given instant from the data the device holds.
// Evidence only. The server assigns the label from its own copy of the schedule; a difference is flagged for review, never an error.
import type { ConferenceData } from "../domain";
import { resolveSession, type Resolution } from "./window";

/** The committee a command acts on, from the data the device holds. Null when it cannot be told (the server decides). */
export function committeeOfCommand(data: ConferenceData, raw: { type: string }): string | null {
  const command = raw as Record<string, unknown>;
  const committeeId = command.committeeId;
  if (typeof committeeId === "string") return committeeId;
  const sessionId = command.sessionId;
  if (typeof sessionId === "string") return data.sessions.find((s) => s.id === sessionId)?.committeeId ?? null;
  const delegateId = command.delegateId;
  if (typeof delegateId === "string") return data.delegates.find((d) => d.id === delegateId)?.committeeId ?? null;
  return null;
}

/** The resolution this device would display for the committee at `at`; null when the device holds no schedule for it. */
export function displayedResolution(data: ConferenceData, committeeId: string, at: string): Resolution | null {
  const schedule = data.sessionSchedules?.find((s) => s.committeeId === committeeId);
  if (!schedule) return null;
  return resolveSession({ versions: schedule.versions, overrides: schedule.overrides, dayClose: dayCloseMap(data), committeeId, at, timeZone: schedule.timeZone });
}

/** Session id shown, null for "no session"; undefined when the device cannot tell (legacy snapshot: report nothing). */
export function displayedLabel(data: ConferenceData, committeeId: string | null, at: string): string | null | undefined {
  if (!committeeId) return undefined;
  const resolution = displayedResolution(data, committeeId, at);
  return resolution ? resolution.sessionId : undefined;
}

function dayCloseMap(data: ConferenceData): Record<string, string> | undefined {
  if (!data.dayCloses?.length) return undefined;
  return Object.fromEntries(data.dayCloses.map((d) => [d.day, d.closedAt]));
}
