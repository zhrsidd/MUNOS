import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PENDING_INDICATOR_DELAY_MS, createPendingIndicator } from "../lib/ui/pending";
import { PendingButton } from "../components/pending";

test("the indicator waits for the pending threshold, so near-instant work never flashes it", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen: boolean[] = [];
  const indicator = createPendingIndicator(v => seen.push(v));
  assert.equal(PENDING_INDICATOR_DELAY_MS, 300);
  indicator.set(true);
  t.mock.timers.tick(PENDING_INDICATOR_DELAY_MS - 1);
  indicator.set(false);
  t.mock.timers.tick(1000);
  assert.deepEqual(seen, [], "an operation that finished inside the threshold never showed anything");
  indicator.set(true);
  t.mock.timers.tick(PENDING_INDICATOR_DELAY_MS);
  assert.deepEqual(seen, [true]);
});

test("the indicator disappears the moment the work ends and imposes no minimum visible time", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen: boolean[] = [];
  const indicator = createPendingIndicator(v => seen.push(v));
  indicator.set(true);
  t.mock.timers.tick(PENDING_INDICATOR_DELAY_MS);
  indicator.set(false);
  assert.deepEqual(seen, [true, false], "hidden synchronously, with no further timer");
  t.mock.timers.tick(5000);
  assert.deepEqual(seen, [true, false]);
});

test("repeated pending reports do not stack timers or re-announce, and disposal cancels a waiting timer", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen: boolean[] = [];
  const indicator = createPendingIndicator(v => seen.push(v));
  indicator.set(true);
  indicator.set(true);
  t.mock.timers.tick(PENDING_INDICATOR_DELAY_MS);
  indicator.set(true);
  assert.deepEqual(seen, [true]);
  indicator.set(false);

  indicator.set(true);
  indicator.dispose();
  t.mock.timers.tick(PENDING_INDICATOR_DELAY_MS * 2);
  assert.deepEqual(seen, [true, false], "nothing fires after unmount");
});

test("a pending button keeps its label, reserves the 16 px slot and speaks only once the ring is shown", () => {
  const idle = renderToStaticMarkup(createElement(PendingButton, { pending: false, pendingLabel: "Submitting…" }, "Submit"));
  const busy = renderToStaticMarkup(createElement(PendingButton, { pending: true, pendingLabel: "Submitting…" }, "Submit"));
  for (const html of [idle, busy]) {
    assert.match(html, /<span class="spinner" data-active="false" aria-hidden="true"><\/span>Submit<\/button>/, "ring slot always present, decorative, label unchanged");
    assert.equal((html.match(/role="status"/g) ?? []).length, 1);
    assert.match(html, /<span class="sr-only" role="status"><\/span>/, "no announcement before the threshold");
    assert.doesNotMatch(html, /Submitting/);
  }
  assert.doesNotMatch(idle, /aria-busy/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /^<button type="button" class="pending-button" aria-busy="true">/);
});
