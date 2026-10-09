// Realistic staging rehearsal. Opt-in, guarded, conservative by default (10 staff, 0 delegates, 5 minutes).
// READINESS requires --identities from a multi-committee fixture (scripts/rehearsal-fixture.mts with a Chair pool from
// scripts/rehearsal-identities.mts): one Chair identity/grant per real committee. Legacy single-committee and
// all-roles runs still report metrics but are labelled NOT A READINESS RUN and can never PASS.
// Mandatory conference-week capacity gate (docs/STAGING_REHEARSAL.md → C2): 50 staff across the real committees plus
// the delegate public-form burst on ONE resolution link:
//   npm run rehearsal:run -- --app https://<preview>.vercel.app --identities <fixture>/identities.json
//        --fixture <fixture>/fixture.json --staff 50 --delegates 150 --delegate-window 120
//        --submit-token <token> --submit-committee GA1 --submit-fraction 0.10 --minutes 8
// Other options: [--stages 25,50 | --staff N] [--minutes 5] [--realtime topic-aware|current]
//        [--executive-chair-window 2000] [--drain-seconds 120] [--start-window 150]
// Delegates create NO Supabase Auth session: they load /submit/<token> and POST /api/submissions with fixture
// delegate ids. Planned submissions on the one link must stay <= 18 (designed limit 20 / 10 min); the run refuses
// otherwise, before any request. Rate-limit behaviour is a separate test, never part of the capacity run.
// A 100-staff stage is an OPTIONAL stress/headroom test, not a release requirement.
// Every simulated staff device runs the production client's sync loop (scripts/rehearsal/client-model.ts mirrors
// DurableRepository: one flush in flight, triggers dropped while busy, send+read per item then a final read, 60 s
// recovery timer). Realtime is simulated: after each committed write, devices that would receive the
// operational_changes event (topic + committee scope, --realtime) get a debounced notification.
// STAFF stages simulate Chairs/Approval/Admins/Executive with a staff session. DELEGATES are separate:
// they only load the public QR page and POST submissions — no Supabase client, no session, no dashboard.
// Requires: .env.local pointing at the DEVELOPMENT Supabase project (enforced by remote-context.mts),
// .test-sessions/development.json (npm script prepare-session), and a fixture + identities from
// scripts/rehearsal-fixture.mts applied to the development project. Never targets production; no override exists.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { checkAppUrl, checkHealthEnvironment, checkUsers } from "./rehearsal/guard";
import { TOPIC_OF, buildScenario, recipients, type Action, type RealtimeModel, type SimUser, type Topic } from "./rehearsal/scenario";
import { SimClient, sumStats, type Clock, type RefreshSource } from "./rehearsal/client-model";
import { evaluate, report, type Sample } from "./rehearsal/metrics";
import { countSnapshotRpcs, type RpcCounter } from "./rehearsal/rpc-counter";
import { isMultiCommittee, loadIdentities, resolveChairMapping, type ChairIdentity, type Identity, type IdentityFile, type StaffRoleKey } from "./rehearsal/identities";
import { DOCUMENTED_SUBMIT_FRACTION, MAX_SINGLE_LINK_SUBMISSIONS, assessReadiness, assignChair, checkSingleLinkSubmissions, plannedSubmissions, readinessVerdict, type ChairAssignment, type ChairTraffic, type RunMode } from "./rehearsal/readiness";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const app = value("--app");
const target = checkAppUrl(app);
if (!target.ok) { console.error(`Refused: ${target.reason}`); process.exit(2); }
const base = app!.replace(/\/$/, "");
// Protected Preview deployments: Vercel "Protection Bypass for Automation" secret, from the environment only.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const appFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) } });
const stages = (value("--stages") ?? value("--staff") ?? "10").split(",").map(Number);
for (const n of stages) { const g = checkUsers(n); if (!g.ok) { console.error(g.reason); process.exit(2); } }
const delegateCount = Number(value("--delegates") ?? 0);
if (delegateCount && !checkUsers(delegateCount).ok) { console.error(checkUsers(delegateCount).reason); process.exit(2); }
const minutes = Number(value("--minutes") ?? 5);
if (value("--client-reads")) { console.error("--client-reads was removed: every device now runs the production client model (scripts/rehearsal/client-model.ts)."); process.exit(2); }
const realtimeModel = (value("--realtime") ?? "topic-aware") as RealtimeModel;
if (!["topic-aware", "current"].includes(realtimeModel)) { console.error("--realtime must be topic-aware or current"); process.exit(2); }
const drainMs = Number(value("--drain-seconds") ?? 120) * 1000;
// Core PR #10: an Executive/Admin-only device coalesces 'chair' events into a fixed window (0 = plain 350 ms debounce).
const executiveChairWindowMs = realtimeModel === "topic-aware" ? Number(value("--executive-chair-window") ?? 2000) : 0;
const fixtureFile = value("--fixture") ?? ".test-sessions/load-fixtures.json";
const submitToken = value("--submit-token");
const identitiesFile = value("--identities");
// ---- Local preflight: plan every stage from local files only, BEFORE any network request -----------------------------
const fixture = JSON.parse(await readFile(fixtureFile, "utf8").catch(() => { console.error(`Missing ${fixtureFile}: run scripts/rehearsal-fixture.mts (or prepare-load.mts) and apply its SQL to the development project.`); process.exit(2); })) as { conference: string; committees: { id: string; session: string; code: string }[]; delegates: { id: string; committee: string; session?: string }[] };
const rawIdentities = identitiesFile ? JSON.parse(await readFile(identitiesFile, "utf8").catch(() => { console.error(`Missing ${identitiesFile}.`); process.exit(2); })) as IdentityFile : null;
// Legacy single-Chair files simulate committees as floor sessions; every other mode uses the fixture's real committees.
const simulatedCommittees = rawIdentities && !isMultiCommittee(rawIdentities) ? rawIdentities.chair.sessions.length : fixture.committees.length;
const submitFraction = submitToken ? Number(value("--submit-fraction") ?? DOCUMENTED_SUBMIT_FRACTION) : 0;
const scenarioFor = (staff: number) => buildScenario({ staff, delegates: delegateCount, minutes, committees: simulatedCommittees, startWindowSeconds: Number(value("--start-window") ?? 150), delegateWindowSeconds: Number(value("--delegate-window") ?? 120), submitFraction });
// One resolution link: stay below its designed 20 accepted submissions / 10 min. Never plan an intentional 429.
for (const n of stages) {
  const plan = checkSingleLinkSubmissions(scenarioFor(n), Boolean(submitToken));
  if (!plan.ok) { console.error(`Refused: ${plan.reason}`); process.exit(2); }
  if (submitToken) console.log(`Stage ${n} staff: ${plan.pageLoads} public page loads, ${plan.planned} resolution submissions planned on one link (max ${MAX_SINGLE_LINK_SUBMISSIONS}).`);
}
const health = await appFetch(`${base}/api/health`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
const env = checkHealthEnvironment(health);
if (!env.ok) { console.error(`Refused: ${env.reason}`); process.exit(2); }
// Loaded only after the guards: these enforce the development Supabase project and an authorized test session.
const context = await import("./remote-context.mts").catch((e: Error) => {
  console.error(`Rehearsal setup missing: ${e.message}\nNeeds .env.local for the DEVELOPMENT Supabase project and an authorized session (see docs/STAGING_REHEARSAL.md → Preparation).`);
  process.exit(2);
});
const { clientFor, session, ref } = context;
// Role-scoped identities (--identities <file>): pre-authorized sessions, each holding ONLY its role's grant, so every
// simulated device reads the RLS payload a real device of that role would receive.
//  * realistic-multi-committee: one Chair identity per real committee (readiness).
//  * legacy-single-committee: one Chair identity, committees simulated as floors in one committee (historical only).
//  * no --identities: every device shares the all-roles test identity (WORST CASE, historical only).
// No Auth session is created during the run; sessions near expiry are refreshed once before the run starts.
const loaded = identitiesFile ? await loadIdentities(identitiesFile, context.env).catch((e: Error) => { console.error(e.message); process.exit(2); }) : null;
const scoped = loaded?.scoped ?? null;
const mode: RunMode = loaded ? loaded.mode : "worst-case-superuser";
const identities: Partial<Record<StaffRoleKey, Identity>> = loaded?.identities ?? {};
const chairIdentities: ChairIdentity[] = loaded?.chairs ?? [];
const superuser: Identity = { userId: session.user.id, token: session.access_token };
const { SupabaseTransport } = await import("../lib/supabase/repository");
// Production (lib/repository-instance.ts) passes the device's granted roles to the transport; core uses them for Realtime
// topic filtering and to route an Admin-only identity to executive_state_snapshot. Older core ignores the extra
// arguments, so the constructor is called through a widened type to keep this file compiling against either.
type TransportInstance = InstanceType<typeof SupabaseTransport>;
const Transport = SupabaseTransport as unknown as new (...args: unknown[]) => TransportInstance;
const grantedRoles: Record<StaffRoleKey, string[]> = { chair: ["chair"], approval: ["approval"], admins: ["logistics"], executive: ["admin"] };
const { ConflictError, fingerprint } = await import("../lib/sync/repository");
type Data = Awaited<ReturnType<InstanceType<typeof SupabaseTransport>["read"]>>;
type Command = import("../lib/commands").Command;
// Delegates submit to the committee the rehearsal link belongs to; their country choices come from the fixture file
// (what the public page would list), never from a staff read.
// Chair scoping, resolved BEFORE any traffic. Readiness mode fails fast when the mapping is incomplete.
let mapping: number[] | undefined;
if (scoped && isMultiCommittee(scoped)) {
  try { mapping = resolveChairMapping(scoped, fixture.committees, chairIdentities.map((c) => c.userId)); }
  catch (e) { console.error(`Refused (readiness mode): ${(e as Error).message}`); process.exit(2); }
} else console.warn(`WARNING: ${mode} identities — this run reports metrics only and is NOT A READINESS RUN. Use a multi-committee fixture (docs/STAGING_REHEARSAL.md) for the capacity gate.`);
const legacy = scoped && !isMultiCommittee(scoped) ? { committee: scoped.chair.committee, sessions: scoped.chair.sessions } : undefined;
const chairAssignments = new Map<SimUser, ChairAssignment>();
const chairOf = (user: SimUser) => { let a = chairAssignments.get(user); if (!a) { a = assignChair(user, { mode, committees: fixture.committees, chairs: chairIdentities, mapping, legacy, superuser }); chairAssignments.set(user, a); } return a; };
const identityOf = (user: SimUser): Identity => user.role === "chair" ? chairOf(user).identity : scoped && user.role !== "delegate" ? identities[user.role]! : superuser;
const submitCommittee = fixture.committees.find((c) => c.code === (value("--submit-committee") ?? fixture.committees[0]?.code));
const submitters = fixture.delegates.filter((d) => d.committee === submitCommittee?.id);
if (delegateCount && submitToken && !submitters.length) { console.error("No fixture delegations for --submit-committee."); process.exit(2); }
const samples: Sample[] = [];
const acknowledged = new Set<string>(); // speechScore / poiRecognize mutation ids the server accepted
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const classify = (e: unknown): Sample["outcome"] => {
  if (e instanceof ConflictError) return "conflict";
  const text = JSON.stringify(e ?? "") + String((e as Error)?.message ?? "");
  return /429|rate.?limit|too many/i.test(text) ? "rate_limited" : "error";
};
/** Records one timed request and rethrows its error (the client model needs to see failures). */
async function measure(action: string, op: () => Promise<unknown>, role?: string, source?: RefreshSource, rpcs?: () => number) {
  const start = performance.now();
  try { await op(); samples.push({ action, role, source, ms: performance.now() - start, outcome: "ok", ...(rpcs ? { rpcs: rpcs() } : {}) }); }
  catch (e) { samples.push({ action, role, source, ms: performance.now() - start, outcome: classify(e), ...(rpcs ? { rpcs: rpcs() } : {}), detail: e instanceof Error ? e.message.slice(0, 160) : JSON.stringify(e ?? null).slice(0, 160) }); throw e; }
}
async function timed(action: string, op: () => Promise<unknown>, role?: string) {
  try { await measure(action, op, role); return true; } catch { return false; }
}
/** A delegate: public page load and (sometimes) a submission. No Supabase client, no session. */
async function simulateDelegate(user: SimUser, t0: number) {
  for (const step of user.steps) {
    await sleep(t0 + step.at - Date.now());
    if (step.action === "submitPage")
      await timed("submitPage", async () => { const r = await appFetch(submitToken ? `${base}/submit/${submitToken}` : `${base}/submit/not-a-real-link-000000000000`); await r.text(); if (r.status >= 500) throw Error(`HTTP ${r.status}`); });
    else if (step.action === "submit" && submitToken)
      await timed("submit", async () => {
        const form = new FormData();
        form.set("token", submitToken); form.set("submissionId", crypto.randomUUID()); form.set("submitterId", submitters[user.id % submitters.length].id);
        form.set("title", `Rehearsal ${user.id}`); form.set("googleDoc", `https://docs.google.com/document/d/rehearsal${String(user.id).padStart(4, "0")}${crypto.randomUUID().replaceAll("-", "")}/edit`);
        const r = await appFetch(`${base}/api/submissions`, { method: "POST", body: form });
        if (r.status === 429) throw Error("429 rate limited");
        if (r.status >= 400) throw Error(`HTTP ${r.status} ${await r.text()}`);
      });
  }
}
type Mutation = import("../lib/sync/store").Mutation;
interface Item { action: Action; mutation: Mutation; topic: Topic | null | undefined; retry?: boolean; sends: number }
interface Device { user: SimUser; transport: TransportInstance; data: Data | null; client: SimClient<Item> }
const REALTIME_DELIVERY_MS = 100; // server commit → Realtime INSERT event at the device (before the 350 ms debounce)
const clock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), random: Math.random };
let devices = new Map<SimUser, Device>();
let stageSnapshotRpcs: Record<string, number> = {}; // snapshot RPCs actually sent this stage, by function name
function makeDevice(user: SimUser, everyone: SimUser[]): Device {
  const id = identityOf(user);
  // Role-scoped identities hold exactly one grant, so the device's roles are known; the all-roles worst case passes none.
  const roles = scoped && user.role !== "delegate" ? grantedRoles[user.role] : [];
  // Count the snapshot RPCs this device really sends: one per refresh on bundled core, two only if the fallback runs.
  // A device has at most one refresh in flight (client-model.ts), so the delta around read() is that refresh's count.
  const rpcCounter: RpcCounter = { snapshot: 0, byName: stageSnapshotRpcs };
  const device = { user, transport: new Transport(countSnapshotRpcs(clientFor(id.token), rpcCounter), fixture.conference, id.userId, [], false, roles), data: null } as unknown as Device;
  device.client = new SimClient<Item>({
    isConflict: (e) => e instanceof ConflictError,
    read: (source) => { const before = rpcCounter.snapshot; return measure("refresh", async () => { device.data = await device.transport.read(); }, user.role, source, () => rpcCounter.snapshot - before); },
    send: async (item) => {
      // A re-send of the SAME mutation id after a failed send/read is what production does on the next flush.
      await measure(item.sends++ ? `${item.action} (resend)` : item.action, () => device.transport.send(item.mutation), user.role);
      if (item.retry && item.sends === 1) await measure(`${item.action} (retry)`, () => device.transport.send(item.mutation), user.role); // lost response
      if (item.action === "speechScore" || item.action === "poiRecognize") acknowledged.add(item.mutation.id);
      if (!item.topic) return; // e.g. timer: the server emits no operational change
      const topic = item.topic;
      for (const r of recipients(realtimeModel, everyone, { topic, committee: user.committee })) setTimeout(() => devices.get(r)?.client.notify(topic), REALTIME_DELIVERY_MS);
    },
  }, clock, { executiveChairWindowMs: user.role === "executive" && scoped ? executiveChairWindowMs : 0 });
  return device;
}
async function simulate(user: SimUser, t0: number) {
  if (user.role === "delegate") return simulateDelegate(user, t0);
  // Chairs: committee k's real committee row, session and Chair identity (realistic mode); legacy floor/worst-case
  // modes keep their historical scoping. Support roles only use the committee index for Realtime attribution.
  const committee = user.role === "chair" ? chairOf(user).committee : legacy ? { id: legacy.committee, session: legacy.sessions[user.committee % legacy.sessions.length], code: `floor-${user.committee}` } : fixture.committees[user.committee % fixture.committees.length];
  const actorId = identityOf(user).userId;
  const device = devices.get(user)!;
  let cursor = 0;
  const role = user.role === "approval" ? "approval" : user.role === "admins" ? "logistics" : user.role === "executive" ? "admin" : "chair";
  /** execute(): store the intent in the device outbox, then attempt a flush (dropped if one is running). */
  const send = (action: Action, command: Command, retry?: boolean, as = role) => {
    if (!device.data) return; // the screen has not loaded yet; a person cannot act
    const mutation: Mutation = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId, role: as as never, command, expected: fingerprint(device.data, command), state: "pending" };
    device.client.execute({ action, mutation, topic: TOPIC_OF[action], retry, sends: 0 });
  };
  const d = () => device.data;
  const sid = committee.session;
  const present = () => (d()?.attendance ?? []).filter((a) => a.sessionId === sid && a.status !== "Absent").map((a) => a.delegateId);
  const active = () => d()?.speeches?.find((s) => s.sessionId === sid && s.state !== "finished");
  const mine = () => d()?.delegates.filter((x) => x.committeeId === committee.id) ?? [];
  for (const step of user.steps) {
    await sleep(t0 + step.at - Date.now());
    const data = d();
    const here = present();
    const anyPresent = here[cursor++ % Math.max(1, here.length)];
    switch (step.action) {
      case "open": device.client.open(); break;
      // Production refreshes only through flush(): there is no fetch for merely looking at a screen. A support
      // role's "read" is returning to the Conference OS tab (window focus); the 60 s recovery read is the client's
      // own timer, so the scenario's periodic steps are not replayed here.
      case "read": if (!step.periodic) device.client.focus(); break;
      case "refocus": device.client.focus(); break;
      case "health": await timed("health", async () => { const r = await appFetch(`${base}/api/health`); if (r.status >= 500) throw Error(`HTTP ${r.status}`); }); break;
      // Legacy floors share ONE committee row, so only floor 0 may set its current session there.
      case "currentSession": if (legacy && user.committee > 0) break; send("currentSession", { type: "currentSession", committeeId: committee.id, sessionId: sid }, step.retry); break;
      case "attendance": { const delegate = mine()[cursor % Math.max(1, mine().length)]; if (delegate) send("attendance", { type: "attendance", delegateId: delegate.id, sessionId: sid, status: cursor % 3 ? "Present" : "Present & Voting" }, step.retry); break; }
      case "queueAdd": {
        const lane = (["open", "for", "against"] as const)[cursor % 3];
        const queued = new Set(data?.queue.filter((q) => q.sessionId === sid && (q.lane ?? "open") === lane).map((q) => q.delegateId));
        const delegate = here.find((id) => !queued.has(id));
        if (delegate) send("queueAdd", { type: "queueAdd", sessionId: sid, delegateId: delegate, lane }, step.retry);
        break;
      }
      case "queueOrder": {
        const ids = (data?.queue ?? []).filter((q) => q.sessionId === sid && (q.lane ?? "open") === "open").sort((a, b) => a.position - b.position).map((q) => q.id);
        if (ids.length > 1) send("queueOrder", { type: "queueOrder", sessionId: sid, lane: "open", ids: [...ids.slice(1), ids[0]] }, step.retry);
        break;
      }
      case "speechStart": {
        if (active() || !anyPresent) break;
        const entry = (data?.queue ?? []).filter((q) => q.sessionId === sid && here.includes(q.delegateId)).sort((a, b) => a.position - b.position)[0];
        const classification = entry?.lane === "for" ? "For" : entry?.lane === "against" ? "Against" : "Other";
        send("speechStart", { type: "speechStart", sessionId: sid, delegateId: entry?.delegateId ?? anyPresent, resolutionId: null, classification, ...(entry ? { entryId: entry.id } : {}) }, step.retry);
        break;
      }
      case "poiAllowance": { const s = active(); if (s) send("poiAllowance", { type: "poiAllowance", sessionId: sid, speechId: s.id, limit: Math.max(2, s.poiCount + 1) }, step.retry); break; }
      case "poiAdd": { const s = active(); const asker = here.find((id) => id !== s?.delegateId); if (s && asker) send("poiAdd", { type: "poiAdd", sessionId: sid, speechId: s.id, delegateId: asker }, step.retry); break; }
      case "poiRecognize": { const s = active(); const poi = (data?.poiQueue ?? []).filter((p) => p.speechId === s?.id).sort((a, b) => a.position - b.position)[0]; if (s?.state === "pois" && poi) send("poiRecognize", { type: "poiRecognize", sessionId: sid, speechId: s.id, entryId: poi.id, points: 1 + (cursor % 2) }, step.retry); break; }
      case "speechScore": { const s = active(); if (s && !data?.events.some((e) => e.speechId === s.id && e.categoryId === "speech")) send("speechScore", { type: "speechScore", sessionId: sid, speechId: s.id, points: 1 + (cursor % 3) }, step.retry); break; }
      case "speechFinish": { const s = active(); if (s) send("speechFinish", { type: "speechFinish", sessionId: sid, speechId: s.id }, step.retry); break; }
      case "timer": send("timer", { type: "timer", sessionId: sid, remaining: 90, startedAt: Date.now(), duration: 90 }, step.retry); break;
      case "photoAck": { const slot = data?.photoSlots?.find((s) => s.enabled); if (slot) send("photoAck", { type: "photoAck", committeeId: committee.id, slotId: slot.id, stage: "warning", revision: slot.revision }, step.retry); break; }
      case "sendToApproval": { const doc = data?.documents.find((x) => x.committeeId === committee.id && x.status === "Draft"); if (doc) send("sendToApproval", { type: "document", id: doc.id, status: "Submitted" }, step.retry); break; }
      case "approve": { const doc = data?.documents.find((x) => x.status === "Submitted"); if (doc) send("approve", { type: "document", id: doc.id, status: "Approved" }, step.retry, "approval"); break; }
      case "print": { const doc = data?.documents.find((x) => x.status === "Approved"); if (doc) send("print", { type: "document", id: doc.id, status: "Printed" }, step.retry, "logistics"); break; }
    }
  }
}
const stageReports = [];
const readinessByStage: ReturnType<typeof assessReadiness>[] = [];
for (const users of stages) {
  const scenario = scenarioFor(users);
  const before = samples.length;
  console.log(`Stage: ${users} staff + ${delegateCount} delegates (public form) for ${minutes} min against ${base} (Supabase ${ref}, realtime model ${realtimeModel})…`);
  const staffUsers = scenario.filter((u) => u.role !== "delegate");
  stageSnapshotRpcs = {};
  devices = new Map(staffUsers.map((user) => [user, makeDevice(user, staffUsers)]));
  // Real committee distribution of this stage's Chair devices (committee row + Chair Auth identity actually used).
  const chairTraffic: ChairTraffic[] = staffUsers.filter((u) => u.role === "chair").map((u) => { const a = chairOf(u); return { committeeId: a.committee.id, committeeCode: a.committee.code, identity: a.identity.userId }; });
  const readiness = assessReadiness({ mode, committees: fixture.committees.slice(0, simulatedCommittees), chairTraffic });
  readinessByStage.push(readiness);
  console.log(`  ${readiness.label}: ${readiness.actualCommitteesWithChairTraffic} actual committees, ${readiness.distinctChairIdentities} distinct Chair identities, ${readiness.chairDevices} Chair devices${readiness.reasons.length ? ` — ${readiness.reasons.join("; ")}` : ""}`);
  const t0 = Date.now() + 1000;
  await Promise.all(scenario.map((u) => simulate(u, t0)));
  // Drain: people stop, devices keep their normal sync behaviour until outboxes are empty (bounded).
  const scenarioEnded = Date.now();
  while (Date.now() - scenarioEnded < drainMs && [...devices.values()].some((d) => d.client.pending || d.client.busy)) await sleep(500);
  const pendingAtClose = [...devices.values()].reduce((n, d) => n + d.client.pending, 0);
  await Promise.all([...devices.values()].map((d) => d.client.close()));
  const byRole = Object.fromEntries(["chair", "approval", "admins", "executive"].map((r) => {
    const s = sumStats([...devices.values()].filter((d) => d.user.role === r).map((d) => d.client.stats));
    return [r, { devices: [...devices.values()].filter((d) => d.user.role === r).length, refreshesExecuted: s.refreshesExecuted, triggersAttempted: s.triggersAttempted, triggersDropped: s.triggersDropped, bySource: s.reads, realtimeEvents: s.realtimeEvents, chairWindows: s.chairWindows, chairEventsCoalesced: s.chairEventsCoalesced }];
  }));
  const all = sumStats([...devices.values()].map((d) => d.client.stats));
  stageReports.push({ staff: users, delegates: delegateCount, readiness, drainSeconds: Math.round((Date.now() - scenarioEnded) / 1000), pendingAtClose,
    snapshotRpcsByName: stageSnapshotRpcs,
    clientModel: { realtimeModel, executiveChairWindowMs, triggersAttempted: all.triggersAttempted, triggersDropped: all.triggersDropped, refreshesExecuted: all.refreshesExecuted, attemptedBySource: all.attempted, droppedBySource: all.dropped, refreshesBySource: all.reads, byRole, conflictsDismissed: all.conflicts, sendFailures: all.sendFailures, failedRefreshes: all.failedReads, maxConcurrentRefreshesPerDevice: all.maxConcurrentReads },
    ...report(samples.slice(before)) });
}
// Exactly-once check: every acknowledged scoring mutation produced exactly one participation event.
// Executive (admin) sees every participation event through the full conference snapshot. No roles are passed, so core
// reads conference_state_snapshot (conference_snapshot before PR #11), never executive_snapshot, which omits events.
const finalIdentity = scoped ? identities.executive! : superuser;
const final = await new SupabaseTransport(clientFor(finalIdentity.token), fixture.conference, finalIdentity.userId).read();
let duplicates = 0, lost = 0;
for (const id of acknowledged) {
  const n = final.events.filter((e) => e.id.startsWith(id.slice(0, 24))).length;
  if (n > 1) duplicates++; if (n === 0) lost++;
}
const overall = report(samples);
// Readiness needs EVERY stage to be a realistic multi-committee run; the worst stage decides the label.
const readiness = readinessByStage.find((r) => !r.qualifiesForReadiness) ?? readinessByStage[readinessByStage.length - 1];
const verdict = readinessVerdict(evaluate(overall, duplicates, lost), readiness);
const distinctAuthIdentities = scoped ? new Set([...chairIdentities.filter((_, i) => !mapping || mapping.includes(i)).map((c) => c.userId), ...(["approval", "admins", "executive"] as const).map((r) => identities[r]!.userId)]).size : 1;
const note = mode === "realistic-multi-committee"
  ? "Realistic multi-committee run: each simulated committee is a real committee row with its own session and its own Chair identity/grant; Chair devices of committee k use only committee k's identity, row and session. Approval, Admins and Executive use one role-scoped identity each. No Auth sessions were created during the run. Delegates use only the public form."
  : mode === "legacy-single-committee"
    ? "LEGACY single-committee floors: one Chair identity scoped to ONE committee; simulated committees are extra sessions inside it, so every Chair write serializes on one committees row (overstates contention). Historical comparison only — NOT A READINESS RUN."
    : "WORST CASE: every simulated device shares one identity holding Chair grants for every committee plus Approval, Logistics and Admin, so each read returns the admin-sized snapshot. Historical comparison only — NOT A READINESS RUN.";
const peakStaff = Math.max(...stages);
const capacityGate = peakStaff >= 100 ? "OPTIONAL STRESS / HEADROOM (100 staff) — not a release requirement"
  : peakStaff >= 50 ? "REQUIRED capacity gate (C2: 50 staff across the real committees plus resolution public-form traffic)"
  : "BELOW the required 50-staff gate (warm-up only)";
const publicForm = { delegates: delegateCount, singleLink: Boolean(submitToken), submissionsPlannedPerStage: Object.fromEntries(stages.map((n) => [n, plannedSubmissions(scenarioFor(n))])), maxSingleLinkSubmissions: MAX_SINGLE_LINK_SUBMISSIONS, note: "Resolution public form only; delegates create no Auth session. Amendment form and rate limiting are tested functionally, separately." };
const result = { date: new Date().toISOString(), app: base, appBuild: health.app, supabaseProject: ref, identityMode: mode, readinessLabel: verdict.label, readiness, distinctAuthIdentities, note, capacityGate, publicForm, minutes, stages: stageReports, realtimeModel, clientModel: "production DurableRepository (one flush in flight; see scripts/rehearsal/client-model.ts)", exactlyOnce: { acknowledgedScoring: acknowledged.size, duplicates, lost }, verdict };
await mkdir(".test-sessions", { recursive: true, mode: 0o700 });
const file = `.test-sessions/rehearsal-${result.date.replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify({ ...result, samples }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
console.log(`Full report (with samples): ${file}`);
if (!verdict.pass) process.exitCode = 1;
