// Prepares a FRESH synthetic conference for one performance run, using EXISTING rehearsal identities.
//
// Realistic multi-committee (READINESS) — identities template from scripts/rehearsal-identities.mts:
//   npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-identities.json
//        [--committees 14] [--delegates 420] [--grant-hours 3]
//   Creates N real committees, one normal session each, and N Chair grants: Chair identity k → committee k
//   (role chair, committee_id = committee k). Needs at least N distinct Chair identities in the template.
//
// Legacy single-committee floors (HISTORICAL comparison only; never a readiness run):
//   npx tsx scripts/rehearsal-fixture.mts --identities <legacy file with "chair"> --legacy-floors [--floors 14] …
//   One Chair grant scoped to committee 0; simulated committees are extra floor sessions inside committee 0, so every
//   Chair write serializes on one committees row (this overstated shared-row contention in earlier runs).
//
// Writes only local files (no network, no Auth, no database access):
//   .test-sessions/fixtures/<conference>/fixture.json     → harness/probe --fixture
//   .test-sessions/fixtures/<conference>/identities.json  → harness/probe --identities (same session files, new scope)
//   .test-sessions/fixtures/<conference>/fixture.sql      → apply to the DEVELOPMENT project (SQL editor / MCP)
// The SQL creates the conference, committees, sessions, delegations, the speech scoring definition and temporary
// single-role grants for the identities' existing Auth users. It never creates Auth users, never writes tokens, and
// never touches the identities' session files.
// Delegates get deterministic ids (derivedUuid(`${conference}:delegate:${i}`)), spread round-robin over the real
// committees; fixture.sql inserts exactly those ids and fixture.json lists them ({ id, committee, session }), so the
// harness submits as real fixture delegates. Delegates never get an Auth user or session.
import { randomUUID } from "node:crypto";
import { buildFixture, fixtureJson } from "./rehearsal/fixture";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isMultiCommittee, type IdentityFile } from "./rehearsal/identities";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const int = (flag: string, fallback: number, max: number) => {
  const n = Number(value(flag) ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) { console.error(`${flag} must be a whole number 1–${max}`); process.exit(2); }
  return n;
};
const template = value("--identities");
if (!template) { console.error("Pass --identities <rehearsal-identities.json> (its session files are reused, not copied)."); process.exit(2); }
const committeesCount = int("--committees", 14, 40), delegatesCount = int("--delegates", 420, 2000), hours = int("--grant-hours", 3, 12);
const ids = JSON.parse(await readFile(template, "utf8")) as IdentityFile;
// Only the Auth user id is read from each session file; tokens are never copied or printed.
const userId = async (path: string) => {
  const id = (JSON.parse(await readFile(path, "utf8")) as { user?: { id?: string } }).user?.id;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) { console.error(`No Auth user id in ${path}`); process.exit(2); }
  return id;
};
const support = { approval: await userId(ids.approval.session), admins: await userId(ids.admins.session), executive: await userId(ids.executive.session) };
const conference = randomUUID();
const dir = `.test-sessions/fixtures/${conference}`;
let fixture!: ReturnType<typeof buildFixture>;
let runIdentities: unknown;
if (isMultiCommittee(ids)) {
  if (args.includes("--legacy-floors")) { console.error("--legacy-floors needs a legacy single-Chair identities file."); process.exit(2); }
  if (ids.chairs.length < committeesCount) { console.error(`Readiness fixture needs one Chair identity per committee: ${ids.chairs.length} Chair identities for ${committeesCount} committees. Prepare more with scripts/rehearsal-identities.mts --chairs ${committeesCount}.`); process.exit(2); }
  const chairs = ids.chairs.slice(0, committeesCount);
  const chairUsers = await Promise.all(chairs.map((c) => userId(c.session)));
  if (new Set(chairUsers).size !== chairUsers.length) { console.error("Chair identities must be distinct Auth users (one per committee)."); process.exit(2); }
  try { fixture = buildFixture({ mode: "multi-committee", conference, committees: committeesCount, delegates: delegatesCount, grantHours: hours, users: { chairs: chairUsers, ...support } }); }
  catch (e) { console.error((e as Error).message); process.exit(2); }
  runIdentities = { mode: "multi-committee", chairs: chairs.map((c, k) => ({ session: c.session, committee: fixture.committees[k].id })), approval: ids.approval, admins: ids.admins, executive: ids.executive };
} else {
  if (!args.includes("--legacy-floors")) { console.error("This identities file has a single Chair identity (legacy). A readiness fixture needs one Chair identity per committee: prepare them with scripts/rehearsal-identities.mts. For a historical single-committee comparison, pass --legacy-floors explicitly."); process.exit(2); }
  const floorsCount = int("--floors", 14, 40);
  fixture = buildFixture({ mode: "legacy-floors", conference, committees: committeesCount, delegates: delegatesCount, floors: floorsCount, grantHours: hours, users: { chair: await userId(ids.chair.session), ...support } });
  runIdentities = { ...ids, chair: { ...ids.chair, committee: fixture.chairCommittee.id, sessions: fixture.floors } };
}
const { delegates, floors, sql, mode, chairGrants } = fixture;
await mkdir(dir, { recursive: true, mode: 0o700 });
// fixture.json carries the exact delegate ids fixture.sql inserts (public-form submitters); no Auth users, no tokens.
await writeFile(`${dir}/fixture.json`, JSON.stringify(fixtureJson(fixture), null, 1), { mode: 0o600 });
await writeFile(`${dir}/identities.json`, JSON.stringify(runIdentities, null, 1), { mode: 0o600 });
await writeFile(`${dir}/fixture.sql`, sql, { mode: 0o600 });
console.log(JSON.stringify({ conference, mode, readinessFixture: mode === "multi-committee", committees: committeesCount, delegatesInFixtureJson: delegates.length, chairGrants: chairGrants.length, distinctChairUsers: new Set(chairGrants.map((g) => g.user)).size, floors: floors.length || undefined, delegates: delegatesCount, grantHours: hours, files: [`${dir}/fixture.json`, `${dir}/identities.json`, `${dir}/fixture.sql`], next: "Apply fixture.sql to the DEVELOPMENT project, then pass --fixture and --identities from this folder to rehearsal-snapshots.mts and rehearsal-run.mts." }, null, 1));
