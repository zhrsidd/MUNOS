// The speaker timer is a LOCAL tool: it is never saved to the conference database, never audited and never sent through the
// outbox (owner decision, 19 October 2026). State lives on the device, keyed by committee, so a reload and other tabs on the same
// device see the same timer. Pure functions here; the browser storage and the React hook are thin wrappers.
export const DEFAULT_DURATION = 90;
export const TIMER_DURATIONS: readonly number[] = [60, 90, 120, 180];
const MAX_SECONDS = 3600;

export interface LocalTimer {
  /** Configured speaking time in seconds. */
  duration: number;
  /** Seconds left when the timer was last paused or reset. */
  remaining: number;
  /** Device time (ms) the timer was started, or null while paused/ready. */
  startedAt: number | null;
}

export const freshTimer = (duration = DEFAULT_DURATION): LocalTimer => ({ duration, remaining: duration, startedAt: null });

/** Whole seconds left at `now`, never negative. */
export function timerRemaining(t: LocalTimer, now: number): number {
  const elapsed = t.startedAt === null || now <= 0 ? 0 : Math.max(0, (now - t.startedAt) / 1000);
  return Math.max(0, Math.ceil(t.remaining - elapsed));
}

export type TimerPhase = "ready" | "running" | "expired";
export function timerPhase(t: LocalTimer, now: number): TimerPhase {
  const left = timerRemaining(t, now);
  if (left === 0) return "expired";
  return t.startedAt === null ? "ready" : "running";
}

/** Start, or resume from where it was paused. An expired timer starts again from its full duration. */
export function startTimer(t: LocalTimer, now: number): LocalTimer {
  if (t.startedAt !== null) return t;
  const left = timerRemaining(t, now);
  return { duration: t.duration, remaining: left || t.duration, startedAt: now };
}

export function pauseTimer(t: LocalTimer, now: number): LocalTimer {
  if (t.startedAt === null) return t;
  return { duration: t.duration, remaining: timerRemaining(t, now), startedAt: null };
}

/** Back to the full configured duration, stopped (what a new speech does). */
export const resetTimer = (t: LocalTimer): LocalTimer => freshTimer(t.duration);

export function setTimerDuration(seconds: number): LocalTimer {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS) throw Error("Choose a duration between 1 second and 1 hour.");
  return freshTimer(Math.round(seconds));
}

/** Parse stored JSON defensively: anything malformed is ignored and the timer starts fresh. */
export function parseTimer(raw: string | null | undefined): LocalTimer | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LocalTimer> | null;
    if (!v || typeof v !== "object") return null;
    const { duration, remaining, startedAt } = v;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 1 || duration > MAX_SECONDS) return null;
    if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0 || remaining > MAX_SECONDS) return null;
    if (startedAt !== null && (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt <= 0)) return null;
    return { duration, remaining, startedAt: startedAt ?? null };
  } catch {
    return null;
  }
}

export const timerStorageKey = (committeeId: string) => `conference-os:timer:${committeeId}`;
