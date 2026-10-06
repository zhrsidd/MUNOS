// Realistic staging rehearsal. Opt-in, guarded, conservative by default (10 staff, 0 delegates, 5 minutes).
//   npm run rehearsal:run -- --app https://<preview>.vercel.app [--staff 25 | --stages 25,50,100] [--minutes 5]
//        [--client-reads realistic|minimal]
//        [--start-window 150] [--delegates 150 --delegate-window 120 --submit-token <token>
//         --submit-committee <code> --submit-fraction 0.3]
// STAFF stages simulate Chairs/Approval/Admins/Executive with a staff session. DELEGATES are separate:
// they only load the public QR page and POST submissions — no Supabase client, no session, no dashboard.
// Requires: .env.local pointing at the DEVELOPMENT Supabase project (enforced by remote-context.mts),
// .test-sessions/development.json (npm script prepare-session) and .test-sessions/load-fixtures.json
// (scripts/prepare-load.mts, applied to the development project). Never targets production; no override exists.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { checkAppUrl, checkHealthEnvironment, checkUsers } from "./rehearsal/guard";
import { REALTIME_DEBOUNCE_MS, buildScenario, subscribers, type Action, type SimUser } from "./rehearsal/scenario";
import { evaluate, report, type Sample } from "./rehearsal/metrics";
import { loadIdentities, type Identity, type StaffRoleKey } from "./rehearsal/identities";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const app = value("--app");
const target = checkAppUrl(app);
if (!target.ok) { console.error(`Refused: ${target.reason}`); process.exit(2); }
const base = app!.replace(/\/$/, "");
// Protected Preview deployments: Vercel "Protection Bypass for Automation" secret, from the environment only.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const appFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) } });
const health = await appFetch(`${base}/api/health`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
const env = checkHealthEnvironment(health);
if (!env.ok) { console.error(`Refused: ${env.reason}`); process.exit(2); }
const stages = (value("--stages") ?? value("--staff") ?? "10").split(",").map(Number);
for (const n of stages) { const g = checkUsers(n); if (!g.ok) { console.error(g.reason); process.exit(2); } }
const delegateCount = Number(value("--delegates") ?? 0);
if (delegateCount && !checkUsers(delegateCount).ok) { console.error(checkUsers(delegateCount).reason); process.exit(2); }
const minutes = Number(value("--minutes") ?? 5);
// realistic (default): model the client's reads after each write and Realtime fan-out. minimal: one read per write.
const realisticReads = (value("--client-reads") ?? "realistic") !== "minimal";
const submitToken = value("--submit-token");
// Loaded only after the guards: these enforce the development Supabase project and an authorized test session.
const context = await import("./remote-context.mts").catch((e: Error) => {
  console.error(`Rehearsal setup missing: ${e.message}\nNeeds .env.local for the DEVELOPMENT Supabase project and an authorized session (see docs/STAGING_REHEARSAL.md → Preparation).`);
  process.exit(2);
});
const { clientFor, session, ref } = context;
// Role-scoped identities (--identities <file>): pre-authorized sessions, one per role, each holding ONLY that role's grant,
// so every simulated device reads the RLS payload a real device of that role would receive. Without it, every device
// shares the all-roles test identity: a labelled WORST-CASE (admin-sized snapshot for everyone), not a readiness baseline.
// No Auth session is created during the run; sessions near expiry are refreshed once before the run starts.
const identitiesFile = value("--identities");
const loaded = identitiesFile ? await loadIdentities(identitiesFile, context.env).catch((e: Error) => { console.error(e.message); process.exit(2); }) : null;
const scoped = loaded?.scoped ?? null;
const identities: Partial<Record<StaffRoleKey, Identity>> = loaded?.identities ?? {};
const identityOf = (role: SimUser["role"]): Identity => scoped && role !== "delegate" ? identities[role]! : { userId: session.user.id, token: session.access_token };
const { SupabaseTransport } = await import("../lib/supabase/repository");
const { ConflictError, fingerprint } = await import("../lib/sync/repository");
type Data = Awaited<ReturnType<InstanceType<typeof SupabaseTransport>["read"]>>;
type Command = import("../lib/commands").Command;
const fixture = JSON.parse(await readFile(".test-sessions/load-fixtures.json", "utf8").catch(() => { console.error("Missing .test-sessions/load-fixtures.json: run scripts/prepare-load.mts and apply its SQL to the development project."); process.exit(2); })) as { conference: string; committees: { id: string; session: string; code: string }[]; delegates: { id: string; committee: string }[] };
// Delegates submit to the committee the rehearsal link belongs to; their country choices come from the fixture file
// (what the public page would list), never from a staff read.
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
async function timed(action: string, op: () => Promise<unknown>, role?: string) {
  const start = performance.now();
  try { await op(); samples.push({ action, role, ms: performance.now() - start, outcome: "ok" }); return true; }
  catch (e) { samples.push({ action, role, ms: performance.now() - start, outcome: classify(e), detail: e instanceof Error ? e.message.slice(0, 160) : JSON.stringify(e ?? null).slice(0, 160) }); return false; }
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
interface Device { user: SimUser; transport: InstanceType<typeof SupabaseTransport>; data: Data | null; pending?: ReturnType<typeof setTimeout>; reading?: Promise<void> }
let devices: Device[] = [];
/** One full client refresh (both snapshot RPCs), as lib/supabase/repository.ts read() does. */
async function refresh(device: Device, action: string) {
  await timed(action, async () => { device.data = await device.transport.read(); }, device.user.role);
}
/** Realtime notification: debounced 350 ms per device, like the subscribe() handler in the client. */
function notify(device: Device) {
  if (!realisticReads || device.pending) return;
  device.pending = setTimeout(() => { device.pending = undefined; device.reading = refresh(device, "realtimeRefresh"); }, REALTIME_DEBOUNCE_MS);
}
async function simulate(user: SimUser, t0: number) {
  if (user.role === "delegate") return simulateDelegate(user, t0);
  // Scoped mode: every simulated committee k is an independent floor (its own session) inside the Chair identity's committee.
  const committee = scoped ? { id: scoped.chair.committee, session: scoped.chair.sessions[user.committee % scoped.chair.sessions.length], code: `floor-${user.committee}` } : fixture.committees[user.committee % fixture.committees.length];
  const actorId = identityOf(user.role).userId;
  const device = devices.find((d) => d.user === user)!;
  const fanout = subscribers(devices.map((d) => d.user), user).map((u) => devices.find((d) => d.user === u)!);
  let cursor = 0;
  const role = user.role === "approval" ? "approval" : user.role === "admins" ? "logistics" : user.role === "executive" ? "admin" : "chair";
  const send = async (action: Action, command: Command, retry?: boolean, as = role) => {
    if (!device.data) return;
    const mutation = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId, role: as as never, command, expected: fingerprint(device.data, command), state: "pending" as const };
    const ok = await timed(action, () => device.transport.send(mutation), user.role);
    if (ok && retry) await timed(`${action} (retry)`, () => device.transport.send(mutation), user.role); // same id: must apply once
    if (ok && (command.type === "speechScore" || command.type === "poiRecognize")) acknowledged.add(mutation.id);
    if (!ok) return;
    if (realisticReads) {
      // DurableRepository.flush(): one read after the sent item, one final read; then the device's own
      // Realtime notification (another flush) and every subscribed device's debounced refresh.
      await refresh(device, "postWriteRead");
      await refresh(device, "postWriteRead");
      notify(device);
      fanout.forEach(notify);
    } else await refresh(device, "postWriteRead");
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
      case "open": case "read": case "refocus": await refresh(device, step.action); break;
      case "health": await timed("health", async () => { const r = await appFetch(`${base}/api/health`); if (r.status >= 500) throw Error(`HTTP ${r.status}`); }); break;
      case "currentSession": if (scoped && user.committee > 0) break; await send("currentSession", { type: "currentSession", committeeId: committee.id, sessionId: sid }, step.retry); break;
      case "attendance": { const delegate = mine()[cursor % Math.max(1, mine().length)]; if (delegate) await send("attendance", { type: "attendance", delegateId: delegate.id, sessionId: sid, status: cursor % 3 ? "Present" : "Present & Voting" }, step.retry); break; }
      case "queueAdd": {
        const lane = (["open", "for", "against"] as const)[cursor % 3];
        const queued = new Set(data?.queue.filter((q) => q.sessionId === sid && (q.lane ?? "open") === lane).map((q) => q.delegateId));
        const delegate = here.find((id) => !queued.has(id));
        if (delegate) await send("queueAdd", { type: "queueAdd", sessionId: sid, delegateId: delegate, lane }, step.retry);
        break;
      }
      case "queueOrder": {
        const ids = (data?.queue ?? []).filter((q) => q.sessionId === sid && (q.lane ?? "open") === "open").sort((a, b) => a.position - b.position).map((q) => q.id);
        if (ids.length > 1) await send("queueOrder", { type: "queueOrder", sessionId: sid, lane: "open", ids: [...ids.slice(1), ids[0]] }, step.retry);
        break;
      }
      case "speechStart": {
        if (active() || !anyPresent) break;
        const entry = (data?.queue ?? []).filter((q) => q.sessionId === sid && here.includes(q.delegateId)).sort((a, b) => a.position - b.position)[0];
        const classification = entry?.lane === "for" ? "For" : entry?.lane === "against" ? "Against" : "Other";
        await send("speechStart", { type: "speechStart", sessionId: sid, delegateId: entry?.delegateId ?? anyPresent, resolutionId: null, classification, ...(entry ? { entryId: entry.id } : {}) }, step.retry);
        break;
      }
      case "poiAllowance": { const s = active(); if (s) await send("poiAllowance", { type: "poiAllowance", sessionId: sid, speechId: s.id, limit: Math.max(2, s.poiCount + 1) }, step.retry); break; }
      case "poiAdd": { const s = active(); const asker = here.find((id) => id !== s?.delegateId); if (s && asker) await send("poiAdd", { type: "poiAdd", sessionId: sid, speechId: s.id, delegateId: asker }, step.retry); break; }
      case "poiRecognize": { const s = active(); const poi = (data?.poiQueue ?? []).filter((p) => p.speechId === s?.id).sort((a, b) => a.position - b.position)[0]; if (s?.state === "pois" && poi) await send("poiRecognize", { type: "poiRecognize", sessionId: sid, speechId: s.id, entryId: poi.id, points: 1 + (cursor % 2) }, step.retry); break; }
      case "speechScore": { const s = active(); if (s && !data?.events.some((e) => e.speechId === s.id && e.categoryId === "speech")) await send("speechScore", { type: "speechScore", sessionId: sid, speechId: s.id, points: 1 + (cursor % 3) }, step.retry); break; }
      case "speechFinish": { const s = active(); if (s) await send("speechFinish", { type: "speechFinish", sessionId: sid, speechId: s.id }, step.retry); break; }
      case "timer": await send("timer", { type: "timer", sessionId: sid, remaining: 90, startedAt: Date.now(), duration: 90 }, step.retry); break;
      case "photoAck": { const slot = data?.photoSlots?.find((s) => s.enabled); if (slot) await send("photoAck", { type: "photoAck", committeeId: committee.id, slotId: slot.id, stage: "warning", revision: slot.revision }, step.retry); break; }
      case "sendToApproval": { const doc = data?.documents.find((x) => x.committeeId === committee.id && x.status === "Draft"); if (doc) await send("sendToApproval", { type: "document", id: doc.id, status: "Submitted" }, step.retry); break; }
      case "approve": { const doc = data?.documents.find((x) => x.status === "Submitted"); if (doc) await send("approve", { type: "document", id: doc.id, status: "Approved" }, step.retry, "approval"); break; }
      case "print": { const doc = data?.documents.find((x) => x.status === "Approved"); if (doc) await send("print", { type: "document", id: doc.id, status: "Printed" }, step.retry, "logistics"); break; }
    }
  }
}
const stageReports = [];
for (const users of stages) {
  const scenario = buildScenario({ staff: users, delegates: delegateCount, minutes, committees: fixture.committees.length, startWindowSeconds: Number(value("--start-window") ?? 150), delegateWindowSeconds: Number(value("--delegate-window") ?? 120), submitFraction: submitToken ? Number(value("--submit-fraction") ?? 0.3) : 0 });
  const before = samples.length;
  console.log(`Stage: ${users} staff + ${delegateCount} delegates (public form) for ${minutes} min against ${base} (Supabase ${ref})…`);
  devices = scenario.filter((u) => u.role !== "delegate").map((user) => ({ user, transport: new SupabaseTransport(clientFor(identityOf(user.role).token), fixture.conference, identityOf(user.role).userId), data: null }));
  const t0 = Date.now() + 1000;
  await Promise.all(scenario.map((u) => simulate(u, t0)));
  devices.forEach((d) => clearTimeout(d.pending));
  await Promise.all(devices.map((d) => d.reading));
  stageReports.push({ staff: users, delegates: delegateCount, ...report(samples.slice(before)) });
}
// Exactly-once check: every acknowledged scoring mutation produced exactly one participation event.
const finalIdentity = identityOf("executive"); // Executive (admin) sees every participation event
const final = await new SupabaseTransport(clientFor(finalIdentity.token), fixture.conference, finalIdentity.userId).read();
let duplicates = 0, lost = 0;
for (const id of acknowledged) {
  const n = final.events.filter((e) => e.id.startsWith(id.slice(0, 24))).length;
  if (n > 1) duplicates++; if (n === 0) lost++;
}
const overall = report(samples);
const verdict = evaluate(overall, duplicates, lost);
const result = { date: new Date().toISOString(), app: base, appBuild: health.app, supabaseProject: ref, distinctAuthIdentities: scoped ? 4 : 1, identityMode: scoped ? "role-scoped" : "worst-case-superuser", note: scoped ? "Each simulated device reads with a pre-authorized identity holding only its role's grant (Chair scoped to one committee; simulated committees are independent floors/sessions inside it). No Auth sessions were created during the run. Delegates use only the public form." : "WORST CASE: every simulated device shares one identity holding Chair grants for every committee plus Approval, Logistics and Admin, so each read returns the admin-sized snapshot. Not a readiness baseline.", minutes, stages: stageReports, clientReads: realisticReads ? "realistic" : "minimal", exactlyOnce: { acknowledgedScoring: acknowledged.size, duplicates, lost }, verdict };
await mkdir(".test-sessions", { recursive: true, mode: 0o700 });
const file = `.test-sessions/rehearsal-${result.date.replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify({ ...result, samples }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
console.log(`Full report (with samples): ${file}`);
if (!verdict.pass) process.exitCode = 1;
