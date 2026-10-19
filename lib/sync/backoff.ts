// Pure retry/poll timing and failure classification for the offline sync loop.
// Day 1 (16 Oct): every device used the same 2→60 s ladder with <1 s of jitter, so devices that failed together retried
// together, and each retry was a full conference snapshot that itself timed out (Postgres statement_timeout = 8 s).
// These helpers add proportional jitter and a slower ladder when the server (not the network) is the problem.

export type ErrorKind = "overload" | "network" | "conflict" | "other";

/** Database/API saturation rather than a lost connection: more requests make it worse. */
const OVERLOAD_CODES = new Set(["57014", "53300", "53400", "57P01", "57P03", "PGRST002", "PGRST003", "55P03"]);
const OVERLOAD_TEXT = /statement timeout|canceling statement|timed? ?out|too many (connections|requests|clients)|connection pool|service unavailable|bad gateway|gateway time|upstream|overload|schema cache/i;

export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return undefined;
}

export function classifyError(error: unknown): ErrorKind {
  const code = errorCode(error);
  if (code && OVERLOAD_CODES.has(code)) return "overload";
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
  if (status === 429 || (status >= 500 && status <= 599)) return "overload";
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  if (OVERLOAD_TEXT.test(text)) return "overload";
  if (/network|failed to fetch|load failed|offline|fetch/i.test(text)) return "network";
  return "other";
}

const LADDER = {
  // Lost connection or unknown failure: retry quickly, as before (2, 4, 8 … 60 s).
  network: { base: 2000, cap: 60000 },
  // The server is timing out: back off harder so hundreds of waiting actions do not keep it saturated (8 … 90 s).
  overload: { base: 8000, cap: 90000 },
} as const;

/**
 * Delay before the next automatic attempt. Never shorter than the previous ladder, plus 0–50% positive jitter so devices
 * that failed in the same second spread out. `random` is injectable for tests.
 */
export function retryDelay(attempts: number, kind: ErrorKind = "other", random: () => number = Math.random): number {
  const ladder = kind === "overload" ? LADDER.overload : LADDER.network;
  const step = Math.min(ladder.cap, ladder.base * 2 ** Math.max(0, Math.min(attempts, 10) - 1));
  return Math.round(step * (1 + 0.5 * random()));
}

/** Steady-state safety-net refresh. Realtime delivers changes, so a connected device polls less; ±20% jitter de-phases devices. */
export const POLL_CONNECTED_MS = 120_000;
export const POLL_DISCONNECTED_MS = 60_000;
export function pollDelay(realtimeConnected: boolean, random: () => number = Math.random): number {
  return Math.round((realtimeConnected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS) * (0.8 + 0.4 * random()));
}

/** Passive triggers (focus, Realtime, peer tabs, polling) never refresh more often than this when nothing is waiting to send. */
export const MIN_REFRESH_GAP_MS = 5_000;
/** Behind a conflict nothing can be sent, so passive refreshes are spread further apart. */
export const BLOCKED_REFRESH_GAP_MS = 30_000;
/** At most this many actions (counting any acknowledged earlier) are confirmed by one snapshot read. */
export const MAX_BATCH = 25;
