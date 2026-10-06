// Prepares a FRESH synthetic conference for one performance run, using the EXISTING role-scoped identities.
//   npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-identities.json
//        [--committees 14] [--delegates 420] [--floors 14] [--grant-hours 3]
// Writes only local files (no network, no Auth, no database access):
//   .test-sessions/fixtures/<conference>/fixture.json     → harness/probe --fixture
//   .test-sessions/fixtures/<conference>/identities.json  → harness/probe --identities (same session files, new scope)
//   .test-sessions/fixtures/<conference>/fixture.sql      → apply to the DEVELOPMENT project (SQL editor / MCP)
// The SQL creates the conference, committees, one session per committee, the extra Chair floor sessions, delegations,
// the speech scoring definition, and temporary single-role grants (Chair scoped to ONE committee; Approval only
// Approval; Admins only Logistics; Executive only Admin) for the identities' existing Auth users. It never creates
// Auth users, never writes tokens, and never touches the identities' session files.
//
// Floors: the scoped Chair identity holds one committee, so simulated committees run as independent floors (one
// session each) inside it. Floor session ids are derived deterministically from the conference id.
import { randomUUID } from "node:crypto";
import { buildFixture } from "./rehearsal/fixture";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ScopedFile } from "./rehearsal/identities";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const int = (flag: string, fallback: number, max: number) => {
  const n = Number(value(flag) ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) { console.error(`${flag} must be a whole number 1–${max}`); process.exit(2); }
  return n;
};
const template = value("--identities");
if (!template) { console.error("Pass --identities <existing rehearsal-identities.json> (its session files are reused, not copied)."); process.exit(2); }
const committeesCount = int("--committees", 14, 40), delegatesCount = int("--delegates", 420, 2000), floorsCount = int("--floors", 14, 40), hours = int("--grant-hours", 3, 12);
const ids = JSON.parse(await readFile(template, "utf8")) as ScopedFile;
// Only the Auth user id is read from each session file; tokens are never copied or printed.
const userId = async (path: string) => {
  const id = (JSON.parse(await readFile(path, "utf8")) as { user?: { id?: string } }).user?.id;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) { console.error(`No Auth user id in ${path}`); process.exit(2); }
  return id;
};
const users = { chair: await userId(ids.chair.session), approval: await userId(ids.approval.session), admins: await userId(ids.admins.session), executive: await userId(ids.executive.session) };
const fixture = buildFixture({ conference: randomUUID(), committees: committeesCount, delegates: delegatesCount, floors: floorsCount, grantHours: hours, users });
const { conference, committees, chairCommittee, floors, sql } = fixture;
const dir = `.test-sessions/fixtures/${conference}`;
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(`${dir}/fixture.json`, JSON.stringify({ conference, committees, delegates: [], note: "Delegations are generated server-side; public-form runs need a fixture with delegate ids." }, null, 1), { mode: 0o600 });
await writeFile(`${dir}/identities.json`, JSON.stringify({ ...ids, chair: { ...ids.chair, committee: chairCommittee.id, sessions: floors } }, null, 1), { mode: 0o600 });
await writeFile(`${dir}/fixture.sql`, sql, { mode: 0o600 });
console.log(JSON.stringify({ conference, committees: committeesCount, delegates: delegatesCount, floors: floors.length, grantHours: hours, files: [`${dir}/fixture.json`, `${dir}/identities.json`, `${dir}/fixture.sql`], next: "Apply fixture.sql to the DEVELOPMENT project, then pass --fixture and --identities from this folder to rehearsal-snapshots.mts and rehearsal-run.mts." }, null, 1));
