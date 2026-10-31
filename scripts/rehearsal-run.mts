// Realistic staging rehearsal. Opt-in, guarded, conservative by default (10 staff, 0 delegates, 5 minutes).
// READINESS requires --identities from a multi-committee fixture (scripts/rehearsal-fixture.mts with a Chair pool from
// scripts/rehearsal-identities.mts): one Chair identity/grant per real committee. Legacy single-committee and
// all-roles runs still report metrics but are labelled NOT A READINESS RUN and can never PASS.
// Current capacity gate: --staff 110 --minutes 30, 19 real committees, separate approved public-form burst.
// The live harness runs ACTUAL DurableRepository + DurableStore on isolated Node in-memory IndexedDB devices.
// Core owns optimistic intent, batching, acknowledgement, passive coalescing, backoff and queue rechecks.
// Realtime DELIVERY is simulated; real channels, browser persistence and venue networking remain separate gates.
// STAFF stages simulate Chairs/Approval/Admins/Executive with a staff session. DELEGATES are separate:
// they only load the public QR page and POST submissions — no Supabase client, no session, no dashboard.
// Requires: .env.local pointing at the DEVELOPMENT Supabase project (enforced by remote-context.mts),
// .test-sessions/development.json (npm script prepare-session), and a fixture + identities from
// scripts/rehearsal-fixture.mts applied to the development project. Never targets production; no override exists.
import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { checkAppUrl, checkFixtureConference, checkHealthEnvironment, checkUsers } from "./rehearsal/guard";
import { TOPIC_OF, buildScenario, parseStaffProfile, summarize, type Action, type RealtimeModel, type SimUser, type StaffRole, type Topic } from "./rehearsal/scenario";
import { ActualClient, commandCommittee, deliverChange, boundedFetch, ownsWorkItem, reviewableDocument } from "./rehearsal/actual-client";
import { SUBMISSION_TOKEN } from "../lib/submissions/rules";
import {activeLane,floorSpeech,laneEntries,nextSpeaker} from '../lib/procedure/view';
import { isLive, rollCallAt } from '../lib/sessions/presence';
import { draftRequirements, workflowPreflight, pendingDiagnostics } from './rehearsal/workflow';
import type { AttendanceStatus } from '../lib/domain';
import { createSeed } from "../lib/seed";
import type { Transport } from "../lib/sync/repository";
import { evaluate, report, type Sample } from "./rehearsal/metrics";
import { countSnapshotRpcs, type RpcCounter } from "./rehearsal/rpc-counter";
import { isMultiCommittee, loadIdentities, resolveChairMapping, type ChairIdentity, type Identity, type IdentityFile, type StaffRoleKey } from "./rehearsal/identities";
import { DOCUMENTED_SUBMIT_FRACTION, MAX_SINGLE_LINK_SUBMISSIONS, assessReadiness, capacityGateLabel, assignChair, checkSingleLinkSubmissions, plannedSubmissions, readinessVerdict, observedWorkVerdict, assertSubmissionBinding, conferenceGateProfile, rampVerdict, type ChairAssignment, type ChairTraffic, type RunMode } from "./rehearsal/readiness";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const app = value("--app");
const target = checkAppUrl(app);
if (!target.ok) { console.error(`Refused: ${target.reason}`); process.exit(2); }
const base = app!.replace(/\/$/, "");
// Protected Preview deployments: Vercel "Protection Bypass for Automation" secret, from the environment only.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const wireFetch = boundedFetch(fetch);
const appFetch = (url: string, init: RequestInit = {}) => wireFetch(url, { ...init, redirect: 'error', headers: { ...(init.headers as Record<string, string>), ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) } });
const stages = (value("--stages") ?? value("--staff") ?? "10").split(",").map(Number);
for (const n of stages) { const g = checkUsers(n); if (!g.ok) { console.error(g.reason); process.exit(2); } }
let staffProfile: ReturnType<typeof parseStaffProfile>;
try { staffProfile = parseStaffProfile(args.includes('--staff-profile') ? value('--staff-profile') ?? '' : undefined); }
catch (e) { console.error(`Refused: ${(e as Error).message}`); process.exit(2); }
const delegateCount = Number(value("--delegates") ?? 0);
if (delegateCount && !checkUsers(delegateCount).ok) { console.error(checkUsers(delegateCount).reason); process.exit(2); }
const minutes = Number(value("--minutes") ?? 5);
if (value("--client-reads")) { console.error("--client-reads was removed: every device now runs the production client model (scripts/rehearsal/actual-client.ts)."); process.exit(2); }
if(!Number.isFinite(minutes)||minutes<=0||minutes>60){console.error('Refused: --minutes must be greater than zero and at most 60.');process.exit(2);}
const realtimeModel = (value("--realtime") ?? "topic-aware") as RealtimeModel;
if (!["topic-aware", "current"].includes(realtimeModel)) { console.error("--realtime must be topic-aware or current"); process.exit(2); }
const drainMs = Number(value("--drain-seconds") ?? 120) * 1000;
// Core PR #10: an Executive/Admin-only device coalesces 'chair' events into a fixed window (0 = plain 350 ms debounce).
if(!Number.isFinite(drainMs)||drainMs<0||drainMs>600_000){console.error('Refused: --drain-seconds must be between 0 and 600.');process.exit(2);}
const executiveChairWindowMs = realtimeModel === "topic-aware" ? Number(value("--executive-chair-window") ?? 2000) : 0;
if(!Number.isFinite(executiveChairWindowMs)||executiveChairWindowMs<0||executiveChairWindowMs>60_000){console.error('Refused: --executive-chair-window must be between 0 and 60000 ms.');process.exit(2);}
const fixtureFile = value("--fixture") ?? ".test-sessions/load-fixtures.json";
const submitToken = value("--submit-token");
if (delegateCount && (!submitToken || !SUBMISSION_TOKEN.test(submitToken))) { console.error('Public-form workload requires a valid --submit-token; an invalid fake QR page is never readiness traffic.'); process.exit(2); }
const identitiesFile = value("--identities");
// ---- Local preflight: plan every stage from local files only, BEFORE any network request -----------------------------
const fixture = JSON.parse(await readFile(fixtureFile, "utf8").catch(() => { console.error(`Missing ${fixtureFile}: run scripts/rehearsal-fixture.mts (or prepare-load.mts) and apply its SQL to the development project.`); process.exit(2); })) as { conference: string; committees: { id: string; session: string; code: string }[]; delegates: { id: string; committee: string; session?: string }[] };
const rawIdentities = identitiesFile ? JSON.parse(await readFile(identitiesFile, "utf8").catch(() => { console.error(`Missing ${identitiesFile}.`); process.exit(2); })) as IdentityFile : null;
// Legacy single-Chair files simulate committees as floor sessions; every other mode uses the fixture's real committees.
const simulatedCommittees = rawIdentities && !isMultiCommittee(rawIdentities) ? rawIdentities.chair.sessions.length : fixture.committees.length;
const submitFraction = submitToken ? Number(value("--submit-fraction") ?? DOCUMENTED_SUBMIT_FRACTION) : 0;
for(const flag of ['--start-window','--delegate-window']){const raw=value(flag);if(raw!==undefined&&(!Number.isFinite(Number(raw))||Number(raw)<0)){console.error(`Refused: ${flag} must be a non-negative finite number.`);process.exit(2);}}
if(!Number.isFinite(submitFraction)||submitFraction<0||submitFraction>1){console.error('Refused: --submit-fraction must be between 0 and 1.');process.exit(2);}
const scenarioFor = (staff: number) => buildScenario({ staff, staffProfile, delegates: delegateCount, minutes, committees: simulatedCommittees, startWindowSeconds: Number(value("--start-window") ?? 150), delegateWindowSeconds: Number(value("--delegate-window") ?? 120), submitFraction });
const staffRolesPerStage = stages.map(n => {
  const roles = summarize(scenarioFor(n), minutes).roles;
  return Object.fromEntries((['chair','approval','admins','executive'] as const).map(role=>[role,roles[role]??0])) as Record<StaffRole,number>;
});
console.log(JSON.stringify({staffProfile, staffRolesPerStage}));
console.log(JSON.stringify({ fixtureDraftsRequired: draftRequirements(stages.map(scenarioFor), simulatedCommittees),
  note: 'Draft counts cover this command only; separate ramp commands consume the same fixture. Recheck before every stage.' }));
// One resolution link: stay below its designed 20 accepted submissions / 10 min. Never plan an intentional 429.
for (const n of stages) {
  const plan = checkSingleLinkSubmissions(scenarioFor(n), Boolean(submitToken));
  if (!plan.ok) { console.error(`Refused: ${plan.reason}`); process.exit(2); }
  if (submitToken) console.log(`Stage ${n} staff: ${plan.pageLoads} public page loads, ${plan.planned} resolution submissions planned on one link (max ${MAX_SINGLE_LINK_SUBMISSIONS}).`);
}
// Loaded only after the guards: these enforce the development Supabase project and an authorized test session.
const context = await import("./remote-context.mts").catch((e: Error) => {
  console.error(`Rehearsal setup missing: ${e.message}\nNeeds .env.local for the DEVELOPMENT Supabase project and an authorized session (see docs/STAGING_REHEARSAL.md → Preparation).`);
  process.exit(2);
});
const { session, ref } = context;
// Same token/URL contract as remote-context.clientFor; bound this harness's actual HTTP so closure cannot hang forever.
const clientFor = (token: string) => createClient(context.env.NEXT_PUBLIC_SUPABASE_URL, context.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` }, fetch: wireFetch }, accessToken: async () => token, auth: { persistSession: false, autoRefreshToken: false } });
{ const synthetic = checkFixtureConference(fixture.conference, { ...context.env, ...process.env }); if (!synthetic.ok) { console.error(`Refused: ${synthetic.reason}`); process.exit(2); } }
await context.verifyPhase();
// Network starts here: everything above (app URL shape, fixture, Supabase project guard, synthetic-conference guard) is local.
// The deployment's own /api/health may contact the database, Auth and Storage, so it runs only after every local guard passed.
const health = await appFetch(`${base}/api/health`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
const env = checkHealthEnvironment(health);
if (!env.ok) { console.error(`Refused: ${env.reason}`); process.exit(2); }
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
const { ConflictError } = await import("../lib/sync/repository");
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
if (delegateCount && submitToken) {
  const verifier = scoped ? identities.executive! : superuser;
  const binding = await new SupabaseTransport(clientFor(verifier.token), fixture.conference, verifier.userId).read();
  assertSubmissionBinding(binding.submissionLinks, submitToken, submitCommittee!.id);
}

const samples: Sample[] = [];
const acknowledged = new Set<string>(); // speechScore / poiScore mutation ids the server accepted
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const classify = (e: unknown): Sample["outcome"] => {
  if (e instanceof ConflictError) return "conflict";
  const text = JSON.stringify(e ?? "") + String((e as Error)?.message ?? "");
  return /429|rate.?limit|too many/i.test(text) ? "rate_limited" : "error";
};
/** Records one timed request and rethrows its error (the client model needs to see failures). */
async function measure(action: string, op: () => Promise<unknown>, role?: string, source?: string, rpcs?: () => number) {
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
      await timed("submitPage", async () => { const r = await appFetch(`${base}/submit/${submitToken}`); const html = await r.text(); if (r.status !== 200 || !html.includes('I have made sure the Chairs can edit this document.')) throw Error('Public submission form did not load.'); observedPublic.pages++; });
    else if (step.action === "submit" && submitToken)
      await timed("submit", async () => {
        const form = new FormData();
        form.set("token", submitToken); form.set("submissionId", crypto.randomUUID()); form.set("submitterId", submitters[user.id % submitters.length].id);
        form.set("googleDoc", `https://docs.google.com/document/d/rehearsal${String(user.id).padStart(4, "0")}${crypto.randomUUID().replaceAll("-", "")}/edit`);
        const r = await appFetch(`${base}/api/submissions`, { method: "POST", body: form });
        if (r.status === 429) throw Error("429 rate limited");
        if (r.status >= 400) throw Error(`HTTP ${r.status} ${await r.text()}`);
        const body = await r.json();
        if (!body.ok || !['created','replayed','duplicate'].includes(body.status)) throw Error('Public submission was not acknowledged.');
        if (body.status !== 'created') throw Error('A fresh synthetic public submission was not created.');
        observedPublic.creates++;
        if (body.status === 'created') broadcast({ topic: 'documents', committee: fixture.committees.findIndex(c => c.id === submitCommittee!.id) });
      });
  }
}
type Mutation = import("../lib/sync/store").Mutation;
interface Device { user: SimUser; transport: TransportInstance; readonly data: Data | null; client: ActualClient }
const REALTIME_DELIVERY_MS = 100; // explicitly simulated commit → notification delivery, NOT a real channel
let devices = new Map<SimUser, Device>();
let stageSnapshotRpcs: Record<string, number> = {};
let observedReads: Record<string, number> = {}, observedWrites: Record<string, number> = {};
let openedDevices=new Set<number>();
let observedActions: Record<string, number> = {}, observedPublic = { pages: 0, creates: 0 };
let observedChairDevices = new Map<number, ChairTraffic>();
const broadcast = (event: { topic: Topic; committee: number; mutationId?: string }) => {
  if (event.committee < 0) throw Error('Cannot attribute an accepted change to its fixture committee.');
  deliverChange(realtimeModel, [...devices.keys()], event, (user, topic, mutationId) => setTimeout(() => devices.get(user)?.client.notify(topic, mutationId), REALTIME_DELIVERY_MS));
};
const actionOf = (m: Mutation): string => m.command.type === 'document'
  ? ({ Submitted: 'sendToApproval', Approved: 'approve', Printed: 'print' } as Record<string,string>)[m.command.status] ?? 'document'
  : m.command.type;
function makeDevice(user: SimUser): Device {
  const id = identityOf(user);
  const roles = scoped && user.role !== 'delegate' ? grantedRoles[user.role] : [];
  const counter: RpcCounter = { snapshot: 0, byName: stageSnapshotRpcs };
  const transport = new Transport(countSnapshotRpcs(clientFor(id.token), counter), fixture.conference, id.userId, [], false, roles);
  const seen = new Set<string>();
  const measured: Transport = {
    actorId: id.userId,
    passiveRefreshGapMs: transport.passiveRefreshGapMs,
    syncClock: device => transport.syncClock(device),
    read: async () => {
      const before = counter.snapshot; let data!: Data;
      await measure('refresh', async () => { data = await transport.read(); }, user.role, 'actual-core', () => counter.snapshot - before);
      observedReads[user.role] = (observedReads[user.role] ?? 0) + 1;
      openedDevices.add(user.id);
      return data;
    },
    send: async m => {
      const repeated = seen.has(m.id); seen.add(m.id);
      await measure(`${actionOf(m)}${repeated ? ' (resend)' : ''}`, () => transport.send(m), user.role);
    },
  };
  const client = new ActualClient({ key: crypto.randomUUID(), seed: createSeed, transport: measured, connected: true,
    executiveChairWindowMs: user.role === 'executive' && scoped ? executiveChairWindowMs : 0,
    accepted: (m, meta, first) => {
      if (!first) return;
      observedWrites[user.role] = (observedWrites[user.role] ?? 0) + 1;
      observedActions[meta.action] = (observedActions[meta.action] ?? 0) + 1;
      const committeeId = commandCommittee(client.snapshot, m.command);
      if (user.role === 'chair') {
        const a = chairOf(user);
        if (committeeId === a.committee.id) observedChairDevices.set(user.id, { committeeId, committeeCode: a.committee.code, identity: a.identity.userId });
      }
      if (m.command.type === 'speechScore' || m.command.type === 'poiScore') acknowledged.add(m.id);
      const topic = TOPIC_OF[actionOf(m) as Action];
      if (topic) broadcast({ topic, committee: fixture.committees.findIndex(c => c.id === committeeId), mutationId: m.id });
    },
  });
  return { user, transport, client, get data() { return client.snapshot; } };
}
async function simulate(user: SimUser, t0: number) {
  if (user.role === "delegate") return simulateDelegate(user, t0);
  // Chairs: committee k's real committee row, session and Chair identity (realistic mode); legacy floor/worst-case
  // modes keep their historical scoping. Support roles only use the committee index for Realtime attribution.
  const committee = user.role === "chair" ? chairOf(user).committee : legacy ? { id: legacy.committee, session: legacy.sessions[user.committee % legacy.sessions.length], code: `floor-${user.committee}` } : fixture.committees[user.committee % fixture.committees.length];
  const device = devices.get(user)!;
  let cursor = 0;
  const role = user.role === "approval" ? "approval" : user.role === "admins" ? "logistics" : user.role === "executive" ? "admin" : "chair";
  // The ACTUAL repository normalizes, fingerprints, applies and durably records the intent.
  const send = async (action: Action, command: Command, retry?: boolean, as = role) => {
    if (!device.data) return;
    try { await device.client.execute(command, as as import('../lib/domain').Role, { action, retry }); }
    catch { samples.push({ action: `${action} (local refusal)`, role: user.role, ms: 0, outcome: 'error' }); }
  };
  const d = () => device.data;
  // Live state is keyed by committee and presence comes from the live roll call (docs/SESSION_MODEL.md sections 6 and 8).
  const cid = committee.id;
  const present = () => { const call = d() ? rollCallAt(d()!, cid) : undefined; return (call?.rows ?? []).filter((r) => r.status !== "Absent").map((r) => r.delegateId); };
  const active = () => d() ? floorSpeech(d()!, cid) : undefined;
  const owns = (id:string) => ownsWorkItem(id,user,[...devices.keys()]);
  const myDelegates = () => (d()?.delegates.filter(x=>x.committeeId===committee.id&&ownsWorkItem(x.id,user,[...devices.keys()].filter(p=>p.committee===user.committee)))??[]);
  for (const step of user.steps) {
    await sleep(t0 + step.at - Date.now());
    const data = d();
    const here = present();
    const anyPresent = here[cursor++ % Math.max(1, here.length)];
    switch (step.action) {
      case "open": await device.client.open(); break;
      // Production refreshes only through flush(): there is no fetch for merely looking at a screen. A support
      // role's "read" is returning to the Conference OS tab (window focus); recovery polling is the client's
      // timer, so the scenario's periodic steps are not replayed here.
      case "read": if (!step.periodic) device.client.focus(); break;
      case "refocus": device.client.focus(); break;
      case "health": await timed("health", async () => { const r = await appFetch(`${base}/api/health`); if (r.status >= 500) throw Error(`HTTP ${r.status}`); }); break;
      case "draft": break; // A roll call draft lives on the device until it is committed.
      case "rollCall": {
        // The whole roll call in one write: every delegate of the committee, nearly all present.
        const rows = (data?.delegates.filter((x) => x.committeeId === cid) ?? []).map((x, i) => ({ delegateId: x.id, status: (i % 11 === 10 ? "Absent" : (i + cursor) % 3 ? "Present" : "Present & Voting") as AttendanceStatus }));
        const at = new Date().toISOString();
        if (rows.length) await send("rollCall", { type: "rollCallCommit", committeeId: cid, rollCallId: crypto.randomUUID(), revision: 1, observedAt: at, committedAt: at, rows }, step.retry);
        break;
      }
      case "queueAdd": {
        const lane = data ? activeLane(data,cid) : "open";
        const queued = new Set(data?.queue.filter((q) => isLive(q, cid) && (q.lane ?? "open") === lane).map((q) => q.delegateId));
        const delegate = myDelegates().map(d=>d.id).find((id) => here.includes(id)&&!queued.has(id));
        if (delegate) await send("queueAdd", { type: "queueAdd", committeeId: cid, delegateId: delegate, lane }, step.retry);
        break;
      }
      case "queueOrder": {
        const lane=data?activeLane(data,cid):"open";
        const ids = data?laneEntries(data,cid,lane).map(q=>q.id):[];
        if (ids.length > 1) await send("queueOrder", { type: "queueOrder", committeeId: cid, lane, ids: [...ids.slice(1), ids[0]] }, step.retry);
        break;
      }
      case "speechStart": {
        if (active() || !anyPresent) break;
        const entry = data ? nextSpeaker(data,cid) : undefined;
        if(entry&&!here.includes(entry.delegateId))break;
        const lane=data?activeLane(data,cid):"open";
        const classification = lane === "for" ? "For" : lane === "against" ? "Against" : "Other";
        await send("speechStart", { type: "speechStart", committeeId: cid, delegateId: entry?.delegateId ?? anyPresent, resolutionId: null, classification, ...(entry ? { entryId: entry.id } : {}) }, step.retry);
        break;
      }
      case "poiAllowance": { const s = active(); if (s) await send("poiAllowance", { type: "poiAllowance", committeeId: cid, speechId: s.id, limit: Math.max(2, s.poiCount + 1) }, step.retry); break; }
      case "poiAdd": { const s = active(); const asker = here.find((id) => id !== s?.delegateId); if (s && asker) await send("poiAdd", { type: "poiAdd", committeeId: cid, speechId: s.id, delegateId: asker }, step.retry); break; }
      case "poiRecognize": { const s = active(); const poi = (data?.poiQueue ?? []).filter((p) => p.speechId === s?.id).sort((a, b) => a.position - b.position)[0]; if (s?.state === "pois" && poi) await send("poiRecognize", { type: "poiRecognize", committeeId: cid, speechId: s.id, entryId: poi.id }, step.retry); break; }
      case "poiScore": { const s = active(); const poi = (data?.poiQueue ?? []).find(p => p.speechId === s?.id && !!p.recognizedAt); if (s && poi) await send('poiScore', { type: 'poiScore', committeeId: cid, speechId: s.id, entryId: poi.id, points: 1 + (cursor % 2) }, step.retry); break; }
      case "speechScore": { const s = active(); if (s && !data?.events.some((e) => e.speechId === s.id && e.categoryId === "speech")) await send("speechScore", { type: "speechScore", committeeId: cid, speechId: s.id, points: 1 + (cursor % 3) }, step.retry); break; }
      case "speechFinish": { const s = active(); if (s) await send("speechFinish", { type: "speechFinish", committeeId: cid, speechId: s.id }, step.retry); break; }
      case "timer": break; // Shipping timer is device-local: no mutation or notification.
      case "photoAck": { const slot = data?.photoSlots?.find((s) => s.enabled); if (slot) await send("photoAck", { type: "photoAck", committeeId: committee.id, slotId: slot.id, stage: "warning", revision: slot.revision }, step.retry); break; }
      case "sendToApproval": { const doc = data?.documents.find((x) => x.committeeId === committee.id && x.status === "Draft"); if (doc) await send("sendToApproval", { type: "document", id: doc.id, status: "Submitted" }, step.retry); break; }
      case "approve": { const doc = reviewableDocument(data,owns); if (doc) await send("approve", { type: "document", id: doc.id, status: "Approved" }, step.retry, "approval"); break; }
      case "print": { const doc = data?.documents.find((x) => x.status === "Approved"&&owns(x.id)); if (doc) await send("print", { type: "document", id: doc.id, status: "Printed" }, step.retry, "logistics"); break; }
    }
  }
}
const stageReports = [];
const readinessByStage: ReturnType<typeof assessReadiness>[] = [];
for (const users of stages) {
  const scenario = scenarioFor(users);
  // Outside the timed workload: scope-check the real workflow state instead of discovering a depleted fixture after a five-minute run.
  const chairScopes = [...new Map(scenario.filter(u => u.role === 'chair').map(u => {
    const assignment = chairOf(u); return [assignment.committee.id, assignment] as const;
  })).values()];
  const fixtureState = await Promise.all(chairScopes.map(a => new Transport(clientFor(a.identity.token), fixture.conference, a.identity.userId, [], false, ['chair']).read()));
  const workflow = workflowPreflight(scenario, legacy ? Array.from({ length: simulatedCommittees }, (_, i) => ({ id: legacy.committee, code: `floor-${i}` })) : fixture.committees, fixtureState);
  if (!workflow.pass) { console.error(`Refused before timed stage: ${workflow.reasons.join('; ')}`); process.exit(2); }
  const before = samples.length;
  console.log(`Stage: ${users} staff + ${delegateCount} delegates (public form) for ${minutes} min against ${base} (Supabase ${ref}, realtime model ${realtimeModel})…`);
  const staffUsers = scenario.filter((u) => u.role !== "delegate");
  stageSnapshotRpcs = {}; observedReads = {}; observedWrites = {}; openedDevices=new Set(); observedChairDevices = new Map(); observedActions = {}; observedPublic = { pages: 0, creates: 0 };
  devices = new Map(staffUsers.map((user) => [user, makeDevice(user)]));
  // Real committee distribution of this stage's Chair devices (committee row + Chair Auth identity actually used).
  const chairTraffic: ChairTraffic[] = staffUsers.filter((u) => u.role === "chair").map((u) => { const a = chairOf(u); return { committeeId: a.committee.id, committeeCode: a.committee.code, identity: a.identity.userId }; });
  const configuredReadiness = assessReadiness({ mode, committees: fixture.committees.slice(0, simulatedCommittees), chairTraffic });
  console.log(`  Configured distribution: ${configuredReadiness.label}; observed accepted traffic is checked after the stage.`);
  const t0 = Date.now() + 1000;
  await Promise.all(scenario.map((u) => simulate(u, t0)));
  // Drain: people stop, devices keep their normal sync behaviour until outboxes are empty (bounded).
  const scenarioEnded = Date.now();
  while (Date.now() - scenarioEnded < drainMs && [...devices.values()].some((d) => d.client.pending || d.client.busy)) await sleep(500);
  const closed = await Promise.all([...devices.values()].map(d => d.client.close()));
  const closeTimedOut = closed.some(settled => !settled);
  const pendingAtClose = [...devices.values()].reduce((n, d) => n + d.client.pending, 0);
  const conflictsAtClose = [...devices.values()].reduce((n, d) => n + d.client.conflicts, 0);
  const unconfirmedAtClose = [...devices.values()].reduce((n, d) => n + d.client.unconfirmed, 0);
  const unresolved = pendingDiagnostics([...devices.values()].map(d => ({ device: d.user.id, role: d.user.role,
    committee: d.user.role === 'chair' ? chairOf(d.user).committee.code : 'conference', pending: d.client.repo.getPending() })));
  const readiness = assessReadiness({ mode, committees: fixture.committees.slice(0, simulatedCommittees), chairTraffic: [...observedChairDevices.values()] });
  readinessByStage.push(readiness);
  const work = observedWorkVerdict({ expectedDevices:staffUsers.length,openedDevices:openedDevices.size, expectedRoles: [...new Set(staffUsers.map(u => u.role))], reads: observedReads, writes: observedWrites,
    expectedChairCommittees: [...new Set(chairTraffic.map(c => c.committeeId))], observedChairCommittees: [...new Set([...observedChairDevices.values()].map(t => t.committeeId))],
    pending: pendingAtClose, conflicts: conflictsAtClose, unconfirmed: unconfirmedAtClose, closeTimedOut,localRefusals:[...devices.values()].reduce((n,d)=>n+d.client.stats.localRefusals,0),
    expectedActions: ['speechScore','poiRecognize','poiScore','sendToApproval','approve','print'].filter(a => scenario.some(u => u.steps.some(s => s.action === a))), actions: observedActions,
    expectedPages: delegateCount, completedPages: observedPublic.pages, expectedSubmissions: plannedSubmissions(scenario), createdSubmissions: observedPublic.creates });
  stageReports.push({ staff: users, delegates: delegateCount, configuredReadiness, readiness, observed: { openedDevices:openedDevices.size, reads: observedReads, writes: observedWrites, actions: observedActions, publicForm: observedPublic }, work,
    drainSeconds: Math.round((Date.now() - scenarioEnded) / 1000), pendingAtClose, conflictsAtClose, unconfirmedAtClose, closeTimedOut, workflowPreflight: workflow, unresolved,
    snapshotRpcsByName: stageSnapshotRpcs,
    clientModel: { implementation: 'actual DurableRepository + DurableStore, isolated fake IndexedDB', realtimeDelivery: 'simulated; no real channels', sourceAttribution: 'actual-core; internal trigger attribution is not inferred',
      byRole: Object.fromEntries(['chair','approval','admins','executive'].map(role => [role, [...devices.values()].filter(d => d.user.role === role).map(d => d.client.stats)])) },
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
const metrics = evaluate(overall, duplicates, lost);
const metricVerdict = readinessVerdict(metrics, readiness);
const workChecks = stageReports.flatMap((s, i) => s.work.checks.map(c => ({ ...c, check: `stage ${i + 1}: ${c.check}` })));
const diagnosticVerdict = rampVerdict(metrics, workChecks, mode);
const verdict = { ...metricVerdict, pass: metricVerdict.pass && workChecks.every(c => c.pass), checks: [...metricVerdict.checks, ...workChecks] };
const distinctAuthIdentities = scoped ? new Set([...chairIdentities.filter((_, i) => !mapping || mapping.includes(i)).map((c) => c.userId), ...(["approval", "admins", "executive"] as const).map((r) => identities[r]!.userId)]).size : 1;
const note = mode === "realistic-multi-committee"
  ? "Realistic multi-committee run: each simulated committee is a real committee row with its own session and its own Chair identity/grant; Chair devices of committee k use only committee k's identity, row and session. Approval, Admins and Executive use one role-scoped identity each. No Auth sessions were created during the run. Delegates use only the public form."
  : mode === "legacy-single-committee"
    ? "LEGACY single-committee floors: one Chair identity scoped to ONE committee; simulated committees are extra sessions inside it, so every Chair write serializes on one committees row (overstates contention). Historical comparison only — NOT A READINESS RUN."
    : "WORST CASE: every simulated device shares one identity holding Chair grants for every committee plus Approval, Logistics and Admin, so each read returns the admin-sized snapshot. Historical comparison only — NOT A READINESS RUN.";
const peakStaff = Math.max(...stages);
const capacityGate = capacityGateLabel(peakStaff);
const conferenceGate={...conferenceGateProfile({staffStages:stages,minutes,committees:simulatedCommittees,delegates:delegateCount,submissionsPerStage:stages.map(n=>plannedSubmissions(scenarioFor(n))),staffRolesPerStage}),pass:false};
conferenceGate.pass=conferenceGate.eligible&&verdict.pass;
const publicForm = { delegates: delegateCount, singleLink: Boolean(submitToken), submissionsPlannedPerStage: Object.fromEntries(stages.map((n) => [n, plannedSubmissions(scenarioFor(n))])), maxSingleLinkSubmissions: MAX_SINGLE_LINK_SUBMISSIONS, note: "Resolution public form only; delegates create no Auth session. Amendment form and rate limiting are tested functionally, separately." };
const result = { date: new Date().toISOString(), app: base, appBuild: health.app, supabaseProject: ref, staffProfile, staffRolesPerStage, identityMode: mode, readinessLabel: conferenceGate.eligible?verdict.label:"RAMP / DIAGNOSTIC ONLY", readiness, conferenceGate, distinctAuthIdentities, note, capacityGate, publicForm, minutes, stages: stageReports, realtimeModel, clientModel: "ACTUAL DurableRepository + DurableStore (Node fake IndexedDB; explicitly simulated Realtime delivery)", exactlyOnce: { acknowledgedScoring: acknowledged.size, duplicates, lost }, diagnosticVerdict, verdict };
await mkdir(".test-sessions", { recursive: true, mode: 0o700 });
const file = `.test-sessions/rehearsal-${result.date.replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify({ ...result, samples }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
console.log(`Full report (with samples): ${file}`);
if (!(conferenceGate.eligible ? conferenceGate.pass : diagnosticVerdict.pass)) process.exitCode = 1;
