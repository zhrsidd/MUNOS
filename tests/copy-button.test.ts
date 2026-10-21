import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COPIED_RESET_MS, COPY_FAILED_RESET_MS, copyAnnouncement, createCopyController, type ClipboardLike, type CopyState } from "../lib/ui/copy";
import { CopyButton } from "../components/copy-button";

const recorder = () => {
  const states: CopyState[] = [];
  return { states, onState: (s: CopyState) => states.push(s) };
};
const deferred = () => {
  let resolve!: () => void, reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("Copied is reported only after the clipboard write resolves, then reverts after about two seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { states, onState } = recorder();
  const write = deferred();
  const written: string[] = [];
  const clipboard: ClipboardLike = { writeText: text => { written.push(text); return write.promise; } };
  const controller = createCopyController({ onState, clipboard: () => clipboard });
  const pending = controller.copy("ABC-123");
  assert.deepEqual(written, ["ABC-123"]);
  assert.deepEqual(states, [], "nothing is claimed while the write is pending");
  write.resolve();
  assert.equal(await pending, "copied");
  assert.deepEqual(states, ["copied"]);
  t.mock.timers.tick(COPIED_RESET_MS - 1);
  assert.deepEqual(states, ["copied"]);
  t.mock.timers.tick(1);
  assert.deepEqual(states, ["copied", "idle"]);
});

test("a refused write reports failure, runs the fallback once and never says Copied", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { states, onState } = recorder();
  let fallback = 0;
  const controller = createCopyController({ onState, clipboard: () => ({ writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }) });
  assert.equal(await controller.copy("secret", () => { fallback++; }), "failed");
  assert.deepEqual(states, ["failed"]);
  assert.equal(fallback, 1);
  t.mock.timers.tick(COPY_FAILED_RESET_MS);
  assert.deepEqual(states, ["failed", "idle"]);
});

test("a synchronous throw and a missing Clipboard API are failures too, and a throwing fallback does not hide them", async () => {
  const thrown = recorder();
  const throwing = createCopyController({ onState: thrown.onState, clipboard: () => ({ writeText: () => { throw new Error("insecure context"); } }) });
  assert.equal(await throwing.copy("x"), "failed");
  assert.deepEqual(thrown.states, ["failed"]);
  throwing.cancel();

  const missing = recorder();
  let fallback = 0;
  const controller = createCopyController({ onState: missing.onState, clipboard: () => undefined });
  assert.equal(await controller.copy("x", () => { fallback++; throw new Error("field unmounted"); }), "failed");
  assert.deepEqual(missing.states, ["failed"]);
  assert.equal(fallback, 1);
  controller.cancel();
});

test("a new click restarts the timer and a superseded write cannot overwrite the newer result", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { states, onState } = recorder();
  const first = deferred();
  let calls = 0;
  const controller = createCopyController({ onState, clipboard: () => ({ writeText: () => (++calls === 1 ? first.promise : Promise.resolve()) }) });
  const slow = controller.copy("one");
  assert.equal(await controller.copy("two"), "copied");
  first.reject(new Error("late refusal"));
  assert.equal(await slow, "failed");
  assert.deepEqual(states, ["copied"], "the late answer to the first click is ignored");
  t.mock.timers.tick(COPIED_RESET_MS - 500);
  // Clicking again before it reverts restarts the full two seconds.
  assert.equal(await controller.copy("three"), "copied");
  t.mock.timers.tick(COPIED_RESET_MS - 1);
  assert.deepEqual(states, ["copied", "copied"]);
  t.mock.timers.tick(1);
  assert.deepEqual(states, ["copied", "copied", "idle"]);
});

test("cancelling on unmount clears the timer and ignores a write still in flight", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { states, onState } = recorder();
  const controller = createCopyController({ onState, clipboard: () => ({ writeText: () => Promise.resolve() }) });
  await controller.copy("x");
  controller.cancel();
  t.mock.timers.tick(COPIED_RESET_MS * 2);
  assert.deepEqual(states, ["copied"], "no state change after cancel");

  const late = deferred();
  const inFlight = createCopyController({ onState, clipboard: () => ({ writeText: () => late.promise }) });
  const pending = inFlight.copy("y");
  inFlight.cancel();
  late.resolve();
  await pending;
  t.mock.timers.tick(COPIED_RESET_MS * 2);
  assert.deepEqual(states, ["copied"]);
  // The controller stays usable afterwards (React StrictMode mounts, unmounts and mounts again).
  assert.equal(await inFlight.copy("z"), "copied");
  assert.deepEqual(states, ["copied", "copied"]);
});

test("one polite announcement per outcome and silence when the label reverts", () => {
  assert.equal(copyAnnouncement("idle", "Copied.", "Copy failed."), "");
  assert.equal(copyAnnouncement("copied", "Copied.", "Copy failed."), "Copied.");
  assert.equal(copyAnnouncement("failed", "Copied.", "Copy failed."), "Copy failed.");
});

test("the button keeps native semantics, one status region and a stable width reservation", () => {
  const html = renderToStaticMarkup(createElement(CopyButton, { text: "https://example.test/x", label: "Copy link" }));
  assert.match(html, /^<button type="button" class="copy-button">/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /<span class="sr-only" role="status"><\/span>/, "silent until there is something to say");
  for (const label of ["Copy link", "Copied", "Select and copy"]) assert.match(html, new RegExp(`>${label}</span>`));
  assert.equal((html.match(/data-active="true"/g) ?? []).length, 1, "exactly one visible label");
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 2, "the reserving ghost labels are hidden from assistive technology");
  assert.match(html, /^<button[^>]*>.*?Copy link<\/span><span data-active="false" aria-hidden="true">Copied/);
});
