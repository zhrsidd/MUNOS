// Fresh synthetic rehearsal conference: deterministic ids and the development-only SQL. Pure; no I/O.
import { createHash } from "node:crypto";
export interface FixtureUsers { chair: string; approval: string; admins: string; executive: string }
export interface FixtureOptions { conference: string; committees: number; delegates: number; floors: number; grantHours: number; users: FixtureUsers }
export function derivedUuid(seed: string) {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const CODES = ["GA1", "WHO", "HRC", "SC", "GA2", "GA3", "ECOSOC", "UNEP", "UNHCR", "ICJ", "UNSC2", "UNODC", "UNESCO", "CSW"];
export function buildFixture(o: FixtureOptions) {
  const { conference } = o;
  const committees = Array.from({ length: o.committees }, (_, i) => ({ id: derivedUuid(`${conference}:committee:${i}`), session: derivedUuid(`${conference}:session:${i}`), code: CODES[i] ?? `C${i + 1}` }));
  const chairCommittee = committees[0];
  const floors = [chairCommittee.session, ...Array.from({ length: o.floors - 1 }, (_, i) => derivedUuid(`${conference}:floor:${i + 1}`))];
  const school = derivedUuid(`${conference}:school`);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const grant = (user: string, role: string, committee: string | null) => ` (${q(conference)},${q(user)},'${role}',${committee ? q(committee) : "null"},now()+interval '${o.grantHours} hours')`;
  const sql = `-- Fresh synthetic rehearsal conference (DEVELOPMENT project only).
begin;
insert into public.conferences(id,name,venue,date) values(${q(conference)},${q(`LOAD TEST · fresh · ${o.committees} committees`)},'Development only',current_date);
insert into public.schools(id,conference_id,name) values(${q(school)},${q(conference)},'Load test school');
insert into public.committees(id,conference_id,code,name,room) values
${committees.map((c) => ` (${q(c.id)},${q(conference)},${q(c.code)},${q(`Load test ${c.code}`)},'Simulation')`).join(",\n")};
insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values
${[...committees.map((c) => ` (${q(c.session)},${q(conference)},${q(c.id)},'Simulation',now(),'active')`), ...floors.slice(1).map((f, i) => ` (${q(f)},${q(conference)},${q(chairCommittee.id)},'Simulation floor ${i + 1}',now(),'active')`)].join(",\n")};
insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email)
 select gen_random_uuid(),${q(conference)},(array[${committees.map((c) => q(c.id) + "::uuid").join(",")}])[1 + i % ${o.committees}],${q(school)},'Country '||i,'Simulated delegate '||i,'load'||i||'@example.com'
 from generate_series(0,${o.delegates - 1}) i;
insert into public.scoring_definitions(conference_id,code,label,values) values(${q(conference)},'speech','Speech',array[1,2,3]);
insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values
${[grant(o.users.chair, "chair", chairCommittee.id), grant(o.users.approval, "approval", null), grant(o.users.admins, "logistics", null), grant(o.users.executive, "admin", null)].join(",\n")};
commit;
`;
  return { conference, committees, chairCommittee, floors, sql };
}
