// Fresh synthetic rehearsal conference: deterministic ids and the development-only SQL. Pure; no I/O.
//
// mode "multi-committee" (readiness): N real committees, each with ONE normal session and its OWN Chair grant —
//   chair user k → committee k (role chair, committee_id = committee k). No floor sessions.
// mode "legacy-floors" (historical/worst-case only): ONE Chair grant scoped to committee 0; simulated committees are
//   extra "floor" sessions inside committee 0, so all Chair writes serialize on one committees row. Not a readiness run.
import { createHash } from "node:crypto";
export interface SupportUsers { approval: string; admins: string; executive: string }
export interface MultiCommitteeUsers extends SupportUsers { chairs: string[] }
export interface LegacyUsers extends SupportUsers { chair: string }
interface BaseOptions { conference: string; committees: number; delegates: number; grantHours: number }
export type FixtureOptions =
  | (BaseOptions & { mode: "multi-committee"; users: MultiCommitteeUsers })
  | (BaseOptions & { mode?: "legacy-floors"; floors: number; users: LegacyUsers });
export interface ChairGrant { user: string; committee: string; committeeIndex: number }
export function derivedUuid(seed: string) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const CODES = ["GA1", "WHO", "HRC", "SC", "GA2", "GA3", "ECOSOC", "UNEP", "UNHCR", "ICJ", "UNSC2", "UNODC", "UNESCO", "CSW"];
export function buildFixture(o: FixtureOptions) {
  const { conference } = o;
  const multi = o.mode === "multi-committee";
  const committees = Array.from({ length: o.committees }, (_, i) => ({ id: derivedUuid(`${conference}:committee:${i}`), session: derivedUuid(`${conference}:session:${i}`), code: CODES[i] ?? `C${i + 1}` }));
  let chairGrants: ChairGrant[];
  let floors: string[] = [];
  if (multi) {
    const chairs = o.users.chairs;
    if (chairs.length < o.committees) throw Error(`Multi-committee fixture needs one Chair user per committee: ${chairs.length} Chair users for ${o.committees} committees.`);
    if (new Set(chairs.slice(0, o.committees)).size !== o.committees) throw Error("Multi-committee fixture needs DISTINCT Chair users (one per committee).");
    chairGrants = committees.map((c, k) => ({ user: chairs[k], committee: c.id, committeeIndex: k }));
  } else {
    chairGrants = [{ user: o.users.chair, committee: committees[0].id, committeeIndex: 0 }];
    floors = [committees[0].session, ...Array.from({ length: o.floors - 1 }, (_, i) => derivedUuid(`${conference}:floor:${i + 1}`))];
  }
  const chairCommittee = committees[0];
  const school = derivedUuid(`${conference}:school`);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const grant = (user: string, role: string, committee: string | null) => ` (${q(conference)},${q(user)},'${role}',${committee ? q(committee) : "null"},now()+interval '${o.grantHours} hours')`;
  const label = multi ? `LOAD TEST · multi-committee · ${o.committees} committees` : `LOAD TEST · LEGACY single-committee floors · ${o.committees} committees`;
  const sessionRows = [
    ...committees.map((c) => ` (${q(c.session)},${q(conference)},${q(c.id)},'Simulation',now(),'active')`),
    ...floors.slice(1).map((f, i) => ` (${q(f)},${q(conference)},${q(chairCommittee.id)},'Simulation floor ${i + 1}',now(),'active')`),
  ];
  const sql = `-- Fresh synthetic rehearsal conference (DEVELOPMENT project only). Mode: ${multi ? "multi-committee (readiness)" : "LEGACY single-committee floors (NOT a readiness fixture)"}.
begin;
insert into public.conferences(id,name,venue,date) values(${q(conference)},${q(label)},'Development only',current_date);
insert into public.schools(id,conference_id,name) values(${q(school)},${q(conference)},'Load test school');
insert into public.committees(id,conference_id,code,name,room) values
${committees.map((c) => ` (${q(c.id)},${q(conference)},${q(c.code)},${q(`Load test ${c.code}`)},'Simulation')`).join(",\n")};
insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values
${sessionRows.join(",\n")};
insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email)
 select gen_random_uuid(),${q(conference)},(array[${committees.map((c) => q(c.id) + "::uuid").join(",")}])[1 + i % ${o.committees}],${q(school)},'Country '||i,'Simulated delegate '||i,'load'||i||'@example.com'
 from generate_series(0,${o.delegates - 1}) i;
insert into public.scoring_definitions(conference_id,code,label,values) values(${q(conference)},'speech','Speech',array[1,2,3]);
insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values
${[...chairGrants.map((g) => grant(g.user, "chair", g.committee)), grant(o.users.approval, "approval", null), grant(o.users.admins, "logistics", null), grant(o.users.executive, "admin", null)].join(",\n")};
commit;
`;
  return { conference, mode: multi ? "multi-committee" as const : "legacy-floors" as const, committees, chairGrants, chairCommittee, floors, sql };
}
