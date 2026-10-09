// Prepares the rehearsal identity pool for a REALISTIC MULTI-COMMITTEE rehearsal (DEVELOPMENT project only).
//   npx tsx scripts/rehearsal-identities.mts --chairs 14 [--pace-seconds 20] [--dir .test-sessions/rehearsal]
//        [--out .test-sessions/rehearsal-multi-identities.json]
// Creates (or refreshes) one anonymous Supabase session per Chair — one per simulated real committee — plus one each for
// Approval, Admins and Executive. Existing session files are refreshed, never replaced; only missing ones sign in.
// New anonymous sign-ins are paced (default one every 20 s) and capped at 25 per run, below Supabase's default
// 30 anonymous sign-ins per IP per hour; rerun later to finish a larger pool.
// Grants nothing: scripts/rehearsal-fixture.mts --identities <out> grants Chair k → committee k for one fresh conference.
// Session files are written mode 0600 under the git-ignored .test-sessions/; tokens are never printed.
import { createClient } from "@supabase/supabase-js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_PACE_SECONDS, MAX_NEW_SIGN_INS_PER_RUN, checkPoolDir, planPool } from "./rehearsal/identity-pool";
const DEV_REF = "opmydpozhdgkpcnjwpqb";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const env = Object.fromEntries((await readFile(".env.local", "utf8")).split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${DEV_REF}.supabase.co`) { console.error("Refused: .env.local must point at the DEVELOPMENT Supabase project. There is no override."); process.exit(2); }
let plan!: ReturnType<typeof planPool>;
let out!: string;
try {
  plan = planPool(Number(value("--chairs") ?? 14), value("--dir") ?? ".test-sessions/rehearsal");
  out = checkPoolDir(value("--out") ?? ".test-sessions/rehearsal-multi-identities.json");
} catch (e) { console.error((e as Error).message); process.exit(2); }
const pace = Math.max(DEFAULT_PACE_SECONDS, Number(value("--pace-seconds") ?? DEFAULT_PACE_SECONDS)) * 1000;
const client = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const exists = (path: string) => access(path).then(() => true, () => false);
const dir = plan.entries[0].path.slice(0, plan.entries[0].path.lastIndexOf("/"));
await mkdir(dir, { recursive: true, mode: 0o700 });
let created = 0, refreshed = 0, skipped = 0;
for (const entry of plan.entries) {
  if (await exists(entry.path)) {
    const saved = JSON.parse(await readFile(entry.path, "utf8"));
    const { data, error } = await client().auth.refreshSession({ refresh_token: saved.refresh_token });
    if (error || !data.session) { console.error(`Could not refresh ${entry.label} (${entry.path}): ${error?.message}. Move the file aside to create a new identity.`); process.exit(1); }
    await writeFile(entry.path, JSON.stringify(data.session), { mode: 0o600 });
    refreshed++;
    continue;
  }
  if (created >= MAX_NEW_SIGN_INS_PER_RUN) { skipped++; continue; }
  if (created > 0) await new Promise((r) => setTimeout(r, pace)); // conservative pacing between anonymous sign-ins
  const { data, error } = await client().auth.signInAnonymously();
  if (error || !data.session) { console.error(`Anonymous sign-in failed for ${entry.label}: ${error?.message}. Stop and retry later; do not loop.`); process.exit(1); }
  await writeFile(entry.path, JSON.stringify(data.session), { mode: 0o600 });
  created++;
  console.log(`${entry.label}: prepared (${created} new)`);
}
await writeFile(out, JSON.stringify(plan.template, null, 1), { mode: 0o600 });
console.log(JSON.stringify({ project: DEV_REF, chairs: plan.template.chairs.length, created, refreshed, pendingNextRun: skipped, identities: out, next: skipped ? `Rerun later (≥ 1 hour) to prepare the remaining ${skipped}.` : `npx tsx scripts/rehearsal-fixture.mts --identities ${out} --committees ${plan.template.chairs.length}` }, null, 1));
if (skipped) process.exitCode = 3;
