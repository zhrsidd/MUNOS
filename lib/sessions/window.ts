// Session windows (docs/SESSION_MODEL.md section 3): a committee's sessions are a schedule that labels records.
// PURE: no clock, no I/O. The SQL twin is public.session_windows / session_resolve (20261029100000_session_window.sql);
// both run the shared vectors in tests/fixtures/session-window-vectors.json. Change one, change the other.
//
// switch(Sk) = max(start(Sk) - lead, end(S(k-1)))   (first session of a day: start - lead)
// window(Sk) = [switch(Sk), switch(S(k+1)))
// last session of a day: [switch, close), close = min(Executive "close day", end + grace, next local midnight)
import { CONFERENCE_TIMEZONE, addDays, zonedDate, zonedToUtc } from "../operations/time";

/** Owner-confirmed 29 Oct 2026. */
export const DEFAULT_LEAD_MINUTES = 5;
/** PROPOSED, not approved: always passed in from the schedule version, never read as a rule. */
export const DEFAULT_GRACE_MINUTES = 20;

const MINUTE = 60_000;

export interface ScheduledSession {
  id: string;
  /** ISO instants. */
  start: string;
  end: string;
  /** Optional per-slot lead; otherwise the schedule's lead. */
  leadMinutes?: number;
}

export interface SessionWindow {
  sessionId: string;
  start: string;
  end: string;
}

export interface WindowParams {
  leadMinutes: number;
  graceMinutes: number;
  /** Executive "close day" instants, keyed by conference-zone date (YYYY-MM-DD). */
  dayClose?: Record<string, string>;
  timeZone?: string;
}

/** One immutable schedule version (the jsonb snapshot of schedule_version). */
export interface ScheduleSnapshot {
  effectiveFrom: string;
  leadMinutes: number;
  graceMinutes: number;
  automationEnabled: boolean;
  sessions: ScheduledSession[];
}

/** One append-only override entry, with its end event (if any) folded in as `endedAt`. */
export interface SessionOverride {
  id: string;
  scope: "committee" | "conference";
  committeeId?: string | null;
  /**
   * The label the override sets, already resolved for this committee. A conference-scope override names a central slot; the caller
   * maps it to the committee's own session in that slot, or null when the committee has none (then: no session, flagged).
   */
  sessionId: string | null;
  setAt: string;
  expiresAt?: string | null;
  endedAt?: string | null;
}

export type ScheduleError = "start_not_before_end" | "identical_start" | "overlap" | "negative_lead" | "negative_grace";

export type ResolutionFlag = "outside_schedule" | "no_session";

export interface Resolution {
  sessionId: string | null;
  source: "schedule" | "override" | "none";
  /** Null label is always flagged; the nearest session is never chosen. */
  flag: ResolutionFlag | null;
  /** The schedule window that matched (schedule source only). */
  windowStart: string | null;
  windowEnd: string | null;
  /** Next instant the label can change under what is known now. */
  nextSwitchAt: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (ms: number, timeZone: string) => zonedDate(iso(ms), timeZone);
const midnightAfter = (ms: number, timeZone: string) => Date.parse(zonedToUtc(addDays(dayOf(ms, timeZone), 1), "00:00", timeZone));

/** Publish-time validation (section 3). A rejected publish changes nothing; codes are sorted and unique. */
export function validateSchedule(sessions: ScheduledSession[], leadMinutes: number, graceMinutes: number): ScheduleError[] {
  const errors = new Set<ScheduleError>();
  if (leadMinutes < 0 || sessions.some((s) => s.leadMinutes !== undefined && s.leadMinutes < 0)) errors.add("negative_lead");
  if (graceMinutes < 0) errors.add("negative_grace");
  const sorted = sessions.map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end) })).sort((a, b) => a.start - b.start || a.end - b.end);
  for (const s of sorted) if (!(s.start < s.end)) errors.add("start_not_before_end");
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start === sorted[i - 1].start) errors.add("identical_start");
    else if (sorted[i].start < sorted[i - 1].end) errors.add("overlap");
  }
  return [...errors].sort();
}

/** Every window of a valid schedule, in time order. Empty windows (an Executive close before the switch) are dropped. */
export function computeWindows(sessions: ScheduledSession[], params: WindowParams): SessionWindow[] {
  const timeZone = params.timeZone ?? CONFERENCE_TIMEZONE;
  const sorted = [...sessions].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const days = new Map<string, ScheduledSession[]>();
  for (const s of sorted) {
    const day = zonedDate(s.start, timeZone);
    days.set(day, [...(days.get(day) ?? []), s]);
  }
  const out: SessionWindow[] = [];
  for (const [day, list] of days) {
    const dayStart = Date.parse(zonedToUtc(day, "00:00", timeZone));
    const midnight = Date.parse(zonedToUtc(addDays(day, 1), "00:00", timeZone));
    // A window never crosses a day boundary, so a lead that reaches back past midnight stops at it.
    const switches = list.map((s, k) => {
      const early = Date.parse(s.start) - (s.leadMinutes ?? params.leadMinutes) * MINUTE;
      return Math.max(k === 0 ? early : Math.max(early, Date.parse(list[k - 1].end)), dayStart);
    });
    list.forEach((s, k) => {
      const last = k === list.length - 1;
      let end: number;
      if (!last) end = switches[k + 1];
      else {
        end = Math.min(Date.parse(s.end) + params.graceMinutes * MINUTE, midnight);
        const closed = params.dayClose?.[day];
        if (closed !== undefined) end = Math.min(end, Date.parse(closed));
      }
      if (end > switches[k]) out.push({ sessionId: s.id, start: iso(switches[k]), end: iso(end) });
    });
  }
  return out;
}

/** The window containing `at`, half-open [start, end). Null outside every window. */
export function windowAt(windows: SessionWindow[], at: string): SessionWindow | null {
  const t = Date.parse(at);
  return windows.find((w) => Date.parse(w.start) <= t && t < Date.parse(w.end)) ?? null;
}

function nextBoundary(windows: SessionWindow[], at: number): number | null {
  let next: number | null = null;
  for (const w of windows) for (const edge of [Date.parse(w.start), Date.parse(w.end)]) if (edge > at && (next === null || edge < next)) next = edge;
  return next;
}

const paramsOf = (v: ScheduleSnapshot, dayClose: Record<string, string> | undefined, timeZone: string): WindowParams => ({ leadMinutes: v.leadMinutes, graceMinutes: v.graceMinutes, dayClose, timeZone });

/** The version with the greatest effective_from not later than `at`; null if none (a schedule edit is never retroactive). */
export function versionInEffect(versions: ScheduleSnapshot[], at: string): ScheduleSnapshot | null {
  const t = Date.parse(at);
  let best: ScheduleSnapshot | null = null;
  for (const v of versions) {
    const from = Date.parse(v.effectiveFrom);
    if (from <= t && (best === null || from >= Date.parse(best.effectiveFrom))) best = v;
  }
  return best;
}

/**
 * The expiry stored when an override is created. With automation on it is the next scheduled switch under the version in
 * effect then; with automation off there is no scheduled expiry (resolveSession still caps every override at local midnight).
 */
export function overrideExpiry(versions: ScheduleSnapshot[], setAt: string, dayClose?: Record<string, string>, timeZone = CONFERENCE_TIMEZONE): string | null {
  const v = versionInEffect(versions, setAt);
  if (!v || !v.automationEnabled) return null;
  const next = nextBoundary(computeWindows(v.sessions, paramsOf(v, dayClose, timeZone)), Date.parse(setAt));
  return next === null ? null : iso(next);
}

/** When an override stops applying: the earliest of its expiry, its end event and the next local midnight after it was set. */
export function overrideEnds(o: SessionOverride, timeZone = CONFERENCE_TIMEZONE): number {
  const set = Date.parse(o.setAt);
  return Math.min(o.expiresAt ? Date.parse(o.expiresAt) : Infinity, o.endedAt ? Date.parse(o.endedAt) : Infinity, midnightAfter(set, timeZone));
}

/**
 * The label for a committee at `at`, from the schedule versions and override log as they were at `at`.
 * Precedence: a committee override beats a conference override; within a scope the later set_at wins (ties: higher id).
 * No override and automation on: the window rule. No override and automation off (or no version): no session, flagged.
 */
export function resolveSession(input: { versions: ScheduleSnapshot[]; overrides?: SessionOverride[]; dayClose?: Record<string, string>; committeeId?: string; at: string; timeZone?: string }): Resolution {
  const timeZone = input.timeZone ?? CONFERENCE_TIMEZONE;
  const t = Date.parse(input.at);
  const active = (input.overrides ?? [])
    .filter((o) => (o.scope === "conference" || (o.committeeId ?? null) === (input.committeeId ?? null)) && Date.parse(o.setAt) <= t && t < overrideEnds(o, timeZone))
    .sort((a, b) => Number(b.scope === "committee") - Number(a.scope === "committee") || Date.parse(b.setAt) - Date.parse(a.setAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (active.length) {
    const o = active[0];
    return { sessionId: o.sessionId, source: "override", flag: o.sessionId === null ? "no_session" : null, windowStart: null, windowEnd: null, nextSwitchAt: iso(overrideEnds(o, timeZone)) };
  }
  const version = versionInEffect(input.versions, input.at);
  if (!version || !version.automationEnabled) return { sessionId: null, source: "none", flag: "no_session", windowStart: null, windowEnd: null, nextSwitchAt: null };
  const windows = computeWindows(version.sessions, paramsOf(version, input.dayClose, timeZone));
  const hit = windowAt(windows, input.at);
  const next = nextBoundary(windows, t);
  return {
    sessionId: hit?.sessionId ?? null,
    source: "schedule",
    flag: hit ? null : "outside_schedule",
    windowStart: hit?.start ?? null,
    windowEnd: hit?.end ?? null,
    nextSwitchAt: next === null ? null : iso(next),
  };
}
