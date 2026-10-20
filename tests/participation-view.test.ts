import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed";
import { participationOrder, participationSummary, frozenOrder } from "../lib/commands";
import { contributionCount, pointsLeaderboard } from "../lib/participation-view";

test("contributions count distinct event ids, not points, submitter credit, voids or speech ids", () => {
  const data = createSeed();
  const base = data.events[0];
  data.events = [
    { ...base, id: "a", delegateId: "d0", points: 0, categoryId: "poi", speechId: "one-speech" },
    { ...base, id: "b", delegateId: "d0", points: 1, categoryId: "poi", speechId: "one-speech" },
    { ...base, id: "c", delegateId: "d0", points: 3, categoryId: "amendment" },
    { ...base, id: "credit", delegateId: "d0", points: 5, categoryId: "submitter" },
    { ...base, id: "void", delegateId: "d0", points: 3, categoryId: "speech", voidedAt: "2026-10-19" },
    { ...base, id: "other", delegateId: "d1", points: 100, categoryId: "speech" },
  ];
  data.events.push(data.events[0]);
  assert.equal(contributionCount(data.events.filter(e => e.delegateId === "d0")), 3);
  assert.equal(participationSummary(data, "d0").opportunities, 3);
  const delegates = data.delegates.filter(d => ["d0", "d1"].includes(d.id));
  assert.deepEqual(participationOrder(data, delegates).map(d => d.id), ["d0", "d1"]);
  assert.equal(pointsLeaderboard(data, delegates)[0].delegate.id, "d1");
  const adjustment = { id: "deduct", delegateId: "d0", sessionId: base.sessionId, points: -20, reason: "test", chairId: "chair", chairName: null, createdAt: base.createdAt, reverses: null };
  data.pointAdjustments = [adjustment];
  assert.deepEqual(participationOrder(data, delegates).map(d => d.id), ["d0", "d1"]);
  data.pointAdjustments.push({ ...adjustment, id: "restore", points: 20, reverses: "deduct" });
  assert.equal(participationSummary(data, "d0").opportunities, 3);
});

test("contribution ties use country, name and id, never points; focus order survives live updates", () => {
  const data = createSeed();
  const base = data.events[0];
  const delegates = data.delegates.slice(0, 3).map((d, i) => ({ ...d, country: "Same", name: i === 0 ? "Zed" : "Amy" }));
  data.events = delegates.map((d, i) => ({ ...base, id: `event${i}`, delegateId: d.id, points: i === 0 ? 100 : 0 }));
  const ordered = participationOrder(data, delegates);
  assert.deepEqual(ordered.map(d => d.id), [delegates[1].id, delegates[2].id, delegates[0].id]);
  assert.deepEqual(participationOrder(data, [...delegates].reverse()), ordered);
  data.events.push({ ...base, id: "new", delegateId: delegates[0].id, points: 0 });
  const live = participationOrder(data, delegates);
  assert.equal(live[0].id, delegates[0].id);
  assert.deepEqual(frozenOrder(live, ordered.map(d => d.id)), ordered);
});

test("points list includes every supplied delegation across sessions, with zero/negative totals and no other committee", () => {
  const data = createSeed();
  const delegates = data.delegates.filter(d => d.committeeId === "ga1");
  const base = data.events[0];
  data.events = [{ ...base, id: "old", delegateId: delegates[0].id, sessionId: "old-session", points: 4 }, { ...base, id: "void", delegateId: delegates[1].id, points: 20, voidedAt: "2026-10-19" }];
  data.pointAdjustments = [{ id: "deduct", delegateId: delegates[0].id, sessionId: "s1", points: -6, reason: "test", chairId: "chair", chairName: null, createdAt: base.createdAt, reverses: null }];
  const rows = pointsLeaderboard(data, delegates);
  assert.equal(rows.length, delegates.length);
  assert.equal(rows.at(-1)!.points, -2);
  assert.equal(rows.filter(r => r.points === 0).length, delegates.length - 1);
});
