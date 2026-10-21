/** Felix types a reply at a steady pace. Owner-set speed (21 October 2026): 60 characters per second. */
export const REVEAL_CHARS_PER_SECOND = 60;
/** How often the visible text is refreshed while typing: well under one frame of 60 characters/s. */
export const REVEAL_TICK_MS = 33;

/** Characters (whole code points) visible after `elapsedMs`, never more than `total`. */
export function revealedCount(elapsedMs: number, total: number): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.min(total, Math.floor((elapsedMs * REVEAL_CHARS_PER_SECOND) / 1000));
}

/** Milliseconds a reply of `total` characters takes to type out. */
export const revealDurationMs = (total: number) => Math.ceil((total * 1000) / REVEAL_CHARS_PER_SECOND);
