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
/** A synthetic delegation. Ids are derived here (not by the database) so fixture.json carries the exact rows that
 *  fixture.sql inserts — the public-form simulation needs real submitter ids. Delegates never get an Auth identity. */
export interface FixtureDelegate { id: string; committee: string; session: string }
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
  // Spread round-robin across the real committees, as before; deterministic for one conference id.
  const delegates: FixtureDelegate[] = Array.from({ length: o.delegates }, (_, i) => {
    const c = committees[i % o.committees];
    return { id: derivedUuid(`${conference}:delegate:${i}`), committee: c.id, session: c.session };
  });
  if (multi && o.delegates < o.committees) throw Error('Readiness fixture needs at least one delegate per committee.');
  const workflowDocuments = committees.flatMap(c => {
    const submitter = delegates.find(d => d.committee === c.id);
    return !submitter ? [] : ['Draft','Review','Approved','In Debate'].map((status, index) => ({
      id: derivedUuid(`${conference}:document:${c.id}:${index}`), version: derivedUuid(`${conference}:version:${c.id}:${index}`),
      committee: c.id, session: c.session, submitter: submitter.id, status, code: `${c.code} / SYN-${index + 1}`,
      googleDocId: `synthetic_${derivedUuid(`${conference}:doc-link:${c.id}:${index}`).replaceAll('-','')}`,
    }));
  });
  const school = derivedUuid(`${conference}:school`);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const grant = (user: string, role: string, committee: string | null) => ` (${q(conference)},${q(user)},'${role}',${committee ? q(committee) : "null"},now()+interval '${o.grantHours} hours',true)`;
  const label = multi ? `LOAD TEST · multi-committee · ${o.committees} committees` : `LOAD TEST · LEGACY single-committee floors · ${o.committees} committees`;
  const sessionRows = [
    ...committees.map((c) => ` (${q(c.session)},${q(conference)},${q(c.id)},'Simulation',now(),'active')`),
    ...floors.slice(1).map((f, i) => ` (${q(f)},${q(conference)},${q(chairCommittee.id)},'Simulation floor ${i + 1}',now(),'active')`),
  ];
  const sql = `-- Fresh synthetic rehearsal conference (DEVELOPMENT project only). Mode: ${multi ? "multi-committee (readiness)" : "LEGACY single-committee floors (NOT a readiness fixture)"}.
begin;
select private.lock_lifecycle();
do $phase$begin
 if not private.lifecycle_allows(true) then raise exception 'Synthetic fixture refused: lifecycle is not preproduction'; end if;
end $phase$;
insert into public.conferences(id,name,venue,date) values(${q(conference)},${q(label)},'Development only',current_date);
insert into public.schools(id,conference_id,name) values(${q(school)},${q(conference)},'Load test school');
insert into public.committees(id,conference_id,code,name,room) values
${committees.map((c) => ` (${q(c.id)},${q(conference)},${q(c.code)},${q(`Load test ${c.code}`)},'Simulation')`).join(",\n")};
insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values
${sessionRows.join(",\n")};
insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email) values
${delegates.map((d, i) => ` (${q(d.id)},${q(conference)},${q(d.committee)},${q(school)},'Country ${i}','Simulated delegate ${i}','load${i}@example.com')`).join(",\n")};
-- Current session and valid synthetic workflow states are prerequisites, not events invented by the load runner.
update public.committees set "currentSessionId"=s.id from public.sessions s where committees.id=s.committee_id and s.conference_id=${q(conference)} and s.id in (${committees.map(c=>q(c.session)).join(',')});
insert into public.attendance(conference_id,committee_id,"sessionId","delegateId",status) values
${delegates.map(d=>` (${q(conference)},${q(d.committee)},${q(d.session)},${q(d.id)},'Present')`).join(",\n")};
insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title,status) values
${workflowDocuments.map(d=>` (${q(d.id)},${q(conference)},${q(d.committee)},${q(d.session)},${q(d.submitter)},${q(d.code)},'Synthetic load-test document',${q(d.status)})`).join(",\n")};
insert into public.document_versions(id,conference_id,committee_id,"documentId",number,"fileName",text) values
${workflowDocuments.map(d=>` (${q(d.version)},${q(conference)},${q(d.committee)},${q(d.id)},1,'Google Doc','Synthetic registration only; no Google document was created or fetched.')`).join(",\n")};
insert into public.resolution_links(document_id,conference_id,committee_id,working_doc_id) values
${workflowDocuments.map(d=>` (${q(d.id)},${q(conference)},${q(d.committee)},${q(d.googleDocId)})`).join(",\n")};
insert into public.scoring_definitions(conference_id,code,label,values) values(${q(conference)},'speech','Speech',array[1,2,3]);
insert into public.user_access(conference_id,user_id,role,committee_id,expires_at,test_only) values
${[...chairGrants.map((g) => grant(g.user, "chair", g.committee)), grant(o.users.approval, "approval", null), grant(o.users.admins, "logistics", null), grant(o.users.executive, "admin", null)].join(",\n")};
commit;
`;
  return { conference, workflowDocuments, cleanup: cleanupSql(conference), mode: multi ? "multi-committee" as const : "legacy-floors" as const, committees, delegates, chairGrants, chairCommittee, floors, sql };
}
/**
 * Safe cleanup for ONE fixture conference: revokes every grant and link scoped to that conference id and nothing else.
 * It deletes no rows (audit, receipts and procedure history are append-only), so the labelled TEST data stays for review and
 * is removed later by the cutover step in docs/DEPLOYMENT.md. Every statement is filtered by the conference id.
 */
export function cleanupSql(conference: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(conference)) throw Error("cleanupSql needs a conference UUID");
  return `-- Revoke all access to the LOAD TEST conference ${conference} (and only that conference). Deletes nothing.
begin;
select private.lock_lifecycle();
do $phase$begin
 if not private.lifecycle_allows(true) then raise exception 'Synthetic fixture refused: lifecycle is not preproduction'; end if;
end $phase$;
update public.user_access set revoked_at=now() where conference_id='${conference}' and revoked_at is null;
update public.submission_links set revoked_at=now() where conference_id='${conference}' and revoked_at is null;
update public.amendment_links set revoked_at=now() where conference_id='${conference}' and revoked_at is null;
update private.access_credentials set revoked_at=now() where conference_id='${conference}' and revoked_at is null;
commit;
-- Verify (expect 0): select count(*) from public.user_access where conference_id='${conference}' and revoked_at is null;
`;
}
/** The harness/probe `--fixture` file: ids only (committees, sessions, delegates); no users, tokens or secrets. */
export function fixtureJson(f: ReturnType<typeof buildFixture>) {
  return { conference: f.conference, mode: f.mode, committees: f.committees, delegates: f.delegates };
}
