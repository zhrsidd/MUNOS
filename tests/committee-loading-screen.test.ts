import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed";
import { applyCommand } from "../lib/commands";
import { DurableStore } from "../lib/sync/store";
import { DurableRepository } from "../lib/sync/repository";
import type { StaffAccess } from "../lib/access";
import { loadingScreenFeatureKey, readLoadingCommittee } from "../lib/loading-screen";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AlternativeLoadingScreen } from "../components/committee-workspace-loading";

const access = (): StaffAccess => ({ status: "active", roles: ["chair"], committeeIds: ["ga1"], actorId: "chair-device", validUntil: Date.now() + 60000 });

test("artwork uses live text, stable loading semantics and neither removed line nor fake progress", () => {
  const html = renderToStaticMarkup(createElement(AlternativeLoadingScreen, { committeeCode: "GA1" }));
  assert.match(html, /DCMUN OS/);
  assert.match(html, /GA1/);
  assert.match(html, /committee-collage-v1.webp/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Opening your workspace"/);
  assert.doesNotMatch(html, /Diplomatic Royale|Questionable decorum|All diplomacy|progressbar|percent/i);
});

test("alternative loader defaults off and selects only a known, assigned, non-archived committee", async () => {
  const store = new DurableStore(`loading-${crypto.randomUUID()}`);
  try {
    let data = createSeed();
    const conf = data.conference.id;
    const key = `supabase:${conf}:chair-device`;
    const save = () => store.update(key, () => ({ key, base: data, pending: [], savedAt: new Date().toISOString() }));
    assert.equal(await readLoadingCommittee(store, conf, access()), null);
    await save();
    assert.equal(await readLoadingCommittee(store, conf, access()), null);
    data = applyCommand(data, { type: "feature", name: loadingScreenFeatureKey("ga1"), enabled: true }, "admin");
    await save();
    assert.equal((await readLoadingCommittee(store, conf, access()))?.id, "ga1");
    assert.equal(await readLoadingCommittee(store, "other-conference", access()), null);
    assert.equal(await readLoadingCommittee(store, conf, { ...access(), actorId: "other-actor" }), null);
    assert.equal(await readLoadingCommittee(store, conf, { ...access(), committeeIds: ["unassigned"] }), null);
    data.committees.find(c => c.id === "ga1")!.archived = true;
    await save();
    assert.equal(await readLoadingCommittee(store, conf, access()), null);
  } finally { await store.close(); }
});

test("multi-committee startup uses the saved assignment; missing or unauthorized selection stays standard", async () => {
  const store = new DurableStore(`loading-multi-${crypto.randomUUID()}`);
  try {
    const data = createSeed(), conf = data.conference.id, key = `supabase:${conf}:chair-device`;
    data.conference.features[loadingScreenFeatureKey("ga1")] = true;
    const multi = { ...access(), committeeIds: ["ga1", "other"] };
    await store.update(key, () => ({ key, base: data, pending: [], savedAt: new Date().toISOString() }));
    assert.equal(await readLoadingCommittee(store, conf, multi), null);
    await store.savePreferences(`context:${conf}`, { committeeId: "ga1" });
    assert.equal((await readLoadingCommittee(store, conf, multi))?.id, "ga1");
    await store.savePreferences(`context:${conf}`, { committeeId: "not-assigned" });
    assert.equal(await readLoadingCommittee(store, conf, multi), null);
  } finally { await store.close(); }
});

test("unverified, expired and non-Chair access does not even read the cosmetic cache", async () => {
  let reads = 0;
  const store = { read: async () => { reads++; return undefined; }, readPreferences: async () => { reads++; return undefined; } };
  for (const status of ["loading", "noAccess", "unavailable", "signedOut", "demo"] as const) {
    assert.equal(await readLoadingCommittee(store, "conference", { ...access(), status }), null);
  }
  for (const invalid of [{ ...access(), validUntil: Date.now() - 1 }, { ...access(), validUntil: undefined }, { ...access(), roles: ["admin"] as const }, { ...access(), actorId: undefined }]) {
    assert.equal(await readLoadingCommittee(store, "conference", { ...invalid, roles: [...invalid.roles] }), null);
  }
  assert.equal(await readLoadingCommittee(store, undefined, access()), null);
  assert.equal(reads, 0);
});

test("cache failure and a mismatched snapshot conference leave the original loader available", async () => {
  const broken = { read: async () => { throw Error("Storage unavailable"); }, readPreferences: async () => undefined };
  assert.equal(await readLoadingCommittee(broken, "conference", access()), null);
  const base = createSeed();
  base.conference.features[loadingScreenFeatureKey("ga1")] = true;
  const wrong = { read: async () => ({ key: "wrong", base, pending: [], savedAt: "now" }), readPreferences: async () => undefined };
  assert.equal(await readLoadingCommittee(wrong, "different-conference", access()), null);
});

test("committee loading setting uses the existing admin command and durable outbox", async () => {
  const store = new DurableStore(`loading-outbox-${crypto.randomUUID()}`);
  const repo = new DurableRepository("local-loading-test", createSeed, store, {
    actorId: "executive-device", read: async () => { throw Error("Offline"); }, send: async () => { throw Error("Offline"); },
  });
  try {
    await repo.ready();
    const command = { type: "feature" as const, name: loadingScreenFeatureKey("ga1"), enabled: true };
    assert.throws(() => applyCommand(createSeed(), command, "chair"));
    await repo.execute(command, "admin");
    assert.equal(repo.getSnapshot()?.conference.features[command.name], true);
    assert.deepEqual(repo.getPending()[0].command, command);
  } finally { repo.dispose(); await store.close(); }
});
