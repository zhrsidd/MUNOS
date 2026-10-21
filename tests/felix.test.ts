import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { Resolution, Role } from "../lib/domain";
import type { Amendment } from "../lib/batch/types";
import type { Health } from "../lib/sync/repository";
import { createSeed } from "../lib/seed";
import { applyCommand } from "../lib/commands";
import { destinationSlugs } from "../lib/navigation";
import { conceptsIn, matchIntent, normalise } from "../lib/felix/match";
import { KNOWLEDGE, topicsFor, type Answer } from "../lib/felix/knowledge";
import { answerQuestion, destinationHrefs, safeLink, situation } from "../lib/felix/answer";
import { buildReminders, formatReminders, SHORT_WORDS } from "../lib/felix/reminders";
import { felixContext, type FelixContext } from "../lib/felix/context";

const ROLES: Role[] = ["chair", "approval", "logistics", "admin"];
const doc = (id: string, status: Resolution["status"], title = `Resolution ${id}`, extra: Partial<Resolution> = {}): Resolution => ({ id, committeeId: "ga1", sessionId: "s1", code: id, title, submitterId: "d1", status, versionIds: [], copies: 3, comments: [], ...extra });
const amendment = (id: string, status: Amendment["status"], extra: Partial<Amendment> = {}): Amendment => ({ id, committeeId: "ga1", resolutionId: "r1", sessionId: "s1", submitterId: "d1", type: "Add", clause: `Clause ${id}`, wording: "x", status, outcome: null, createdAt: "2026-11-05T08:00:00Z", revision: 1, ...extra });
const synced: FelixContext["health"] = { mode: "supabase", state: "saved", pending: 0, conflicts: 0, latency: 200 };
const chairBase: NonNullable<FelixContext["chair"]> = { committeeId: "ga1", committeeCode: "GA1", sessionId: "s1", sessionName: "Committee Session 1", hasSessions: true, delegates: 20, marked: 20, present: 18, speaking: false, queued: 0, submissions: [], changesRequested: [], passedToApply: [], photos: [] };
const chairCtx = (over: Partial<NonNullable<FelixContext["chair"]>> = {}, extra: Partial<FelixContext> = {}): FelixContext => ({ role: "chair", documents: [], amendments: [], health: synced, chair: { ...chairBase, ...over }, ...extra });
const ctxFor = (role: Role, extra: Partial<FelixContext> = {}): FelixContext => role === "chair" ? chairCtx({}, extra) : { role, documents: [], amendments: [], health: synced, ...extra };
const ask = (q: string, ctx: FelixContext = chairCtx()) => answerQuestion(q, ctx, buildReminders(ctx));
const FELIX_SOURCES = ["components/felix-helper.tsx", ...readdirSync("lib/felix").map(f => `lib/felix/${f}`)];

// ---------------------------------------------------------------- understanding
test("the core example questions reach the right workflow and page", () => {
  const cases: [string, string, string][] = [
    ["I marked the wrong delegate absent", "attendance-fix", "/chair/roll-call"],
    ["Why can't I debate this resolution?", "debate-cant", "/chair/documents"],
    ["How do I give speech points?", "points-speech", "/chair"],
    ["Where do I approve documents?", "approve", "/chair/documents"],
    ["My changes aren't saving", "health-save", "/chair/health"],
    ["A Google Doc won’t open", "resolution-access", "/chair/documents"],
    ["passed amendments history", "amendment-history", "/chair/amendments"],
    ["how do I deduct points", "points-deduct", "/chair/participation"],
    ["when is our group photo", "photo", "/chair/photos"],
  ];
  for (const [q, intent, href] of cases) {
    const reply = ask(q);
    assert.equal(reply.intent, intent, q);
    assert.equal(reply.href, href, q);
  }
  assert.equal(ask("Where do I approve documents?", ctxFor("approval")).href, "/approval");
});

test("participation points go to Participation, not Debate (ordering regression)", () => {
  for (const q of ["participation points", "how do I give participation points?", "where can I see the points I gave"]) assert.equal(ask(q).href, "/chair/participation", q);
  assert.equal(ask("I gave the wrong points").intent, "points-fix");
  assert.equal(ask("I gave the wrong points").href, "/chair/participation");
});

test("typos, synonyms and natural phrasing are understood", () => {
  assert.equal(normalise("Why can’t I DEBATE the Resolutoin?!"), "why cant i debate the resolution");
  assert.ok(conceptsIn("how do i take atendance").has("attendance"));
  assert.ok(conceptsIn("ammendmant waiting").has("amendment"));
  assert.ok(conceptsIn("the wi-fi dropped").has("offline"));
  assert.ok(!conceptsIn("speech points").has("print"), "a real word never fuzzy-matches another term");
  assert.ok(!conceptsIn("how do I record votes").has("history"), "recording a vote is not history");
  assert.equal(ask("how do i take atendance").intent, "attendance-how");
  assert.equal(ask("whos speaking, how do speeches work").intent, "speech-general");
  assert.equal(ask("the internet is down").intent, "health-offline");
  const routes: [Role, string, string][] = [
    ["chair", "how do I mark someone present and voting", "attendance-how"],
    ["chair", "delegate left the room", "attendance-how"],
    ["chair", "i lost internet mid session", "health-offline"],
    ["chair", "what's pending for me", "next"],
    ["chair", "give the main submitter points", "submitter"],
    ["chair", "undo the last speech score", "points-fix"],
    ["chair", "why can't I start the amendment debate", "amendment-cant"],
    ["chair", "abstain is disabled", "vote-cant"],
    ["chair", "can delegates upload a PDF", "resolution-file"],
    ["chair", "how should delegates share their doc", "resolution-access"],
    ["chair", "what does saved on this device mean", "health-save"],
    ["chair", "what is the difference between contributions and points", "points-general"],
    ["chair", "where are my notifications", "felix-notices"],
    ["chair", "turn off the animation", "felix-motion"],
    ["approval", "what is waiting for me", "next"],
    ["approval", "approval history", "approval-history"],
    ["logistics", "mark as printed", "print"],
    ["logistics", "How do I mark a job printed?", "print"],
    ["admin", "change POI values", "scoring-config"],
    ["admin", "give a chair access", "access"],
    ["admin", "How do I rotate an access code?", "access"],
    ["admin", "Where is resolution status?", "resolution-status"],
  ];
  for (const [role, q, intent] of routes) assert.equal(ask(q, ctxFor(role)).intent, intent, `${role}: ${q}`);
});

test("ambiguous and unknown questions are not guessed", () => {
  const ambiguous = ask("timer photo");
  assert.equal(ambiguous.intent, "ambiguous");
  assert.match(ambiguous.text, /Did you mean/);
  assert.equal(ambiguous.href, undefined);
  for (const q of ["blah blah", "purple elephants", "help me"]) {
    const reply = ask(q);
    assert.equal(reply.intent, "fallback", q);
    assert.equal(reply.href, undefined, q);
    assert.match(reply.text, /rather not guess/);
  }
  assert.equal(matchIntent("", KNOWLEDGE).kind, "none");
});

test("small talk is friendly, deterministic and honest about being rule-based", () => {
  assert.equal(ask("hello").text, ask("hello").text);
  assert.match(ask("tell me a joke").text, /ladder/);
  const who = ask("who are you").text;
  assert.match(who, /Felix/);
  assert.match(who, /Doha College mascot/);
  assert.match(who, /fixed rules, not AI/);
});

// ---------------------------------------------------------------- roles and links
test("answers are role-specific and never link outside the user's own workspace", () => {
  const approval = ask("Why can't I debate this resolution?", ctxFor("approval"));
  assert.match(approval.text, /Chair workspace/);
  assert.equal(approval.href, undefined);
  assert.equal(ask("how many copies do I print", ctxFor("logistics")).href, "/logistics");
  assert.equal(ask("resolution status across committees", ctxFor("admin")).href, "/admin/resolution-status");
  assert.equal(ask("how do I rotate an access code", ctxFor("chair")).href, undefined);
  assert.equal(safeLink("chair", "/admin/access-codes"), undefined);
  assert.equal(safeLink("admin", "/admin/made-up"), undefined);
  assert.equal(safeLink("admin", "/admin/awards"), undefined, "retired Award discussion is never linked");
  assert.equal(safeLink("chair", "/chair/awards"), undefined);
  assert.equal(safeLink("admin", "https://example.com"), undefined);
  assert.equal(safeLink("approval", "/approval/history"), "/approval/history");
});

test("every href Felix can return is a real navigation destination of that role", () => {
  const data = createSeed();
  const contexts: FelixContext[] = [
    ...ROLES.map(role => ctxFor(role)),
    ...ROLES.map(role => ({ ...felixContext(data, role, "ga1"), health: { ...synced!, conflicts: 1 } })),
    chairCtx({ sessionName: undefined, sessionId: undefined, hasSessions: false, photos: [{ slotId: "p", revision: 1, stage: "due", school: "Doha College", location: "Courtyard", minutesUntil: 0, delegates: 2 }] }, { documents: [doc("a", "Draft"), doc("b", "Printed")], amendments: [amendment("x", "Submitted")] }),
  ];
  for (const role of ROLES) {
    const hrefs = destinationHrefs(role);
    assert.deepEqual(hrefs, destinationSlugs(role).map(slug => slug ? `/${role}/${slug}` : `/${role}`));
    for (const entry of KNOWLEDGE) {
      const answer = entry.answers[role];
      if (!answer) continue;
      for (const ctx of contexts.filter(c => c.role === role)) {
        const a: Answer = typeof answer === "function" ? answer(ctx) : answer;
        if (a.href) assert.ok(hrefs.includes(a.href), `${entry.id}/${role}: ${a.href} is not a ${role} destination`);
      }
    }
    for (const ctx of contexts.filter(c => c.role === role)) {
      for (const reminder of buildReminders(ctx)) assert.ok(hrefs.includes(reminder.href), `reminder ${reminder.key}: ${reminder.href}`);
      for (const entry of KNOWLEDGE) for (const example of entry.examples) {
        const reply = answerQuestion(example, ctx, buildReminders(ctx));
        if (reply.href) assert.ok(hrefs.includes(reply.href), `${role}: “${example}” → ${reply.href}`);
      }
    }
  }
  // The app's route list (generateStaticParams) contains every destination Felix can use.
  const page = readFileSync("app/[[...route]]/page.tsx", "utf8");
  for (const role of ROLES) for (const href of destinationHrefs(role)) assert.ok(page.includes(`"${href.slice(1)}"`), `${href} is a real page`);
});

test("knowledge entries are well formed and reachable from their own examples", () => {
  const ids = KNOWLEDGE.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of KNOWLEDGE) {
    assert.ok(e.all.length && e.examples.length && Object.keys(e.answers).length, e.id);
    for (const example of e.examples) {
      const role = (Object.keys(e.answers) as Role[])[0];
      assert.equal(ask(example, ctxFor(role)).intent, e.id, `${e.id}: “${example}”`);
    }
  }
  for (const role of ROLES) assert.ok(topicsFor(role).length > 0, role);
});

test("retired and unimplemented features are not described", () => {
  const knowledge = readFileSync("lib/felix/knowledge.ts", "utf8");
  for (const retired of [/Award discussion/i, /Resources & Drive/i, /Drive mirror/i, /projector/i, /server timer/i, /Debated Amendment/i, /Clear majority/i]) {
    assert.doesNotMatch(knowledge, retired, String(retired));
  }
  // The print answer totals the stored copies and states the approval-time rule (lib/print.ts, PR #43).
  const print = ask("how many copies", ctxFor("logistics", { documents: [doc("a", "Approved", "A", { copies: 24 }), doc("b", "Approved", "B", { copies: 30 })] }));
  assert.match(print.text, /54 copies in total/);
  assert.match(print.text, /one per committee delegate plus 3 spares, counted when the resolution is approved/);
  assert.match(print.text, /number of copies shown on the job/);
  // New submissions are Google Docs only, shared with Anyone with the link → Editor.
  const share = ask("how should delegates share their doc").text;
  assert.match(share, /Anyone with the link → Editor/);
  assert.match(ask("can delegates upload a PDF").text, /Google Docs links only/);
});

// ---------------------------------------------------------------- context and reminders
test("Chair guidance uses the current session, roll call and debate state", () => {
  const none = chairCtx({ sessionId: undefined, sessionName: undefined });
  assert.equal(buildReminders(none)[0].key, "chair:no-session:ga1");
  assert.equal(buildReminders(chairCtx({ sessionId: undefined, sessionName: undefined, hasSessions: false }))[0].key, "chair:no-sessions:ga1");
  const notCalled = chairCtx({ marked: 0, present: 0 });
  assert.match(buildReminders(notCalled)[0].text, /Roll call hasn’t started for Committee Session 1/);
  assert.match(ask("how do I take roll call", chairCtx({ marked: 12, present: 10 })).text, /12 of 20 delegations marked, 10 present/);
  const delegates = [{ id: "d1", committeeId: "ga1", country: "France" }];
  const debating = chairCtx({ inDebate: "r1 — France", speaking: true, queued: 3 }, { delegates, documents: [doc("r1", "In Debate", "Water security"), doc("r2", "Approved", "Clean air")] });
  assert.match(situation(debating), /a speaker has the floor; 3 queued to speak; r1 — France is in debate/);
  const why = ask("why can't I debate this resolution", debating);
  assert.match(why.text, /r1 — France is in debate now/);
  assert.match(why.text, /r2 — France is Approved/);
  assert.ok(!/Water security|Clean air/.test(why.text), "resolutions are named by code and Main Submitter, never title");
});

test("reminders are role-scoped, prioritised, short enough for popups and summarise large backlogs", () => {
  const docs = [doc("a", "Submitted"), doc("b", "Review"), doc("c", "Approved"), doc("d", "Printed"), doc("e", "Draft")];
  const amendments = [amendment("x", "Submitted")];
  const approval = buildReminders(ctxFor("approval", { documents: docs, amendments }));
  assert.deepEqual(approval.map(r => r.kind), ["approval:submitted", "approval:review", "approval:approved"]);
  const logistics = buildReminders(ctxFor("logistics", { documents: docs, amendments }));
  assert.deepEqual(logistics.map(r => r.priority), ["action"]);
  assert.match(logistics[0].text, /c — Main submitter unavailable/, "this context holds no delegates, so the code reads honestly");
  assert.ok(!/Resolution c/.test(logistics[0].text), "the title is not the label");
  const admin = buildReminders(ctxFor("admin", { documents: docs, amendments }));
  assert.ok(admin.every(r => r.href === "/admin/resolution-status" && r.priority === "info"));
  const chair = buildReminders(chairCtx({}, { documents: docs, amendments }));
  assert.deepEqual(chair.map(r => r.priority), [...chair.map(r => r.priority)].sort((a, b) => ["urgent", "action", "info"].indexOf(a) - ["urgent", "action", "info"].indexOf(b)));
  assert.ok(chair.some(r => r.kind === "chair:amend-submitted") && chair.every(r => r.href.startsWith("/chair")));
  for (const r of [...approval, ...logistics, ...admin, ...chair]) assert.ok(r.short.split(/\s+/).length <= SHORT_WORDS, `“${r.short}” is too long for a popup`);

  const backlog = Array.from({ length: 60 }, (_, i) => doc(`r${String(i).padStart(2, "0")}`, "Approved"));
  const queue = buildReminders(ctxFor("logistics", { documents: backlog }));
  assert.equal(queue.length, 1, "one reminder for the whole backlog");
  assert.match(queue[0].text, /^60 approved resolutions are waiting/);
  assert.match(queue[0].text, /and 57 more/);
  assert.ok(queue[0].text.length < 400);
  const many = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, kind: `k${i}`, priority: i < 7 ? "action" as const : "info" as const, text: `item ${i}`, short: "x", href: "/chair", linkLabel: "x" }));
  const message = formatReminders("chair", many);
  assert.match(message, /^Needs action: 1\. item 0/);
  assert.match(message, /\+7 more/);
  assert.ok(!/item 5/.test(message));
});

test("reminders are built from representative seed data: approvals, print queue, submissions and photos", () => {
  let data = createSeed();
  const meta = () => ({ id: crypto.randomUUID(), createdAt: "2026-11-05T06:00:00.000Z", actorId: "x" });
  // Doha College (school0) has delegates in GA1; a photo slot ten minutes away is a Chair reminder.
  data = applyCommand(data, { type: "photoSlot", action: "create", schoolId: "school0", startsAt: "2026-11-05T10:30:00.000Z", endsAt: null, location: "Main Courtyard", note: "" }, "admin", meta());
  const ga1 = buildReminders(felixContext(data, "chair", "ga1", Date.parse("2026-11-05T10:22:00Z")));
  const photo = ga1.find(r => r.kind.startsWith("photo:"))!;
  assert.equal(photo.priority, "action");
  assert.match(photo.text, /Doha College group photo in 8 minutes at Main Courtyard \(4 delegates from this committee\)/);
  assert.equal(photo.href, "/chair/photos");
  const due = buildReminders(felixContext(data, "chair", "ga1", Date.parse("2026-11-05T10:31:00Z"))).find(r => r.kind.startsWith("photo:"))!;
  assert.equal(due.priority, "urgent");
  assert.notEqual(due.key, photo.key, "warning and due are separate situations");
  assert.equal(due.kind, photo.kind, "of the same kind, so an unread warning is replaced");
  assert.ok(!buildReminders(felixContext(data, "chair", "sc", Date.parse("2026-11-05T10:22:00Z"))).some(r => r.kind.startsWith("photo:")), "no delegates from the school, no reminder");
  // Seed documents: SC/01 Submitted and GA1/02 Review wait for Approval; ECOSOC/01 Approved waits to print.
  const approval = buildReminders(felixContext(data, "approval"));
  assert.deepEqual(approval.filter(r => r.priority === "action").map(r => r.kind), ["approval:submitted", "approval:review"]);
  const print = buildReminders(felixContext(data, "logistics"));
  assert.equal(print.length, 1);
  assert.match(print[0].text, /1 approved resolution is waiting in the print queue \(30 copies in total\)/);
  const ctx = felixContext(data, "chair", "ga1");
  assert.ok(ctx.documents.every(d => d.committeeId === "ga1"));
  assert.ok(ctx.amendments.every(a => a.committeeId === "ga1"));
  assert.equal(ctx.chair?.delegates, data.delegates.filter(d => d.committeeId === "ga1").length);
  assert.equal(ctx.chair?.sessionName, undefined, "the seed has no current session until a Chair chooses one");
  assert.equal(buildReminders(ctx).find(r => r.priority !== "info")?.kind, "chair:no-session");
  const admin = felixContext(data, "admin");
  assert.equal(admin.documents.length, data.documents.length);
  assert.equal(admin.chair, undefined);
});

test("delegate submissions, access problems and changes requested become Chair reminders", () => {
  const data = createSeed();
  data.documents.push(doc("sub1", "Draft", "Ocean plastics"), doc("sub2", "Draft", "Clean water"), doc("back", "Draft", "Food security", { comments: [{ id: "c1", text: "Fix clause 2", authorId: "approval-demo", createdAt: "2026-11-05T08:00:00Z" }] }));
  data.resolutionLinks = [
    { documentId: "sub1", workingDocId: "a".repeat(30), approvalCopyDocId: null, access: "unchecked", submittedAt: "2026-11-05T08:00:00Z", revision: 1 },
    { documentId: "sub2", workingDocId: "b".repeat(30), approvalCopyDocId: null, access: "problem", submittedAt: "2026-11-05T08:00:00Z", revision: 1 },
    { documentId: "back", workingDocId: "c".repeat(30), approvalCopyDocId: null, access: "ok", submittedAt: "2026-11-05T07:00:00Z", revision: 1 },
  ];
  const reminders = buildReminders(felixContext(data, "chair", "ga1"));
  const kinds = reminders.map(r => r.kind);
  for (const kind of ["chair:submissions", "chair:access", "chair:changes"]) assert.ok(kinds.includes(kind), kind);
  assert.match(reminders.find(r => r.kind === "chair:access")!.text, /Anyone with the link → Editor/);
  const changes = reminders.find(r => r.kind === "chair:changes")!.text;
  assert.match(changes, new RegExp(`back — ${data.delegates.find(d => d.id === "d1")!.country}.*Resubmit after editing`));
  assert.ok(!/Food security/.test(changes), "named by code and Main Submitter, not title");
  assert.ok(!reminders.find(r => r.kind === "chair:submissions")!.text.includes("back —"), "a sent-back draft is not a new submission");
  assert.ok(!reminders.some(r => r.kind === "chair:draft" && /sub1|sub2|back/.test(r.text)));
});

test("reminders are deduplicated with stable keys", () => {
  const docs = [doc("b", "Approved"), doc("a", "Approved")];
  const first = buildReminders(ctxFor("logistics", { documents: docs }));
  const again = buildReminders(ctxFor("logistics", { documents: [...docs].reverse() }));
  assert.deepEqual(first.map(r => r.key), again.map(r => r.key), "order of loading does not change identity");
  const grown = buildReminders(ctxFor("logistics", { documents: [...docs, doc("c", "Approved")] }));
  assert.notEqual(grown[0].key, first[0].key, "a new item is a new situation");
  assert.equal(grown[0].kind, first[0].kind);
  const keys = buildReminders(chairCtx({ marked: 0 }, { documents: docs, health: { ...synced!, state: "conflict", conflicts: 1 } })).map(r => r.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------- troubleshooting
const health = (h: Partial<Health>): FelixContext["health"] => ({ ...synced!, ...h });
test("sync guidance distinguishes offline, slow, pending, failed writes and conflicts — and never acts", () => {
  const offline = ask("I'm offline", chairCtx({}, { health: health({ state: "waiting", pending: 3 }) })).text;
  assert.match(offline, /waiting for a connection with 3 changes saved on this device/);
  const slow = ask("everything is slow", chairCtx({}, { health: health({ latency: 4500 }) })).text;
  assert.match(slow, /connection is slow/);
  const pending = ask("my changes aren't saving", chairCtx({}, { health: health({ state: "syncing", pending: 2 }) })).text;
  assert.match(pending, /2 changes are being sent/);
  assert.match(pending, /“Saved on this device” means it is stored safely on this device but not yet confirmed/);
  assert.match(pending, /“All changes synced” means the server has it/);
  const failed = ask("something failed, the health page is red", chairCtx({}, { health: health({ state: "error" }) })).text;
  assert.match(failed, /can’t save changes/);
  assert.match(failed, /RED stop recording/);
  const conflict = ask("another chair updated this item", chairCtx({}, { health: health({ state: "conflict", conflicts: 2 }) })).text;
  assert.match(conflict, /2 changes need review/);
  assert.match(conflict, /Export device recovery file/);
  assert.match(conflict, /Keep conference value · dismiss exported action/);
  assert.match(conflict, /never retries, discards or edits/);
  for (const text of [offline, slow, pending, failed, conflict]) {
    assert.doesNotMatch(text, /clear (your )?(browser|cache|storage|data)(?! data, sign)/i, "never recommends clearing storage");
    assert.doesNotMatch(text, /\b(refresh|reload) (the page|again)\b/i, "never recommends refreshing during unsynced changes");
  }
  const urgent = buildReminders(chairCtx({}, { health: health({ state: "conflict", conflicts: 1 }) }));
  assert.equal(urgent[0].priority, "urgent");
  assert.equal(urgent[0].href, "/chair/health");
  assert.ok(!buildReminders(chairCtx({}, { health: health({ mode: "local", pending: 2 }) })).some(r => r.kind === "sync:pending"), "the local demo has nothing to sync");
});

test("offline guidance is role-aware and matches what the service worker prepares", () => {
  const shell = readFileSync("public/sw.js", "utf8");
  const chairOffline = ask("I'm offline", ctxFor("chair")).text;
  assert.match(chairOffline, /Prepared Chair pages .* can reload offline/);
  for (const path of ["/chair", "/chair/roll-call", "/chair/documents", "/chair/amendments", "/chair/participation", "/chair/voting", "/chair/photos", "/chair/health"]) assert.ok(shell.includes(`'${path}'`), path);
  for (const role of ["approval", "logistics", "admin"] as const) {
    const text = ask("the wifi is down", ctxFor(role)).text;
    assert.match(text, /Only the .* reliably reload offline for your role/, role);
    assert.match(text, /not prepared for offline reload/, role);
    assert.doesNotMatch(text, /Prepared Chair pages/i, role);
  }
  for (const path of ["/approval/history", "/approval/health", "/logistics/completed", "/logistics/health", "/admin/resolution-status", "/admin/health"]) assert.ok(shell.includes(`'${path}'`), path);
  assert.ok(!shell.includes("'/approval'") && !shell.includes("'/logistics'"));
  assert.match(ask("the wifi is down", ctxFor("approval")).text, /History and System health/);
  assert.match(ask("the wifi is down", ctxFor("logistics")).text, /Completed and System health/);
  assert.match(ask("the wifi is down", ctxFor("admin")).text, /Resolution status and System health/);
});

test("error guidance never claims nothing was saved", () => {
  for (const role of ROLES) for (const q of ["something failed, the health page is red", "i'm offline", "everything is slow", "my changes aren't saving"]) {
    assert.doesNotMatch(ask(q, ctxFor(role)).text, /nothing was saved/i, `${role}: ${q}`);
  }
  const error = ask("something failed", ctxFor("chair")).text;
  assert.match(error, /does not prove the action failed/);
  assert.match(error, /pending or needing review/);
  assert.match(error, /only if the change is genuinely missing/);
});

test("durable queued actions are distinguished from cloud-dependent access-code actions", () => {
  for (const q of ["my changes aren't saving", "the wifi is down", "everything is slow"]) {
    const admin = ask(q, ctxFor("admin")).text;
    assert.match(admin, /Access-code actions \(create, rotate, revoke\).*not queued.*live connection/, q);
    for (const role of ["chair", "approval", "logistics"] as const) assert.doesNotMatch(ask(q, ctxFor(role)).text, /Access-code/, `${role}: ${q}`);
  }
  assert.match(readFileSync("lib/access-codes.ts", "utf8"), /rpc\('rotate_access_code'/);
  assert.match(ask("my access code stopped working", ctxFor("chair")).text, /ask the Executive/);
});

test("an empty conference produces calm, accurate answers", () => {
  const empty = chairCtx({ delegates: 0, marked: 0, present: 0 });
  assert.deepEqual(buildReminders(empty), []);
  const next = ask("what should I do next?", empty);
  assert.match(next.text, /no delegates in this committee yet/);
  assert.match(next.text, /Nothing needs your attention/);
  assert.match(ask("what's next", ctxFor("admin")).text, /No resolutions have been created yet/);
  assert.match(ask("whats next", ctxFor("logistics")).text, /0 approved resolutions waiting/);
});

// ---------------------------------------------------------------- local, honest, renamed
test("Felix stays local, read-only and free of external services and fake waiting", () => {
  const source = FELIX_SOURCES.map(f => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\/|\bact\(|apply_conference_mutation|supabase/);
  assert.doesNotMatch(source, /new Notification|Notification\.requestPermission|serviceWorker|PushManager/, "never uses browser notifications");
  assert.doesNotMatch(source, /Typewriter|setThinking|setInterval/, "no simulated typing or thinking delay");
  const helper = readFileSync("components/felix-helper.tsx", "utf8");
  assert.doesNotMatch(helper, /setTimeout/, "replies are not delayed");
  assert.match(helper, /Still stuck\? Message the Executive\./);
});

test("no wording from the previous mascot or conference remains in Felix code, UI text or tests", () => {
  const files = [...FELIX_SOURCES, "components/workspace.tsx", ...readdirSync("tests").filter(f => f.startsWith("felix")).map(f => `tests/${f}`)];
  // Built from parts so this test file does not match itself.
  const banned = new RegExp(["\\bLe" + "o\\b", "PHES" + "MUN", "\\bli" + "on\\b", String.fromCodePoint(0x1f981), "\\bJ" + "P\\b"].join("|"), "i");
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), banned, file);
});
