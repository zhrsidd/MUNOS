import test from "node:test";
import assert from "node:assert/strict";
import { saveStatus, type SaveStatusInput } from "../lib/save-status";

const input = (o: Partial<SaveStatusInput["health"]> = {}, online = true, access: SaveStatusInput["access"] = "active"): SaveStatusInput => ({
  health: { mode: "supabase", state: "saved", pending: 0, conflicts: 0, ...o },
  online,
  access,
});
test("nothing pending is the only state that says synced", () => {
  assert.equal(saveStatus(input()).label, "All changes synced");
  for (const o of [{ pending: 1 }, { pending: 2, state: "syncing" as const }, { pending: 1, awaitingConfirmation: 1 }]) assert.notEqual(saveStatus(input(o)).label, "All changes synced");
});
test("each actual state has its own wording", () => {
  assert.equal(saveStatus(input({ pending: 1, state: "saved" })).label, "Saved on this device");
  assert.equal(saveStatus(input({ pending: 3, state: "syncing" })).label, "Waiting to send · 3 changes");
  assert.equal(saveStatus(input({ pending: 1, state: "waiting" })).label, "Waiting to send · 1 change");
  assert.equal(saveStatus(input({ pending: 0, awaitingConfirmation: 2 })).label, "Sent · updating this view");
  assert.equal(saveStatus(input({ conflicts: 1 })).label, "Review needed · open details");
});
test("offline never claims a sync and reports saved local work", () => {
  assert.equal(saveStatus(input({ pending: 2 }, false)).label, "Offline · 2 changes saved on this device");
  assert.equal(saveStatus(input({}, false)).label, "Offline");
});
test("a connectivity failure is not a permission denial; problems and conflicts outrank connectivity", () => {
  const s = saveStatus(input({ pending: 1 }, true, "unavailable"));
  assert.equal(s.label, "Could not verify access · saved work retained");
  assert.doesNotMatch(s.label, /denied|no access/i);
  assert.equal(saveStatus(input({ conflicts: 1 }, false)).label, "Review needed · open details");
  assert.equal(saveStatus(input({ state: "error" })).tone, "problem");
});
test("demo mode says so and never claims a server sync", () => {
  assert.equal(saveStatus(input({ mode: "local" })).label, "Demo · saved in this browser");
});
