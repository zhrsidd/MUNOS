/**
 * Felix's expression controller, adapted from the owner-supplied reference (felix-motion.js) for a React lifecycle.
 * Framework-free and timer-injectable so it is testable without a DOM: the component feeds it conditions (motion
 * preference, reduced motion, hidden tab, offscreen, frames decoded) and renders whatever frame it reports.
 * Expressions are decorative only: they never represent saving, syncing, errors or notification delivery.
 */
export const FELIX_FRAMES = ["idle", "half-blink", "blink", "closed-beak", "happy-squint", "content"] as const;
export type FelixFrame = (typeof FELIX_FRAMES)[number];
export type FelixMotionState = "idle" | "blink" | "typing" | "petting";

/** Timings from docs/FELIX.md (owner ANIMATION.md). */
export const MOTION = { blinkMinMs: 5200, blinkJitterMs: 3200, blinkMs: 260, typingCycleMs: 1400, typingQuietMs: 950, petMs: 1120, petCooldownMs: 1250 } as const;

type Step = readonly [at: number, frame: FelixFrame];
const BLINK: Step[] = [[0, "half-blink"], [75, "blink"], [155, "half-blink"], [230, "idle"]];
const TYPING: Step[] = [[0, "idle"], [240, "closed-beak"], [440, "idle"], [720, "half-blink"], [795, "blink"], [875, "half-blink"], [950, "idle"], [1140, "closed-beak"]];
const PET: Step[] = [[0, "half-blink"], [90, "happy-squint"], [310, "content"], [690, "happy-squint"], [960, "half-blink"], [1060, "idle"]];

export type Conditions = { enabled: boolean; reduced: boolean; hidden: boolean; offscreen: boolean; ready: boolean };
export type Clock = {
  now(): number;
  random(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};
const systemClock: Clock = {
  now: () => Date.now(),
  random: () => Math.random(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class FelixMotion {
  private frame: FelixFrame = "idle";
  private state: FelixMotionState = "idle";
  private conditions: Conditions = { enabled: true, reduced: false, hidden: false, offscreen: false, ready: false };
  private timers = new Set<unknown>();
  private stopTypingTimer: unknown = null;
  private typingUntil = 0;
  private lastPet = -Infinity;
  private destroyed = false;
  private listeners = new Set<() => void>();
  constructor(private clock: Clock = systemClock) {}

  getFrame = () => this.frame;
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Whether any movement is allowed right now. */
  canMove = () => { const c = this.conditions; return c.enabled && !c.reduced && !c.hidden && !c.offscreen && c.ready && !this.destroyed; };

  /** Updates one or more conditions; any change cancels what is running and restarts from the still idle face. */
  setConditions(next: Partial<Conditions>) {
    const before = this.conditions;
    this.conditions = { ...before, ...next };
    if ((Object.keys(next) as (keyof Conditions)[]).some(k => before[k] !== this.conditions[k])) { this.typingUntil = 0; this.idle(); }
  }

  /** A keystroke in the Felix composer: run (or keep running) the beak cycle until 950 ms of quiet. */
  typing() {
    this.typingUntil = this.clock.now() + MOTION.typingQuietMs;
    if (!this.canMove()) return;
    if (this.state === "typing") this.armTypingStop();
    else if (this.state !== "petting") this.typingLoop();
  }
  stopTyping() { this.typingUntil = 0; if (this.state === "typing") this.idle(); }

  /** Hover or keyboard focus on the launcher: the short happy response, at most once per cooldown. */
  pet() {
    if (!this.canMove() || this.clock.now() - this.lastPet < MOTION.petCooldownMs) return;
    this.lastPet = this.clock.now();
    this.sequence("petting", PET, MOTION.petMs);
  }

  /** (Re)starts after mount; a destroyed controller can be started again (React may remount an effect). */
  start() { this.destroyed = false; this.idle(); }
  /** Unmount: cancel every pending frame change and return to the still idle face. */
  destroy() { this.destroyed = true; this.typingUntil = 0; this.clear(); this.set("idle", "idle"); }

  private emit() { for (const listener of this.listeners) listener(); }
  private set(state: FelixMotionState, frame: FelixFrame) {
    if (this.state === state && this.frame === frame) return;
    this.state = state; this.frame = frame; this.emit();
  }
  private later(fn: () => void, ms: number) {
    const id = this.clock.setTimeout(() => { this.timers.delete(id); if (!this.destroyed) fn(); }, ms);
    this.timers.add(id);
  }
  private clear() {
    for (const id of this.timers) this.clock.clearTimeout(id);
    this.timers.clear();
    if (this.stopTypingTimer !== null) this.clock.clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = null;
  }
  private idle() {
    this.clear();
    this.set("idle", "idle");
    if (this.canMove()) this.later(() => this.sequence("blink", BLINK, MOTION.blinkMs), MOTION.blinkMinMs + this.clock.random() * MOTION.blinkJitterMs);
  }
  private resume() { if (this.canMove() && this.clock.now() < this.typingUntil) this.typingLoop(); else this.idle(); }
  private sequence(state: FelixMotionState, steps: Step[], duration: number) {
    this.clear();
    if (!this.canMove()) { this.idle(); return; }
    this.set(state, steps[0][1]);
    for (const [at, frame] of steps.slice(1)) this.later(() => this.set(state, frame), at);
    this.later(() => this.resume(), duration);
  }
  private typingLoop() { this.sequence("typing", TYPING, MOTION.typingCycleMs); this.armTypingStop(); }
  private armTypingStop() {
    if (this.stopTypingTimer !== null) this.clock.clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = this.clock.setTimeout(() => { this.stopTypingTimer = null; if (this.state === "typing") this.idle(); }, Math.max(0, this.typingUntil - this.clock.now()));
  }
}

/** The image for a frame at the device's pixel density: 96 px covers 1x–2x, 144 px covers 3x. */
export function felixFrameSrc(frame: FelixFrame, size: 96 | 144 = 96) {
  return `/felix/felix-${frame}-${size}.webp`;
}
export function felixFrameSrcSet(frame: FelixFrame) {
  return `${felixFrameSrc(frame, 96)} 2x, ${felixFrameSrc(frame, 144)} 3x`;
}
/** Every derivative the offline shell must hold. */
export const FELIX_ASSETS = FELIX_FRAMES.flatMap(frame => [felixFrameSrc(frame, 96), felixFrameSrc(frame, 144)]);
