import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { INDICATOR_HEIGHT, INDICATOR_TRANSITION_MS, indicatorPlacement, indicatorTransform, sameRow } from "../lib/ui/tab-indicator";
import { Tabs } from "../components/shell";
import { navigationFor } from "../lib/navigation";

const box = (left: number, top: number, width: number, height = 48) => ({ left, top, bottom: top + height, width });

test("the indicator sits on the bottom edge of the active tab, relative to the tab row", () => {
  const row = box(16, 100, 600, 48);
  assert.deepEqual(indicatorPlacement(row, box(120.5, 100, 72.25)), { x: 104.5, y: 48 - INDICATOR_HEIGHT, w: 72.25 });
  assert.equal(indicatorTransform({ x: 104.5, y: 45, w: 72.25 }), "translate3d(104.5px, 45px, 0) scaleX(72.25)");
});

test("a tab that cannot be measured yields no placement, so the per-tab underline stays", () => {
  const row = box(0, 0, 600);
  assert.equal(indicatorPlacement(row, box(10, 0, 0)), null, "hidden or collapsed tab");
  assert.equal(indicatorPlacement(row, box(Number.NaN, 0, 40)), null);
  assert.equal(indicatorPlacement(row, box(10, 0, Number.POSITIVE_INFINITY)), null);
});

test("the indicator slides along a row and jumps between wrapped rows", () => {
  assert.equal(sameRow({ x: 0, y: 45, w: 50 }, { x: 200, y: 45.4, w: 80 }), true);
  assert.equal(sameRow({ x: 0, y: 45, w: 50 }, { x: 0, y: 93, w: 50 }), false);
  assert.ok(INDICATOR_TRANSITION_MS >= 120 && INDICATOR_TRANSITION_MS <= 180);
});

test("tabs stay real links with current-page semantics, and render a decorative indicator only as an enhancement", () => {
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(Tabs, { items: navigationFor("chair"), role: "chair", section: "roll-call", count: { documents: 3 } })));
  assert.equal((html.match(/<a /g) ?? []).length, 6, "six real links");
  assert.match(html, /<a class="tab active" aria-current="page" href="\/chair\/roll-call">Roll call/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.equal((html.match(/class="tab-indicator" aria-hidden="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-indicator|role="tab"|tabindex/i, "server HTML uses the per-tab underline fallback and adds no tab roles or focus traps");
  assert.match(html, /<button class="tab" aria-expanded="false" aria-haspopup="true">More/);
});
