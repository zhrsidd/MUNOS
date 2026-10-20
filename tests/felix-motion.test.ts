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
  return { clock, advance, pending: () => timers.size };
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

test("typing cycles the beak while keys continue and stops after 950 ms of quiet", () => {
  const { clock, advance } = fakeClock();
  const m = ready(clock);
  m.typing();
  assert.equal(m.getState(), "typing");
  advance(240);
  assert.equal(m.getFrame(), "closed-beak");
  for (let i = 0; i < 5; i++) { advance(500); m.typing(); }
  assert.equal(m.getState(), "typing", "still typing while keystrokes continue");
  advance(MOTION.typingQuietMs - 1);
  assert.equal(m.getState(), "typing");
  advance(1);
  assert.equal(m.getState(), "idle");
  assert.equal(m.getFrame(), "idle");
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
