import test from "node:test";
import assert from "node:assert/strict";
import {
  NUMBER_ASSIGNED_ON_SUBMISSION, SUBMITTER_UNAVAILABLE, displayResolutionCode, matchesResolutionSearch, previewIdentity,
  resolutionIdentities, resolutionIdentity, resolutionLabel, submitterCountry, type IdentityDelegate,
} from "../lib/resolution-identity";
import { resolutionOverview } from "../lib/resolution-overview";
import { approvalHistory } from "../lib/approval-history";
import { createSeed } from "../lib/seed";
import type { Resolution } from "../lib/domain";

const delegate = (id: string, country: string, committeeId = "ga1"): IdentityDelegate => ({ id, country, committeeId });
const res = (id: string, code: string, submitterId: string, extra: Partial<Resolution> = {}): Resolution => ({ id, committeeId: "ga1", sessionId: "s1", code, title: `Old title ${id}`, submitterId, status: "Draft", versionIds: [], copies: 10, comments: [], ...extra });
const delegates = [delegate("d1", "France"), delegate("d2", "Brazil")];

test("identity is the code, an em dash and the Main Submitter's country; the stored code keeps its spaces", () => {
  const r = res("r1", "GA1 / 01", "d1");
  const identity = resolutionIdentity(r, delegates);
  assert.equal(identity.text, "GA1/01 — France");
  assert.deepEqual([identity.code, identity.country, identity.submitter, identity.available, identity.preview], ["GA1/01", "France", "France", true, false]);
  assert.equal(r.code, "GA1 / 01", "never rewrites the stored code");
  assert.equal(resolutionLabel(r, delegates), "GA1/01 — France");
  assert.ok(!identity.text.includes("Old title"), "the title is never part of the identity");
});

test("slash and space variants of a code display the same, and odd codes are left readable", () => {
  for (const code of ["GA1 / 01", "GA1/01", "GA1 /01", "GA1/ 01", "  GA1  /  01  "]) assert.equal(displayResolutionCode(code), "GA1/01", code);
  assert.equal(displayResolutionCode("ECOSOC / 3f2a9c1b"), "ECOSOC/3f2a9c1b");
  assert.equal(displayResolutionCode("ECOSOC / 01"), "ECOSOC/01");
  assert.equal(displayResolutionCode(""), "");
  assert.equal(displayResolutionCode(null), "");
});

test("a missing, unknown or archived Main Submitter reads 'Main submitter unavailable' and never guesses a country", () => {
  assert.equal(resolutionIdentity(res("r1", "GA1 / 01", "gone"), delegates).text, `GA1/01 — ${SUBMITTER_UNAVAILABLE}`);
  assert.equal(resolutionIdentity(res("r1", "GA1 / 01", "d1"), []).text, "GA1/01 — Main submitter unavailable", "a snapshot with no delegates");
  assert.equal(resolutionIdentity({ code: "GA1 / 01" }, delegates).text, "GA1/01 — Main submitter unavailable", "no submitter id at all");
  assert.equal(resolutionIdentity(null, delegates).available, false);
  const archived = resolutionIdentity(res("r1", "GA1 / 01", "d1"), [{ ...delegate("d1", "France"), archived: true }]);
  assert.equal(archived.text, "GA1/01 — Main submitter unavailable");
  assert.equal(archived.country, null);
  assert.equal(archived.available, false);
  assert.equal(resolutionIdentity(res("r1", "GA1 / 01", "d1"), [delegate("d1", "   ")]).text, "GA1/01 — Main submitter unavailable", "a blank country is not a country");
  assert.ok(!resolutionIdentity(res("r1", "GA1 / 01", "gone"), delegates).text.includes("Old title"), "never falls back to the title");
});

test("a country published by the server is used only when the delegate cannot be read", () => {
  const published = { ...res("r1", "GA1 / 01", "d9"), submitterCountry: "  Chile " };
  assert.equal(resolutionIdentity(published, []).text, "GA1/01 — Chile");
  assert.equal(resolutionIdentity({ ...published, submitterId: "d1" }, delegates).text, "GA1/01 — France", "the reader's own delegate wins");
});

test("a delegate from another committee is never used (cross-committee boundary)", () => {
  const sc = [delegate("d1", "China", "sc")];
  assert.equal(resolutionIdentity(res("r1", "GA1 / 01", "d1"), sc).text, "GA1/01 — Main submitter unavailable");
  assert.equal(submitterCountry(res("r1", "GA1 / 01", "d1"), sc), null);
  assert.equal(resolutionIdentity(res("r1", "GA1 / 01", "d1"), [delegate("d1", "France", "ga1"), ...sc.slice(1)]).text, "GA1/01 — France");
});

test("a long country name stays whole in the identity (the screen wraps it) and is whitespace-normalised", () => {
  const long = "The Former Yugoslav Republic of Macedonia and the Federal Democratic Republic of Something Extraordinarily Long";
  assert.equal(resolutionIdentity(res("r1", "GA1 / 01", "d1"), [delegate("d1", `  ${long.replace("and", "and\n")}  `)]).text, `GA1/01 — ${long}`);
});

test("a pre-submission preview says the number is assigned on submission", () => {
  assert.equal(previewIdentity(null, delegates).text, NUMBER_ASSIGNED_ON_SUBMISSION);
  assert.equal(previewIdentity("", delegates, "ga1").submitter, null);
  const chosen = previewIdentity("d1", delegates, "ga1");
  assert.equal(chosen.text, "Resolution number assigned on submission — France");
  assert.equal(chosen.preview, true);
  assert.equal(previewIdentity("d1", [delegate("d1", "China", "sc")], "ga1").text, NUMBER_ASSIGNED_ON_SUBMISSION, "another committee's delegate is ignored");
});

test("two resolutions with the same Main Submitter stay distinct by code", () => {
  const a = res("r1", "GA1 / 01", "d1"), b = res("r2", "GA1 / 02", "d1");
  const identify = resolutionIdentities(delegates);
  assert.notEqual(identify(a).text, identify(b).text);
  assert.deepEqual([identify(a).text, identify(b).text], ["GA1/01 — France", "GA1/02 — France"]);
});

test("search matches code with or without slash and spaces, country, status; case-insensitively; never the title", () => {
  const fields = { code: "GA1 / 01", country: "France", extra: ["Disarmament & International Security", "Draft", undefined] };
  for (const q of ["ga1/01", "GA1/01", "ga1 / 01", "ga1 01", "GA1  /01", "ga1/0", "ga1", "01", "france", "FRANCE", "fra", "ga1 france", "ga1/01 — france", "ga1 / 01 france", "draft", "disarmament"])
    assert.ok(matchesResolutionSearch(q, fields), q);
  for (const q of ["ga2/01", "ga1/02", "ga1 02", "ga1 1", "brazil", "ga1 brazil", "Old title", "safeguarding"]) assert.ok(!matchesResolutionSearch(q, fields), q);
  assert.ok(matchesResolutionSearch("", fields) && matchesResolutionSearch("   ", fields), "an empty query matches everything");
  assert.ok(matchesResolutionSearch("turkiye", { code: "GA1 / 03", country: "Türkiye" }), "accents do not matter");
  assert.ok(!matchesResolutionSearch("france", { code: "GA1 / 01", country: null }), "an unavailable country matches nothing");
});

test("resolution overview searches code and Main Submitter country, not title, and exposes the identity", () => {
  const data = createSeed();
  const r1 = data.documents.find(d => d.id === "r1")!, r2 = data.documents.find(d => d.id === "r2")!;
  const country = (r: Resolution) => data.delegates.find(d => d.id === r.submitterId)!.country;
  const all = resolutionOverview(data).flatMap(g => g.resolutions);
  assert.equal(all.find(x => x.resolution.id === "r1")!.identity.text, `GA1/01 — ${country(r1)}`);
  const ids = (q: string) => resolutionOverview(data, "", q).flatMap(g => g.resolutions.map(x => x.resolution.id));
  for (const q of ["ga1/01", "GA1 / 01", "ga1 01", country(r1).toUpperCase()]) assert.ok(ids(q).includes("r1"), q);
  assert.deepEqual(ids("ga1/02"), ["r2"]);
  assert.deepEqual(ids("ga1 / 02"), ["r2"]);
  assert.ok(ids(country(r2)).includes("r2") && !ids(country(r2)).includes("r1"));
  assert.deepEqual(ids("Safeguarding civilians"), [], "the title is not searchable");
  assert.deepEqual(ids(r2.title), []);
  assert.ok(ids("review").includes("r2"), "status still searchable");
  data.documents[0].outcome = "Passed";
  assert.ok(ids("passed").includes("r1"), "outcome still searchable");
  const unreadable = createSeed();
  unreadable.delegates = unreadable.delegates.filter(d => d.id !== "d0");
  const row = resolutionOverview(unreadable).flatMap(g => g.resolutions).find(x => x.resolution.id === "r1")!;
  assert.equal(row.identity.text, "GA1/01 — Main submitter unavailable");
  assert.equal(row.submitter, "Main submitter unavailable");
});

test("approval history labels come from the reader's own data; a resolution out of view reads 'Main submitter unavailable'", () => {
  const data = createSeed();
  const r = data.documents.find(d => d.id === "r2")!;
  const dec = (id: string, documentId: string, extra = {}) => ({ id, documentId, decision: "approved" as const, round: 1, versionId: null, versionNumber: 1, reviewerId: "u", reviewerName: "Priya", commentId: null, decidedAt: "2026-10-19T11:00:00Z", ...extra });
  data.documentDecisions = [dec("in-view", r.id, { code: "GA1 / 02", title: "Server title" }), dec("gone", "elsewhere", { code: "SC / 09", title: "Server title", committeeId: "sc" })];
  const history = approvalHistory(data);
  const country = data.delegates.find(d => d.id === r.submitterId)!.country;
  assert.equal(history.find(h => h.id === "in-view")!.identity.text, `GA1/02 — ${country}`);
  assert.equal(history.find(h => h.id === "gone")!.identity.text, "SC/09 — Main submitter unavailable");
  assert.ok(history.every(h => !JSON.stringify(h).includes("Server title")), "the projection's title is not carried into history entries");
  data.delegates = [];
  assert.equal(approvalHistory(data).find(h => h.id === "in-view")!.identity.text, "GA1/02 — Main submitter unavailable", "Approval snapshots without delegates stay honest");
});
