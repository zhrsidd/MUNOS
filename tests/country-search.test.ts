import test from "node:test";
import assert from "node:assert/strict";
import { searchDelegates, sessionOpportunities } from "../lib/country-search";
import type { Delegate, ParticipationEvent } from "../lib/domain";

const delegate = (id: string, country: string): Delegate => ({ id, country, flag: "🌐", name: id, schoolId: "school", committeeId: "committee", email: "" });
const delegates = [delegate("gb", "United Kingdom"), delegate("us", "United States"), delegate("de", "Germany"), delegate("qa", "Qatar")];
const counts = { gb: { speeches: 5, pois: 0 }, us: { speeches: 1, pois: 4 }, de: { speeches: 2, pois: 2 }, qa: { speeches: 0, pois: 1 } };
const ids = (query: string, mostFirst = false) => searchDelegates(delegates, query, counts, "speeches", mostFirst).map(d => d.id);

test("country picker recognises canonical aliases, word prefixes, substrings and small typos", () => {
  assert.equal(ids("UK")[0], "gb");
  assert.equal(ids("usa")[0], "us");
  assert.equal(ids("king")[0], "gb");
  assert.equal(ids("erman")[0], "de");
  assert.equal(ids("Germnay")[0], "de");
  assert.equal(ids("Qatr")[0], "qa");
  assert.deepEqual(ids("zzzzzz"), []);
  assert.deepEqual(ids("united"), ["us", "gb"]);
});

test("exact search relevance beats opportunity counts; counts sort each kind with stable ties", () => {
  assert.deepEqual(ids(""), ["qa", "us", "de", "gb"]);
  assert.deepEqual(ids("", true), ["gb", "de", "us", "qa"]);
  assert.equal(ids("United Kingdom", false)[0], "gb");
  assert.deepEqual(searchDelegates(delegates, "", counts, "pois").map(d => d.id), ["gb", "qa", "de", "us"]);
  const ties = [delegate("z", "Qatar"), delegate("a", "Qatar"), delegate("b", "Germany")];
  assert.deepEqual(searchDelegates(ties, "", {}, "speeches").map(d => d.id), ["b", "a", "z"]);
});

test("only supplied eligible delegates are searchable; unknown delegations retain their identity", () => {
  assert.deepEqual(searchDelegates(delegates.filter(d => d.id !== "gb"), "UK", counts, "speeches"), []);
  const custom = delegate("custom", "Observer mission");
  assert.deepEqual(searchDelegates([custom], "observer", {}, "speeches"), [custom]);
  assert.deepEqual(searchDelegates([], "", {}, "pois"), []);
  assert.equal(searchDelegates([delegate("tr", "Türkiye")], "turkey", {}, "speeches")[0].country, "Türkiye");
});

test("opportunities count genuine non-voided speech and POI events for this session only", () => {
  const event = (id: string, categoryId: string, sessionId = "now", voidedAt?: string): ParticipationEvent => ({ id, categoryId, sessionId, delegateId: "gb", points: 0, createdAt: "", chairId: "chair", resolutionId: null, voidedAt });
  const events = [event("s", "speech"), event("p", "poi"), event("zero", "speech"), event("credit", "submitter"), event("a", "amendment"), event("old", "speech", "before"), event("void", "poi", "now", "today")];
  assert.deepEqual(sessionOpportunities(events, "now"), { gb: { speeches: 2, pois: 1 } });
});
