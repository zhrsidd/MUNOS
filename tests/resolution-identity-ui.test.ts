import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ConferenceProvider } from "../lib/context";
import { repository } from "../lib/repository";
import { grantAccess } from "../lib/access";
import { createSeed } from "../lib/seed";
import { AmendmentForm } from "../components/amendments/form";
import { felixContext } from "../lib/felix/context";
import { answerQuestion } from "../lib/felix/answer";
import { buildReminders } from "../lib/felix/reminders";
import type { AmendmentLinkInfo } from "../lib/amendments/rules";
import type { ConferenceData, Resolution, Role } from "../lib/domain";

/** Renders a real workspace route for one role, the way the offline-shell tests do. */
async function render(t: test.TestContext, data: ConferenceData, role: Role, route: string[], committee: string | null = role === "chair" ? "ga1" : null) {
  const require = createRequire(import.meta.url), previous = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const { default: Page } = await import("../app/[[...route]]/page");
  if (previous) require.extensions[".css"] = previous; else delete require.extensions[".css"];
  t.mock.method(React, "useSyncExternalStore", ((_s: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  t.mock.method(React, "useEffect", () => {});
  t.mock.method(repository, "getSnapshot", () => data);
  t.mock.method(repository, "getAccess", () => grantAccess([{ role, committee_id: committee, expires_at: new Date(Date.now() + 3600000).toISOString() }], "staff-device"));
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  const page = await Page({ params: Promise.resolve({ route }) });
  const path = `/${route.join("/")}`;
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(PathnameContext.Provider, { value: path }, createElement(ConferenceProvider, null, page))));
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const seed = () => { const d = createSeed(); d.committees.find(c => c.id === "ga1")!.currentSessionId = "s1"; return d; };
const doc = (d: ConferenceData, id: string) => d.documents.find(r => r.id === id)!;
const country = (d: ConferenceData, r: Resolution) => d.delegates.find(x => x.id === r.submitterId)!.country;
const identity = (d: ConferenceData, id: string) => `${doc(d, id).code.replace(/ ?\/ ?/g, "/")} — ${country(d, doc(d, id))}`;
const titles = (d: ConferenceData, ...ids: string[]) => ids.map(id => doc(d, id).title);
function noTitles(html: string, d: ConferenceData, ...ids: string[]) {
  for (const title of titles(d, ...ids)) assert.ok(!html.includes(title), `the stored title "${title}" must not be rendered`);
}

test("Chair Resolutions: each row is named GA1/01 — country, keeping status, latest feedback and the working Doc link", async t => {
  const data = seed();
  const sentBack = doc(data, "r2");
  sentBack.status = "Draft";
  sentBack.comments = [{ id: "c1", text: "Cite the treaty in clause 3.", authorId: "approval-demo", createdAt: "2026-10-19T09:00:00Z" }];
  data.resolutionLinks = [{ documentId: "r2", workingDocId: "a".repeat(30), approvalCopyDocId: null, access: "ok", submittedAt: null, revision: 1 }];
  const html = await render(t, data, "chair", ["chair", "documents"]);
  const plain = text(html);
  assert.ok(plain.includes(identity(data, "r1")), identity(data, "r1"));
  assert.ok(plain.includes(identity(data, "r2")), identity(data, "r2"));
  noTitles(html, data, "r1", "r2", "r3", "r4");
  assert.ok(!plain.includes(identity(data, "r3")), "another committee's resolution is not listed");
  assert.match(html, /class="resolution-identity"/);
  assert.match(plain, /Changes requested/);
  assert.ok(plain.includes("Cite the treaty in clause 3."), "latest Approval feedback stays visible");
  assert.ok(html.includes(`https://docs.google.com/document/d/${"a".repeat(30)}/edit`), "working Doc link stays");
  assert.ok(!plain.includes(data.delegates.find(d => d.id === "d1")!.name), "no delegate personal name is shown as part of a resolution");
});

test("Chair of one committee never gets a country from another committee's delegates", async t => {
  const data = seed();
  doc(data, "r1").submitterId = "d16"; // a Security Council delegate (China)
  assert.equal(data.delegates.find(d => d.id === "d16")!.committeeId, "sc");
  for (const route of [["chair", "documents"], ["chair"], ["chair", "voting"], ["chair", "amendments"]]) {
    const html = await render(t, data, "chair", route);
    const plain = text(html);
    assert.ok(plain.includes("GA1/01 — Main submitter unavailable"), route.join("/"));
    assert.ok(!plain.includes("GA1/01 — China"), route.join("/"));
    assert.ok(!plain.includes("China"), `${route.join("/")}: no country from another committee's delegates`);
    t.mock.restoreAll();
  }
});

test("Chair Debate, Voting and Amendments name the resolution in debate by identity, not title", async t => {
  const data = seed();
  const id = identity(data, "r1");
  const debate = await render(t, data, "chair", ["chair"]);
  assert.ok(text(debate).includes(`RESOLUTION IN DEBATE ${id}`), "debate heading");
  noTitles(debate, data, "r1", "r2");
  t.mock.restoreAll();
  const voting = await render(t, data, "chair", ["chair", "voting"]);
  assert.ok(text(voting).includes(`${id} · Voting procedure`), "voting heading");
  noTitles(voting, data, "r1");
  t.mock.restoreAll();
  data.amendments = [{ id: "a1", committeeId: "ga1", resolutionId: "r1", sessionId: "s1", submitterId: "d1", type: "Add", clause: "Clause 4", wording: "Adds a reporting duty.", status: "In Debate", outcome: null, createdAt: "2026-10-05T06:00:00Z", revision: 1 }];
  const amendments = await render(t, data, "chair", ["chair", "amendments"]);
  assert.ok(text(amendments).includes(`${id} · Amendments`), "amendments heading");
  noTitles(amendments, data, "r1");
  t.mock.restoreAll();
  const context = await render(t, data, "chair", ["chair"]);
  assert.ok(text(context).includes(`Resolution ${id} Submitted by`), "amendment-in-debate context names the resolution by identity");
  noTitles(context, data, "r1");
});

test("Approval queue and detail show GA1/02 — country, not the title; history labels follow the reader's data", async t => {
  const data = seed();
  data.documentDecisions = [{ id: "dec1", documentId: "r2", decision: "review_started", round: 1, versionId: null, versionNumber: 1, reviewerId: "u", reviewerName: "Priya Nair", commentId: null, decidedAt: "2026-10-19T09:00:00Z", code: "GA1 / 02", title: "Server projection title" }];
  const queue = await render(t, data, "approval", ["approval"]);
  for (const id of ["r2", "r4"]) assert.ok(text(queue).includes(identity(data, id)), id);
  noTitles(queue, data, "r1", "r2", "r3", "r4");
  assert.ok(!queue.includes("Server projection title"));
  assert.match(text(queue), /VERSION 1/);
  assert.match(queue, /Your decision/);
  t.mock.restoreAll();
  const history = await render(t, data, "approval", ["approval", "history"]);
  assert.ok(text(history).includes(identity(data, "r2")));
  assert.ok(!history.includes("Server projection title") && !history.includes(doc(data, "r2").title));
  t.mock.restoreAll();
  // An Approval snapshot whose delegates table is empty (the hosted Approval role) stays honest rather than guessing.
  const bare = seed();
  bare.documentDecisions = data.documentDecisions;
  bare.delegates = [];
  const honest = text(await render(t, bare, "approval", ["approval"]));
  assert.ok(honest.includes("GA1/02 — Main submitter unavailable"));
  assert.ok(honest.includes("SC/01 — Main submitter unavailable"));
  t.mock.restoreAll();
  const honestHistory = text(await render(t, bare, "approval", ["approval", "history"]));
  assert.ok(honestHistory.includes("GA1/02 — Main submitter unavailable"));
});

test("Executive resolution status searches code and country and shows identity, not title", async t => {
  const data = seed();
  const html = await render(t, data, "admin", ["admin", "resolution-status"], null);
  for (const id of ["r1", "r2", "r3", "r4"]) assert.ok(text(html).includes(identity(data, id)), id);
  noTitles(html, data, "r1", "r2", "r3", "r4");
  assert.match(html, /placeholder="Code, country or status"/);
  assert.ok(!/placeholder="Code, title/.test(html));
});

test("Logistics print queue and Completed use the identity and keep copies, version and the Mark printed action", async t => {
  const data = seed();
  const queue = await render(t, data, "logistics", ["logistics"], null);
  assert.ok(text(queue).includes(identity(data, "r3")));
  noTitles(queue, data, "r3");
  assert.match(text(queue), /30 copies/);
  assert.match(queue, /Mark printed/);
  assert.match(text(queue), /VERSION 1/);
  t.mock.restoreAll();
  doc(data, "r3").status = "Printed";
  const done = await render(t, data, "logistics", ["logistics", "completed"], null);
  assert.ok(text(done).includes(identity(data, "r3")));
  noTitles(done, data, "r3");
  t.mock.restoreAll();
  data.delegates = [];
  doc(data, "r3").status = "Approved";
  assert.ok(text(await render(t, data, "logistics", ["logistics"], null)).includes("ECOSOC/01 — Main submitter unavailable"));
});

test("Felix reminders and answers name resolutions by identity, never by title", () => {
  const data = seed();
  const chair = felixContext(data, "chair", "ga1");
  const reminders = buildReminders(chair);
  const debate = reminders.find(r => r.kind === "chair:debate")!;
  assert.ok(debate.text.startsWith(identity(data, "r1")), debate.text);
  assert.ok(reminders.find(r => r.kind === "chair:with-approval")!.text.includes(identity(data, "r2")));
  for (const r of reminders) for (const id of ["r1", "r2", "r3", "r4"]) assert.ok(!r.text.includes(doc(data, id).title), r.text);
  assert.ok(!reminders.some(r => r.text.includes(identity(data, "r3"))), "another committee's resolution never appears for a Chair");
  const why = answerQuestion("why can't I debate this resolution", chair, reminders);
  assert.ok(why.text.includes(`${identity(data, "r1")} is in debate now`), why.text);
  assert.ok(why.text.includes(`${identity(data, "r2")} is Review`), why.text);
  assert.ok(!why.text.includes(doc(data, "r1").title) && !why.text.includes(doc(data, "r2").title));

  const approval = buildReminders(felixContext(data, "approval")).map(r => r.text).join(" | ");
  assert.ok(approval.includes(identity(data, "r2")) && approval.includes(identity(data, "r4")), approval);
  const bare = seed();
  bare.delegates = [];
  const hosted = buildReminders(felixContext(bare, "approval")).map(r => r.text).join(" | ");
  assert.ok(hosted.includes("GA1/02 — Main submitter unavailable"), hosted);
  const print = buildReminders(felixContext(data, "logistics"));
  assert.ok(print[0].text.includes(identity(data, "r3")) && !print[0].text.includes(doc(data, "r3").title), print[0].text);
});

test("the public amendment form names the resolution by identity; the country appears once the link publishes the submitter", () => {
  const link: AmendmentLinkInfo = { committee: { id: "ga1", code: "GA1", name: "General Assembly 1" }, resolution: { id: "r1", code: "GA1 / 01", title: "International cooperation" }, delegates: [{ id: "d1", country: "France" }] };
  const today = text(renderToStaticMarkup(createElement(AmendmentForm, { token: "t".repeat(40), link })));
  assert.ok(today.includes("GA1/01 — Main submitter unavailable"));
  assert.ok(!today.includes("International cooperation"));
  const published = text(renderToStaticMarkup(createElement(AmendmentForm, { token: "t".repeat(40), link: { ...link, resolution: { ...link.resolution!, submitterId: "d1" } } })));
  assert.ok(published.includes("GA1/01 — France"));
  assert.ok(!published.includes("International cooperation"));
});
