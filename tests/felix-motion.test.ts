import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { FELIX_ASSETS, FELIX_FRAMES, FelixMotion, MOTION, felixFrameSrcSet, type Clock } from "../lib/felix/motion";

/** A manual clock: timers run only when the test advances time. */
function fakeClock(random = 0.5) {
  let now = 0, next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    random: () => random,
    setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id as number); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { clock, advance, pending: () => timers.size, now: () => now };
}
const ready = (clock: Clock) => { const m = new FelixMotion(clock); m.start(); m.setConditions({ ready: true }); return m; };

test("idle: one 260 ms blink every 5.2–8.4 s, no constant movement", () => {
  const { clock, advance } = fakeClock(0);
  const m = ready(clock);
  const frames: string[] = [];
  m.subscribe(() => frames.push(m.getFrame()));
  advance(MOTION.blinkMinMs - 1);
  assert.deepEqual(frames, [], "nothing moves before the first blink");
  advance(1);
  assert.equal(m.getState(), "blink");
  advance(MOTION.blinkMs);
  assert.deepEqual(frames.filter((f, i) => f !== frames[i - 1]), ["half-blink", "blink", "half-blink", "idle"]);
  assert.equal(m.getState(), "idle");
  const late = fakeClock(0.999);
  const slow = ready(late.clock);
  late.advance(MOTION.blinkMinMs + MOTION.blinkJitterMs - 10);
  assert.equal(slow.getState(), "idle");
  late.advance(10);
  assert.equal(slow.getState(), "blink", "the longest gap is at most 8.4 s");
});

/** Starts typing at t = 0 and records every frame change with its time, until `until` ms. */
function recordTyping(until: number, keyEvery?: number) {
  const { clock, advance, now, pending } = fakeClock();
  const m = ready(clock);
  const log: { at: number; frame: string; state: string }[] = [];
  m.subscribe(() => log.push({ at: now(), frame: m.getFrame(), state: m.getState() }));
  m.typing();
  for (let t = 0; t < until; t += keyEvery ?? until) { advance(Math.min(keyEvery ?? until, until - t)); if (keyEvery && now() < until) m.typing(); }
  return { m, log, advance, now, pending };
}

test("typing: one gentle cycle of 1.0–1.2 s with a single beak change and one brief blink", () => {
  assert.ok(MOTION.typingCycleMs >= 1000 && MOTION.typingCycleMs <= 1200, "inside the requested 1.0–1.2 s");
  assert.ok(MOTION.typingCycleMs < 1400, "faster than the 1.4 s original preview");
  const { log } = recordTyping(MOTION.typingCycleMs - 1, 100);
  assert.deepEqual(
    log.map(entry => [entry.at, entry.frame]),
    [[0, "idle"], [260, "closed-beak"], [440, "idle"], [640, "half-blink"], [715, "blink"], [795, "half-blink"], [870, "idle"]],
    "the full cycle, from the still idle face at the first key",
  );
  assert.equal(log[0].state, "typing");
  const frames = log.map(entry => entry.frame);
  assert.equal(frames.filter(f => f === "closed-beak").length, 1, "the beak closes once (and reopens) per cycle");
  assert.equal(frames.filter(f => f === "blink").length, 1, "exactly one blink per cycle");
  assert.ok(870 - 640 <= MOTION.blinkMs, "the blink is no longer than the idle blink");
});

test("typing: stops 600 ms after the last keystroke, mid-cycle if need be", () => {
  assert.equal(MOTION.typingQuietMs, 600);
  const { clock, advance, pending } = fakeClock();
  const m = ready(clock);
  m.typing();
  advance(300); // the beak is closed here, part way through the cycle
  assert.equal(m.getFrame(), "closed-beak");
  m.typing();
  advance(MOTION.typingQuietMs - 1);
  assert.equal(m.getState(), "typing", "599 ms after the last key");
  advance(1);
  assert.equal(m.getState(), "idle", "600 ms after the last key");
  assert.equal(m.getFrame(), "idle");
  advance(MOTION.typingCycleMs * 3);
  assert.equal(m.getState(), "idle", "no looping after the typing has stopped");
  assert.equal(pending(), 1, "only the next idle blink is scheduled");
});

test("typing: continuous keystrokes extend the deadline and never restart the cycle", () => {
  // A key every 120 ms for 5 s: the cycle repeats on its own 1.1 s schedule, not on each key.
  const { log, m, advance } = recordTyping(5000, 120);
  const closes = log.filter((entry, i) => entry.frame === "closed-beak" && log[i - 1]?.frame !== "closed-beak").map(entry => entry.at);
  assert.deepEqual(closes, [260, 1360, 2460, 3560, 4660], "one beak close per 1.1 s, however often keys arrive");
  for (const entry of log) assert.ok([0, 260, 440, 640, 715, 795, 870].includes(entry.at % MOTION.typingCycleMs), `frame change at a fixed point in the cycle (${entry.at})`);
  assert.equal(m.getState(), "typing");
  advance(MOTION.typingQuietMs);
  assert.equal(m.getState(), "idle", "stops 600 ms after the last key of the burst");
});

test("typing: submit, blur and closing the panel stop it at once", () => {
  const { clock, advance, pending } = fakeClock();
  const m = ready(clock);
  m.typing();
  advance(300);
  m.stopTyping();
  assert.equal(m.getState(), "idle");
  assert.equal(m.getFrame(), "idle");
  advance(MOTION.typingCycleMs * 2);
  assert.equal(m.getState(), "idle", "a stopped face does not resume without a new keystroke");
  assert.equal(pending(), 1, "only the idle blink remains scheduled");
  m.stopTyping();
  assert.equal(m.getState(), "idle", "stopping an idle face is harmless");
});

test("typing: motion off, reduced motion, hidden tab, offscreen or undecoded frames stop it and ignore new keys", () => {
  for (const condition of [{ enabled: false }, { reduced: true }, { hidden: true }, { offscreen: true }, { ready: false }]) {
    const { clock, advance, pending } = fakeClock();
    const m = ready(clock);
    m.typing();
    advance(300);
    assert.equal(m.getState(), "typing");
    m.setConditions(condition);
    assert.equal(m.getState(), "idle", JSON.stringify(condition));
    assert.equal(m.getFrame(), "idle");
    assert.equal(pending(), 0, "every timer cancelled");
    m.typing();
    advance(5000);
    assert.equal(m.getFrame(), "idle", "keys do not animate a face that may not move");
    assert.equal(pending(), 0);
  }
});

test("typing: a keystroke during the idle blink or after petting takes over without leaking timers", () => {
  const { clock, advance, pending } = fakeClock(0);
  const m = ready(clock);
  advance(MOTION.blinkMinMs + 80);
  assert.equal(m.getState(), "blink");
  m.typing();
  assert.equal(m.getState(), "typing");
  m.stopTyping();
  m.destroy();
  assert.equal(pending(), 0);
  const second = fakeClock();
  const pet = ready(second.clock);
  pet.pet();
  pet.typing();
  assert.equal(pet.getState(), "petting", "petting is a separate response and is not cut short by typing");
  second.advance(1000);
  pet.typing();
  second.advance(MOTION.petMs - 1000);
  assert.equal(pet.getState(), "typing", "typing continues afterwards while the deadline holds");
  second.advance(MOTION.typingQuietMs);
  assert.equal(pet.getState(), "idle");
});

test("hover/focus petting lasts 1.12 s with a 1.25 s cooldown", () => {
  const { clock, advance } = fakeClock();
  const m = ready(clock);
  m.pet();
  assert.equal(m.getState(), "petting");
  advance(90);
  assert.equal(m.getFrame(), "happy-squint");
  advance(310 - 90);
  assert.equal(m.getFrame(), "content");
  advance(MOTION.petMs - 310);
  assert.equal(m.getState(), "idle");
  m.pet();
  assert.equal(m.getState(), "idle", "cooldown: no retrigger within 1.25 s");
  advance(MOTION.petCooldownMs - MOTION.petMs);
  m.pet();
  assert.equal(m.getState(), "petting");
});

test("reduced motion, motion off, hidden tab, offscreen or undecoded frames hold the static idle face and cancel timers", () => {
  for (const condition of [{ reduced: true }, { enabled: false }, { hidden: true }, { offscreen: true }, { ready: false }]) {
    const { clock, advance, pending } = fakeClock();
    const m = ready(clock);
    m.pet();
    m.setConditions(condition);
    assert.equal(m.getFrame(), "idle", JSON.stringify(condition));
    assert.equal(m.getState(), "idle");
    assert.equal(pending(), 0, "nothing scheduled");
    m.pet(); m.typing();
    advance(20_000);
    assert.equal(m.getFrame(), "idle", JSON.stringify(condition));
  }
  const { clock, advance, pending } = fakeClock();
  const m = ready(clock);
  m.typing();
  m.destroy();
  assert.equal(pending(), 0, "unmount cancels every timer");
  advance(20_000);
  assert.equal(m.getFrame(), "idle");
});

test("optimised frame derivatives exist for every expression, at 96 and 144 px, and are in the offline shell", () => {
  assert.deepEqual([...FELIX_FRAMES], ["idle", "half-blink", "blink", "closed-beak", "happy-squint", "content"]);
  assert.equal(FELIX_ASSETS.length, 12);
  for (const asset of FELIX_ASSETS) {
    const file = `public${asset}`;
    assert.ok(existsSync(file), file);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    assert.ok(bytes.length < 20_000, `${file} is small (${bytes.length} bytes)`);
  }
  assert.equal(felixFrameSrcSet("blink"), "/felix/felix-blink-96.webp 2x, /felix/felix-blink-144.webp 3x");
  const shell = readFileSync("public/sw.js", "utf8");
  assert.match(shell, /const FELIX = \['idle','half-blink','blink','closed-beak','happy-squint','content'\]\.flatMap\(frame=>\[96,144\]/);
  assert.match(shell, /\.\.\.FELIX\]/);
  assert.match(shell, /FELIX\.includes\(url\.pathname\)/);
});

test("the launcher is a labelled 48 px face in a button, mounted for every workspace", () => {
  const helper = readFileSync("components/felix-helper.tsx", "utf8");
  assert.match(helper, /aria-label=\{open \? "Close Felix" : "Open Felix"\}/);
  assert.match(helper, /aria-expanded=\{open\}/);
  assert.match(helper, /<FelixFace motion=\{motion\} size=\{48\}/);
  assert.match(helper, /alt=""/);
  assert.match(helper, /role="status" aria-live="polite"/);
  const workspace = readFileSync("components/workspace.tsx", "utf8");
  assert.match(workspace, /<FelixHelper key=\{`\$\{role\}:/);
  assert.doesNotMatch(workspace, /role === "chair" && <FelixHelper/, "not limited to one workspace");
});

test("replies are instant: no typewriter, thinking delay or staggering, and each reply is one live-region addition", () => {
  const helper = readFileSync("components/felix-helper.tsx", "utf8");
  assert.doesNotMatch(helper, /setTimeout|setInterval|requestAnimationFrame|typewriter|thinking/i, "nothing delays or paces reply text or links");
  // The question and the whole reply (text and link together) enter the log in one state update, so the polite
  // log announces the finished reply once, never per letter.
  assert.match(helper, /setMessages\(old => \{[\s\S]*from: "you"[\s\S]*from: "felix" as const, text: reply\.text[\s\S]*href: reply\.href/);
  assert.match(helper, /role="log" aria-live="polite"/);
  assert.equal((helper.match(/aria-live=/g) ?? []).length, 2, "the popup region and the conversation log are the only live regions");
});
