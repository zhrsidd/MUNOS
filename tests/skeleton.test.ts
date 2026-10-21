import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ConferenceProvider } from "../lib/context";
import { PassedAmendmentHistory } from "../components/amendments/history";
import { SkeletonRows } from "../components/skeleton";
import { repository } from "../lib/repository";
import { createSeed } from "../lib/seed";
import type { StaffAccess } from "../lib/access";

test("skeleton rows are decorative, announced once and sized to the rows they replace", () => {
  const html = renderToStaticMarkup(createElement(SkeletonRows, { label: "Loading passed amendments…", rows: 3, height: 150, lines: 3 }));
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /^<div class="skeleton-list" role="status" aria-busy="true" style="--skeleton-row-height:150px;--skeleton-row-gap:12px">/);
  assert.match(html, /<span class="sr-only">Loading passed amendments…<\/span>/);
  assert.equal((html.match(/class="skeleton-row"/g) ?? []).length, 3);
  assert.equal((html.match(/class="skeleton-line"/g) ?? []).length, 9);
  assert.equal((html.match(/data-last="true"/g) ?? []).length, 3, "the last line of each row is shorter");
  // Every shape sits inside one aria-hidden wrapper, so assistive technology reads only the label.
  assert.match(html, /<div aria-hidden="true" class="skeleton-rows">/);
  assert.doesNotMatch(html, /<button|<a |<input|progressbar/);
});

const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
function renderHistory(t: test.TestContext, access: StaffAccess) {
  t.mock.method(React, "useSyncExternalStore", ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  t.mock.method(repository, "getSnapshot", () => createSeed());
  t.mock.method(repository, "getAccess", () => access);
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router },
    createElement(PathnameContext.Provider, { value: "/chair/amendments" },
      createElement(ConferenceProvider, null, createElement(PassedAmendmentHistory, { committeeId: "ga1" })))));
}

test("the first uncached passed-amendment read shows placeholders, never a No-amendments claim", t => {
  const html = renderHistory(t, { status: "active", roles: ["chair"], committeeIds: ["ga1"], actorId: "staff-device" });
  assert.match(html, /Loading passed amendments…/);
  assert.match(html, /aria-busy="true"/);
  assert.equal((html.match(/class="skeleton-row"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /No passed amendments yet/);
});

test("a local workspace has nothing to wait for and keeps its honest empty state", t => {
  const html = renderHistory(t, { status: "demo", roles: ["chair"], committeeIds: ["ga1"] });
  assert.doesNotMatch(html, /skeleton|aria-busy/);
  assert.match(html, /No passed amendments yet/);
});
