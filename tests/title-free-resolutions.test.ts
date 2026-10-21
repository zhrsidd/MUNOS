import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { POST as submit } from "../app/api/submissions/route";
import { ConferenceProvider } from "../lib/context";
import { repository } from "../lib/repository";
import { grantAccess } from "../lib/access";
import { createSeed } from "../lib/seed";
import { applyCommand, type Command } from "../lib/commands";
import { DurableRepository, fingerprint, type Transport } from "../lib/sync/repository";
import { DurableStore, type Mutation } from "../lib/sync/store";
import { COMPAT_RESOLUTION_TITLE, compatResolutionTitle } from "../lib/resolution-title";
import { matchesResolutionSearch } from "../lib/resolution-identity";
import { handleSubmission, type SubmissionBackend, type SubmitArgs } from "../lib/submissions/service";
import type { LinkInfo } from "../lib/submissions/rules";
import { SubmissionForm } from "../components/operations/submission-form";
import { NewResolutionForm } from "../components/documents";
import type { ConferenceData, Role } from "../lib/domain";

// Handoff 21 October §2: resolutions have no name. The compatibility title only fills `documents.title` (not null, 3 to 200
// characters at the database), is never shown, and a hidden required field can never block a submission.
const GOOGLE_DOC = (n: string) => `https://docs.google.com/document/d/${n.padEnd(30, "x")}/edit?usp=sharing`;
const DEMO_TOKEN = "demo_ga1_0123456789abcdef0123";
const tick = () => new Promise(r => setTimeout(r, 15));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

function multipart(fields: Record<string, string>) {
  const boundary = "----titlefree";
  const body = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + `--${boundary}--\r\n`;
  return new Request("http://localhost/api/submissions", { method: "POST", body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
}
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) setEnv(k, v);
  try { return await run(); } finally { for (const [k, v] of Object.entries(previous)) setEnv(k, v); }
}

test("the compatibility title is one fixed, non-descriptive value that satisfies the database's 3 to 200 character check", () => {
  assert.equal(compatResolutionTitle(), COMPAT_RESOLUTION_TITLE);
  assert.equal(compatResolutionTitle(), compatResolutionTitle(), "stable, so a retried submission is byte-identical to the server's idempotency check");
  assert.equal(COMPAT_RESOLUTION_TITLE, COMPAT_RESOLUTION_TITLE.trim());
  assert.ok(COMPAT_RESOLUTION_TITLE.length >= 3 && COMPAT_RESOLUTION_TITLE.length <= 200);
  assert.equal(compatResolutionTitle.length, 0, "takes no input: nothing a person typed can reach the legacy column through it");
});

test("public endpoint, local/demo backend: a title-free multipart post succeeds; a legacy title is accepted and ignored", async () => {
  await withEnv({ NEXT_PUBLIC_DATA_BACKEND: "local" }, async () => {
    const base = { token: DEMO_TOKEN, submitterId: "d0" };
    const bare = await submit(multipart({ ...base, submissionId: crypto.randomUUID(), googleDoc: GOOGLE_DOC("demoTitleFreeOne") }));
    assert.equal(bare.status, 201);
    const created = await bare.json();
    assert.deepEqual([created.ok, created.status], [true, "created"]);
    assert.match(created.code, /^GA1 \/ D\d+$/, "a code is assigned exactly as before");
    // An older cached page still posts `title`: not read, not required, not stored, never an error.
    const legacy = await submit(multipart({ ...base, submissionId: crypto.randomUUID(), googleDoc: GOOGLE_DOC("demoTitleFreeTwo"), title: "x" }));
    assert.equal(legacy.status, 201, "a legacy title too short for the old rule is no longer a rejection");
    const legacyBody = await legacy.json();
    assert.equal(legacyBody.ok, true);
    assert.notEqual(legacyBody.code, created.code, "a second resolution gets the next code");
    assert.ok(!JSON.stringify(legacyBody).includes("title"));
    const empty = await submit(multipart({ ...base, submissionId: crypto.randomUUID(), googleDoc: GOOGLE_DOC("demoTitleFreeThree"), title: "" }));
    assert.equal(empty.status, 201, "an empty legacy title is not an error either");
  });
});

class RecordingBackend implements SubmissionBackend {
  calls: SubmitArgs[] = [];
  async linkInfo(token: string): Promise<LinkInfo | null> {
    return token === "T".repeat(22) ? { linkId: "l", conferenceId: "c", committeeId: "ga1", conferenceName: "DCMUN", committeeCode: "GA1", committeeName: "General Assembly", shareWith: "", submitters: [{ id: "11111111-1111-4111-8111-111111111111", country: "France", flag: "FR" }] } : null;
  }
  async submit(args: SubmitArgs) { this.calls.push(args); return { status: "created" as const, code: "GA1 / 01" }; }
}
test("the service never reads, validates or forwards a posted title", async () => {
  const backend = new RecordingBackend();
  const form = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ token: "T".repeat(22), submissionId: crypto.randomUUID(), submitterId: "11111111-1111-4111-8111-111111111111", googleDoc: GOOGLE_DOC("serviceTitleFree"), ...extra })) f.set(k, v);
    return f;
  };
  assert.equal((await handleSubmission(form(), backend)).status, 201, "no title field at all");
  for (const title of ["  ", "x", "y".repeat(500), "Protecting civilians online"]) {
    const result = await handleSubmission(form({ title, googleDoc: GOOGLE_DOC("serviceTitle" + title.length) }), backend);
    assert.equal(result.status, 201, `legacy title of ${title.length} characters`);
  }
  assert.equal(backend.calls.length, 5);
  for (const call of backend.calls) {
    assert.ok(!("title" in call), "the backend contract carries no title");
    assert.ok(!JSON.stringify(call).includes("Protecting civilians online") && !JSON.stringify(call).includes("yyyy"));
  }
});

test("public endpoint, Supabase backend path: the route sends only the compatibility title to submit_resolution", async () => {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    seen.push({ path: url.pathname, body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    return url.pathname.endsWith("/submission_link_info")
      ? json({ linkId: "l", conferenceId: "c", committeeId: "ga1", conferenceName: "DCMUN", committeeCode: "GA1", committeeName: "General Assembly", shareWith: "", submitters: [{ id: "11111111-1111-4111-8111-111111111111", country: "France", flag: "FR" }] })
      : json({ status: "created", code: "GA1 / 01" });
  }) as typeof fetch;
  try {
    await withEnv({ NEXT_PUBLIC_DATA_BACKEND: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://devtestrefabcdefghij.supabase.co", SUPABASE_SECRET_KEY: "test-secret-not-real", VERCEL_ENV: undefined }, async () => {
      for (const fields of [{}, { title: "A title typed into an old cached form" }] as Record<string, string>[]) {
        seen.length = 0;
        const response = await submit(multipart({ token: "T".repeat(22), submissionId: crypto.randomUUID(), submitterId: "11111111-1111-4111-8111-111111111111", googleDoc: GOOGLE_DOC("supabasePath"), ...fields }));
        assert.equal(response.status, 201, JSON.stringify(fields));
        const rpc = seen.find(call => call.path.endsWith("/submit_resolution"));
        assert.ok(rpc, "submit_resolution was called");
        assert.equal(rpc.body.title, COMPAT_RESOLUTION_TITLE);
        assert.ok(!JSON.stringify(seen).includes("old cached form"), "the supplied title is never sent anywhere");
      }
    });
  } finally { globalThis.fetch = realFetch; }
});

const formLink: LinkInfo = { linkId: "l", conferenceId: "conf", committeeId: "ga1", conferenceName: "DCMUN", committeeCode: "GA1", committeeName: "General Assembly", shareWith: "", chairs: [{ name: "Chair One", email: "chair@dcmun.example" }], submitters: [{ id: "11111111-1111-4111-8111-111111111111", country: "France", flag: "FR" }] };
test("the public form has no title input or label, and keeps the country, link and Chair-edit confirmation", t => {
  t.mock.method(React, "useSyncExternalStore", ((_s: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  const html = renderToStaticMarkup(createElement(SubmissionForm, { token: "T".repeat(22), link: formLink }));
  assert.doesNotMatch(html, /title/i, "no title input, id, label, placeholder or message");
  assert.doesNotMatch(html, /name="title"|id="title"/);
  assert.equal((html.match(/<input/g) ?? []).length, 2, "only the Google Doc link and the confirmation checkbox remain");
  assert.match(html, /Main submitter \(your country\)/);
  assert.match(html, /Google Doc link/);
  assert.match(html, /I have made sure the Chairs can edit this document\./);
  assert.match(html, /Files \(PDF or Word\) are not accepted/);
  assert.doesNotMatch(html, /type="file"/);
  assert.match(html, /<button class="button primary submit-button">Submit resolution<\/button>/);
});

test("the room sheet no longer tells delegates to enter a title", async () => {
  const sheet = await readFile("app/submit/[token]/sheet/page.tsx", "utf8");
  assert.doesNotMatch(sheet.replace(/title: "Committee submission sheet/, ""), /\btitle\b/i);
  assert.match(sheet, /Choose your country and paste the Google Doc link/);
});

async function renderWithProvider(t: test.TestContext, data: ConferenceData, role: Role, route: string[] | null, child?: React.ReactNode) {
  const require = createRequire(import.meta.url), previous = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const Page = route ? (await import("../app/[[...route]]/page")).default : null;
  if (previous) require.extensions[".css"] = previous; else delete require.extensions[".css"];
  t.mock.method(React, "useSyncExternalStore", ((_s: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  t.mock.method(React, "useEffect", () => {});
  t.mock.method(repository, "getSnapshot", () => data);
  t.mock.method(repository, "getAccess", () => grantAccess([{ role, committee_id: role === "chair" ? "ga1" : null, expires_at: new Date(Date.now() + 3600000).toISOString() }], "staff-device"));
  const router = { bfcacheId: "test", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  const page = child ?? (await Page!({ params: Promise.resolve({ route: route! }) }));
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(PathnameContext.Provider, { value: `/${(route ?? ["chair", "documents"]).join("/")}` }, createElement(ConferenceProvider, null, page))));
}
const seed = () => { const d = createSeed(); d.committees.find(c => c.id === "ga1")!.currentSessionId = "s1"; return d; };

test("the Chair's New resolution form asks only for the Main Submitter and keeps the identity preview line", async t => {
  const data = seed();
  const first = data.delegates.find(d => d.committeeId === "ga1")!;
  const html = await renderWithProvider(t, data, "chair", null, createElement(NewResolutionForm, { committeeId: "ga1", sessionId: "s1", onDone() {} }));
  assert.doesNotMatch(html, /title/i, "no title input or label");
  assert.equal((html.match(/<input/g) ?? []).length, 0, "no free-text field at all");
  assert.match(html, /Main submitter/);
  assert.match(html, /<button class="primary">Create draft<\/button>/);
  assert.ok(text(html).includes(`Resolution number assigned on submission — ${first.country}`), "the preview line from the identity change stays");
});

test("a Chair draft created without any title is stored with the compatibility title, a draft text to match, and the next code", () => {
  const before = seed();
  const command: Command = { type: "newDocument", committeeId: "ga1", sessionId: "s1", submitterId: "d1" };
  const after = applyCommand(before, command, "chair", { id: "m1", actorId: "chair-demo" } as Mutation);
  const created = after.documents.find(d => !before.documents.some(b => b.id === d.id))!;
  assert.equal(created.title, COMPAT_RESOLUTION_TITLE);
  assert.equal(created.status, "Draft");
  assert.match(created.code, /^GA1 \/ \d{2}$/);
  assert.equal(created.submitterId, "d1");
  const version = after.versions.find(v => v.id === created.versionIds[0])!;
  assert.ok(version.text.startsWith(COMPAT_RESOLUTION_TITLE + "\n\n"), "the draft text still begins with the (compatibility) title");
  // The client form's own command carries the same value, so the server's `command->>'title'` is never null.
  const explicit = applyCommand(before, { ...command, title: compatResolutionTitle() }, "chair", { id: "m2", actorId: "chair-demo" } as Mutation);
  assert.deepEqual(explicit.documents.at(-1)!.title, created.title);
  // A command queued before this change still carries a real title; it is kept as history, not replaced.
  const legacy = applyCommand(before, { ...command, title: "Protecting civilians in cyberspace" }, "chair", { id: "m3", actorId: "chair-demo" } as Mutation);
  assert.equal(legacy.documents.at(-1)!.title, "Protecting civilians in cyberspace");
  assert.ok(legacy.versions.at(-1)!.text.startsWith("Protecting civilians in cyberspace\n\n"));
  // An all-whitespace title is not a title.
  assert.equal(applyCommand(before, { ...command, title: "   " }, "chair", { id: "m4", actorId: "chair-demo" } as Mutation).documents.at(-1)!.title, COMPAT_RESOLUTION_TITLE);
});

test("the create command has no title in its optimistic fingerprint, with or without one", () => {
  const data = seed();
  const base = { type: "newDocument" as const, committeeId: "ga1", sessionId: "s1", submitterId: "d1" };
  assert.equal(fingerprint(data, base), null);
  assert.equal(fingerprint(data, { ...base, title: "Legacy" }), null, "a command queued with a title fingerprints exactly as before");
  assert.equal(fingerprint(data, { ...base, title: compatResolutionTitle() }), null);
});

class Server implements Transport {
  actorId = "test-chair";
  data = createSeed();
  online = false;
  receipts = new Set<string>();
  async read() { if (!this.online) throw Error("network unavailable"); return structuredClone(this.data); }
  async send(m: Mutation) {
    if (!this.online) throw Error("network unavailable");
    if (!this.receipts.has(m.id)) { this.data = applyCommand(this.data, m.command, m.role, m); this.receipts.add(m.id); }
  }
}
test("outbox: a create command queued before the change (with a title) and one after (without) both replay exactly once after a restart", async () => {
  const name = "title-free-" + crypto.randomUUID();
  const store = new DurableStore(name), server = new Server();
  let repo = new DurableRepository("ga1", createSeed, store, server);
  await repo.ready(); await tick();
  const initial = repo.getSnapshot()!.documents.length;
  await repo.execute({ type: "newDocument", committeeId: "ga1", sessionId: "s1", title: "Queued before the change", submitterId: "d1" }, "chair");
  await repo.execute({ type: "newDocument", committeeId: "ga1", sessionId: "s1", title: compatResolutionTitle(), submitterId: "d2" }, "chair");
  await repo.execute({ type: "newDocument", committeeId: "ga1", sessionId: "s1", submitterId: "d3" }, "chair");
  await tick();
  assert.equal(repo.getHealth().pending, 3);
  repo.dispose(); await store.close();
  const reopened = new DurableStore(name);
  repo = new DurableRepository("ga1", createSeed, reopened, server);
  await repo.ready(); await tick();
  assert.equal(repo.getHealth().pending, 3, "all three survive the restart");
  server.online = true;
  await repo.flush(); await repo.flush();
  assert.equal(repo.getHealth().pending, 0);
  assert.equal(server.receipts.size, 3);
  const made = server.data.documents.slice(initial);
  assert.deepEqual(made.map(d => d.title), ["Queued before the change", COMPAT_RESOLUTION_TITLE, COMPAT_RESOLUTION_TITLE]);
  assert.deepEqual(made.map(d => d.submitterId), ["d1", "d2", "d3"]);
  await repo.flush();
  assert.equal(server.data.documents.length, initial + 3, "a further flush creates nothing twice");
  repo.dispose(); await reopened.close();
});

test("every screen still names a title-free resolution GA1/xx — Country; the compatibility title is shown nowhere and never searched", async t => {
  const data = seed();
  for (const d of data.documents) d.title = COMPAT_RESOLUTION_TITLE; // as every resolution created after this change
  data.documents.find(d => d.id === "r2")!.comments = [{ id: "c1", text: "Cite the treaty in clause 3.", authorId: "approval-demo", createdAt: "2026-10-19T09:00:00Z" }];
  const country = (id: string) => data.delegates.find(x => x.id === data.documents.find(d => d.id === id)!.submitterId)!.country;
  const code = (id: string) => data.documents.find(d => d.id === id)!.code.replace(/ ?\/ ?/g, "/");
  const screens: [Role, string[]][] = [["chair", ["chair", "documents"]], ["chair", ["chair"]], ["approval", ["approval"]], ["approval", ["approval", "history"]], ["admin", ["admin", "resolution-status"]], ["logistics", ["logistics"]]];
  for (const [role, route] of screens) {
    const html = await renderWithProvider(t, data, role, route);
    assert.ok(!/untitled/i.test(html), `${role}/${route.join("/")} must not show the compatibility title`);
    t.mock.restoreAll();
  }
  const chair = text(await renderWithProvider(t, data, "chair", ["chair", "documents"]));
  assert.ok(chair.includes(`${code("r1")} — ${country("r1")}`));
  assert.ok(chair.includes("Cite the treaty in clause 3."), "feedback stays visible");
  assert.ok(chair.includes(`${code("r2")} — ${country("r2")}`));
  t.mock.restoreAll();
  const exec = text(await renderWithProvider(t, data, "admin", ["admin", "resolution-status"]));
  for (const id of ["r1", "r2", "r3", "r4"]) assert.ok(exec.includes(`${code(id)} — ${country(id)}`), id);
  // Search by code and by country is unaffected; the compatibility title matches nothing.
  const france = data.documents.find(d => country(d.id) === "France");
  assert.ok(france);
  assert.ok(matchesResolutionSearch(code(france.id), { code: france.code, country: "France" }));
  assert.ok(matchesResolutionSearch("france", { code: france.code, country: "France" }));
  assert.ok(matchesResolutionSearch(`${code(france.id).toLowerCase()} fra`, { code: france.code, country: "France" }));
  assert.ok(!matchesResolutionSearch("untitled", { code: france.code, country: "France", extra: ["Draft"] }));
});
