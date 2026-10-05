// Realistic staging rehearsal. Opt-in, guarded, conservative by default (10 users, 5 minutes).
//   npm run rehearsal:run -- --app https://<preview>.vercel.app [--users 25] [--minutes 5] [--stages 25,50,100]
//                            [--start-window 150] [--submit-token <rehearsal link token>] [--submit-fraction 0.1]
// Requires: .env.local pointing at the DEVELOPMENT Supabase project (enforced by remote-context.mts),
// .test-sessions/development.json (npm script prepare-session) and .test-sessions/load-fixtures.json
// (scripts/prepare-load.mts, applied to the development project). Never targets production; no override exists.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { checkAppUrl, checkHealthEnvironment, checkUsers } from "./rehearsal/guard";
import { buildScenario, type Action, type SimUser } from "./rehearsal/scenario";
import { evaluate, report, type Sample } from "./rehearsal/metrics";
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
const stages = (value("--stages") ?? value("--users") ?? "10").split(",").map(Number);
for (const n of stages) { const g = checkUsers(n); if (!g.ok) { console.error(g.reason); process.exit(2); } }
const minutes = Number(value("--minutes") ?? 5);
const submitToken = value("--submit-token");
// Loaded only after the guards: these enforce the development Supabase project and an authorized test session.
const context = await import("./remote-context.mts").catch((e: Error) => {
  console.error(`Rehearsal setup missing: ${e.message}\nNeeds .env.local for the DEVELOPMENT Supabase project and an authorized session (see docs/STAGING_REHEARSAL.md → Preparation).`);
  process.exit(2);
});
const { clientFor, session, ref } = context;
const { SupabaseTransport } = await import("../lib/supabase/repository");
const { ConflictError, fingerprint } = await import("../lib/sync/repository");
type Data = Awaited<ReturnType<InstanceType<typeof SupabaseTransport>["read"]>>;
type Command = import("../lib/commands").Command;
const fixture = JSON.parse(await readFile(".test-sessions/load-fixtures.json", "utf8").catch(() => { console.error("Missing .test-sessions/load-fixtures.json: run scripts/prepare-load.mts and apply its SQL to the development project."); process.exit(2); })) as { conference: string; committees: { id: string; session: string; code: string }[] };
const samples: Sample[] = [];
const acknowledged = new Set<string>(); // participation mutation ids the server accepted
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const classify = (e: unknown): Sample["outcome"] => {
  if (e instanceof ConflictError) return "conflict";
  const text = JSON.stringify(e ?? "") + String((e as Error)?.message ?? "");
  return /429|rate.?limit|too many/i.test(text) ? "rate_limited" : "error";
};
async function timed(action: string, op: () => Promise<unknown>) {
  const start = performance.now();
  try { await op(); samples.push({ action, ms: performance.now() - start, outcome: "ok" }); return true; }
  catch (e) { samples.push({ action, ms: performance.now() - start, outcome: classify(e), detail: e instanceof Error ? e.message.slice(0, 160) : undefined }); return false; }
}
async function simulate(user: SimUser, t0: number) {
  const committee = fixture.committees[user.committee % fixture.committees.length];
  const transport = new SupabaseTransport(clientFor(), fixture.conference, session.user.id);
  let data: Data | null = null;
  let cursor = 0;
  const role = user.role === "approval" ? "approval" : user.role === "admins" ? "logistics" : user.role === "executive" ? "admin" : "chair";
  const send = async (action: Action, command: Command, retry?: boolean, as = role) => {
    if (!data) return;
    const mutation = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), actorId: session.user.id, role: as as never, command, expected: fingerprint(data, command), state: "pending" as const };
    const ok = await timed(action, () => transport.send(mutation));
    if (ok && retry) await timed(`${action} (retry)`, () => transport.send(mutation)); // same id: must apply once
    if (ok && command.type === "participation") acknowledged.add(mutation.id);
  };
  const mine = () => data?.delegates.filter((d) => d.committeeId === committee.id) ?? [];
  for (const step of user.steps) {
    await sleep(t0 + step.at - Date.now());
    const delegate = mine()[cursor++ % Math.max(1, mine().length)];
    switch (step.action) {
      case "open": case "read": case "refocus": await timed(step.action, async () => { data = await transport.read(); }); break;
      case "attendance": if (delegate) await send("attendance", { type: "attendance", delegateId: delegate.id, sessionId: committee.session, status: cursor % 3 ? "Present" : "Present & Voting" }, step.retry); break;
      case "queue": if (delegate) await send("queue", { type: "queue", sessionId: committee.session, delegateId: delegate.id }, step.retry); break;
      case "queueAdvance": await send("queueAdvance", { type: "queue", sessionId: committee.session, advance: true }, step.retry); break;
      case "participation": if (delegate) await send("participation", { type: "participation", delegateId: delegate.id, sessionId: committee.session, resolutionId: null, categoryId: "speech", points: 2 }, step.retry); break;
      case "timer": await send("timer", { type: "timer", sessionId: committee.session, remaining: 90, startedAt: Date.now(), duration: 90 }, step.retry); break;
      case "photoAck": { const slot = data?.photoSlots?.find((s) => s.enabled); if (slot) await send("photoAck", { type: "photoAck", committeeId: committee.id, slotId: slot.id, stage: "warning", revision: slot.revision }, step.retry); break; }
      case "sendToApproval": { const doc = data?.documents.find((d) => d.committeeId === committee.id && d.status === "Draft"); if (doc) await send("sendToApproval", { type: "document", id: doc.id, status: "Submitted" }, step.retry); break; }
      case "approve": { const doc = data?.documents.find((d) => d.status === "Submitted"); if (doc) await send("approve", { type: "document", id: doc.id, status: "Approved" }, step.retry, "approval"); break; }
      case "print": { const doc = data?.documents.find((d) => d.status === "Approved"); if (doc) await send("print", { type: "document", id: doc.id, status: "Printed" }, step.retry, "logistics"); break; }
      case "health": await timed("health", async () => { const r = await appFetch(`${base}/api/health`); if (r.status >= 500) throw Error(`HTTP ${r.status}`); }); break;
      case "submitPage": await timed("submitPage", async () => { const r = await appFetch(submitToken ? `${base}/submit/${submitToken}` : `${base}/chair`); if (!r.ok) throw Error(`HTTP ${r.status}`); await r.text(); }); break;
      case "submit": if (submitToken) await timed("submit", async () => {
        const form = new FormData();
        const info = data ?? (await transport.read());
        const submitter = info.delegates.find((d) => d.committeeId === committee.id);
        form.set("token", submitToken); form.set("submissionId", crypto.randomUUID()); form.set("submitterId", submitter?.id ?? "");
        form.set("title", `Rehearsal ${user.id}`); form.set("googleDoc", `https://docs.google.com/document/d/rehearsal${String(user.id).padStart(4, "0")}${crypto.randomUUID().replaceAll("-", "")}/edit`);
        const r = await appFetch(`${base}/api/submissions`, { method: "POST", body: form });
        if (r.status === 429) throw Error("429 rate limited");
        if (r.status >= 400) throw Error(`HTTP ${r.status} ${await r.text()}`);
      }); break;
    }
  }
}
const stageReports = [];
for (const users of stages) {
  const scenario = buildScenario({ users, minutes, committees: fixture.committees.length, startWindowSeconds: Number(value("--start-window") ?? 150), submitFraction: submitToken ? Number(value("--submit-fraction") ?? 0.1) : 0 });
  const before = samples.length;
  console.log(`Stage: ${users} users for ${minutes} min against ${base} (Supabase ${ref})…`);
  const t0 = Date.now() + 1000;
  await Promise.all(scenario.map((u) => simulate(u, t0)));
  stageReports.push({ users, ...report(samples.slice(before)) });
}
// Exactly-once check: every acknowledged participation mutation produced exactly one event.
const final = await new SupabaseTransport(clientFor(), fixture.conference, session.user.id).read();
let duplicates = 0, lost = 0;
for (const id of acknowledged) {
  const n = final.events.filter((e) => e.id.startsWith(id.slice(0, 24))).length;
  if (n > 1) duplicates++; if (n === 0) lost++;
}
const overall = report(samples);
const verdict = evaluate(overall, duplicates, lost);
const result = { date: new Date().toISOString(), app: base, appBuild: health.app, supabaseProject: ref, distinctAuthIdentities: 1, note: "All simulated users share one pre-authorized test identity. This measures operational load, not fresh sign-up / shared-NAT behaviour (see STAGING_REHEARSAL.md phase D).", minutes, stages: stageReports, exactlyOnce: { acknowledgedParticipation: acknowledged.size, duplicates, lost }, verdict };
await mkdir(".test-sessions", { recursive: true, mode: 0o700 });
const file = `.test-sessions/rehearsal-${result.date.replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify({ ...result, samples }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
console.log(`Full report (with samples): ${file}`);
if (!verdict.pass) process.exitCode = 1;
