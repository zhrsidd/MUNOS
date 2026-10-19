import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ConferenceProvider } from "../lib/context";
import { StaffAccessGate } from "../components/staff-access";
import { repository } from "../lib/repository";
import { createSeed } from "../lib/seed";
import type { ConferenceData } from "../lib/domain";
import type { StaffAccess } from "../lib/access";
import type { Health } from "../lib/sync/repository";

test("initial access uses one decorative, offline-ready seal and one meaningful loading announcement", () => {
  const html = renderToStaticMarkup(createElement(StaffAccessGate, { access: { status: "loading", roles: [], committeeIds: [] } }));
  assert.equal((html.match(/class="workspace-loading"/g) ?? []).length, 1);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /src="\/dcmun-logo.jpg"/);
  assert.doesNotMatch(html, /\/_next\/image|<input|<button|synced|percent|progressbar/i);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /Opening your workspace…/);
});

test("loading disappears as soon as data exists; cached work stays visible through every refresh state", t => {
  const data = createSeed();
  let snapshot: ConferenceData | null = null;
  let health: Health = { ...repository.getHealth(), state: "syncing", message: "Opening conference…" };
  const access: StaffAccess = { status: "active", roles: ["chair"], committeeIds: ["ga1"], actorId: "staff-device" };
  t.mock.method(React, "useSyncExternalStore", ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  t.mock.method(repository, "getSnapshot", () => snapshot);
  t.mock.method(repository, "getHealth", () => health);
  t.mock.method(repository, "getAccess", () => access);
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  const render = () => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router },
    createElement(PathnameContext.Provider, { value: "/chair" },
      createElement(ConferenceProvider, null, createElement("h2", null, "Retained debate content")))));
  assert.match(render(), /workspace-loading-orbit/);
  snapshot = data;
  for (const state of ["saved", "syncing", "waiting", "conflict", "error"] as const) {
    health = { ...health, state, pending: state === "saved" ? 0 : 2 };
    const html = render();
    assert.match(html, /Retained debate content/);
    assert.doesNotMatch(html, /workspace-loading|Opening your workspace/);
  }
});

test("missing data with a failed startup offers existing retry and recovery controls instead of an endless spinner", t => {
  let state: Health["state"] = "waiting";
  const health = repository.getHealth();
  const access: StaffAccess = { status: "active", roles: ["chair"], committeeIds: ["ga1"], actorId: "staff-device" };
  t.mock.method(React, "useSyncExternalStore", ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  t.mock.method(repository, "getSnapshot", () => null);
  t.mock.method(repository, "getHealth", () => ({ ...health, state, message: "Opening failed. Saved work is retained." }));
  t.mock.method(repository, "getAccess", () => access);
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  for (state of ["waiting", "error"] as const) {
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: "/chair" }, createElement(ConferenceProvider, null, createElement("h2", null, "Sensitive workspace")))));
    assert.match(html, /Connection needed|Retry access/);
    assert.match(html, /Export saved changes/);
    assert.match(html, /Opening failed. Saved work is retained./);
    assert.doesNotMatch(html, /workspace-loading|Sensitive workspace/);
  }
});
