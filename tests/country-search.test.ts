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

test("opportunities count genuine non-voided speech and POI events for this committee since the session began", () => {
  const event = (id: string, categoryId: string, createdAt = "2026-10-05T09:00:00Z", committeeId = "ga1", voidedAt?: string): ParticipationEvent => ({ id, categoryId, committeeId, delegateId: "gb", points: 0, createdAt, chairId: "chair", resolutionId: null, voidedAt });
  const events = [event("s", "speech"), event("p", "poi"), event("zero", "speech"), event("credit", "submitter"), event("a", "amendment"), event("old", "speech", "2026-10-05T07:00:00Z"), event("other", "speech", undefined, "ga2"), event("void", "poi", undefined, "ga1", "today")];
  assert.deepEqual(sessionOpportunities(events, "ga1", "2026-10-05T08:00:00Z"), { gb: { speeches: 2, pois: 1 } });
  assert.deepEqual(sessionOpportunities(events, "ga1"), { gb: { speeches: 3, pois: 1 } }, "no session start: the whole committee history");
});
