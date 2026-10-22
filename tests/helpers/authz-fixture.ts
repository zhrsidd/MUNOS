import type {Engine} from './authz-engine';

export type ConfRole = 'chair' | 'approval' | 'logistics' | 'admin' | 'observer';
/** A committee a grant (or a command) is scoped to; null is conference-wide. */
export type Scope = 'ga1' | 'who' | 'sc' | null;
export type DbRole = 'anon' | 'authenticated' | 'service_role';
export interface Grant {role: ConfRole; scope: Scope; conf: 'A' | 'B'; state: 'active' | 'revoked' | 'expired'}
export interface Actor {
 name: string;
 db: DbRole;
 /** JWT subject; null means no `sub` claim (PostgREST anon, or a service-role key). */
 sub: string | null;
 grant?: Grant;
 /** service_role given EXECUTE on public.* as Supabase default privileges would (the inventory's model baseline). */
 modelExecute?: boolean;
}

const uid = (n: number) => `7a000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const user = (name: string, n: number, grant?: Grant): Actor => ({name, db: 'authenticated', sub: uid(n), grant});
const g = (role: ConfRole, scope: Scope = null, state: Grant['state'] = 'active', conf: Grant['conf'] = 'A'): Grant => ({role, scope, conf, state});

/** Every principal the matrix exercises. The user grants are fixtures committed once; cells only vary the caller. */
export const ACTORS = {
 anon: {name: 'anon', db: 'anon', sub: null},
 authNoSub: {name: 'authenticated, no sub claim', db: 'authenticated', sub: null},
 service: {name: 'service_role', db: 'service_role', sub: null},
 serviceSub: {name: 'service_role carrying an Executive sub', db: 'service_role', sub: uid(2)},
 serviceModel: {name: 'service_role with default-privilege EXECUTE', db: 'service_role', sub: null, modelExecute: true},
 noGrant: user('authenticated, no grant', 1),
 exec: user('Executive (admin, conference-wide)', 2, g('admin')),
 execGa1: user('admin scoped to GA1', 3, g('admin', 'ga1')),
 chairGa1: user('Chair GA1', 4, g('chair', 'ga1')),
 chairWho: user('Chair WHO', 5, g('chair', 'who')),
 approval: user('Approval Panel', 6, g('approval')),
 logistics: user('Logistics (Admins)', 7, g('logistics')),
 observer: user('Observer', 8, g('observer')),
 execRevoked: user('Executive, revoked', 9, g('admin', null, 'revoked')),
 chairRevoked: user('Chair GA1, revoked', 10, g('chair', 'ga1', 'revoked')),
 approvalRevoked: user('Approval, revoked', 11, g('approval', null, 'revoked')),
 logisticsRevoked: user('Logistics, revoked', 12, g('logistics', null, 'revoked')),
 execExpired: user('Executive, expired', 13, g('admin', null, 'expired')),
 chairExpired: user('Chair GA1, expired', 14, g('chair', 'ga1', 'expired')),
 approvalExpired: user('Approval, expired', 15, g('approval', null, 'expired')),
 logisticsExpired: user('Logistics, expired', 16, g('logistics', null, 'expired')),
 execB: user('Executive of another conference', 17, g('admin', null, 'active', 'B')),
 chairB: user('Chair of another conference', 18, g('chair', 'ga1', 'active', 'B')),
} satisfies Record<string, Actor>;
export type ActorKey = keyof typeof ACTORS;
export const ACTOR_KEYS = Object.keys(ACTORS) as ActorKey[];
/** Users with no browser-reachable function privilege at all (denied before any function body runs). */
export const NO_EXECUTE: ActorKey[] = ['anon', 'service', 'serviceSub'];
/** Redemption targets: fresh users that hold nothing. */
export const DEVICES = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39].map(uid);
export const SERVICE_SUB_USER = uid(2);

export interface Fixture {
 ids: Record<string, string>;
 /** Conference A (the seeded one) and conference B. */
 confA: string; confB: string;
 committee: Record<'ga1' | 'who' | 'sc', string>;
 session: string; sessionWho: string;
 france: string; japan: string; brazilWho: string;
 resolution: string; docReview: string; docApproved: string; docSubmitted: string; docDraft: string;
 schoolA: string; chairStaff: string; photoSlot: string; participationEvent: string;
 submissionToken: string; revokedSubmissionToken: string; amendmentToken: string;
 submissionLink: string; amendmentLink: string;
}

const CONF_B = '7b000000-0000-4000-8000-0000000000b0';
const COMMITTEE_B = '7b000000-0000-4000-8000-0000000000b1';
const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Install the test-only probe and every fixture row. `ids` is the seeded fixture-ids.json. */
export async function installFixture(engine: Engine, ids: Record<string, string>): Promise<Fixture> {
 const f: Fixture = {
  ids, confA: ids.conference, confB: CONF_B,
  committee: {ga1: ids.ga1, who: ids.who, sc: ids.sc},
  session: ids.session, sessionWho: '', france: ids.france, japan: ids.japan, brazilWho: '',
  resolution: ids.resolution, docReview: '', docApproved: '', docSubmitted: '', docDraft: '7c000000-0000-4000-8000-000000000001',
  schoolA: '', chairStaff: '', photoSlot: '7c000000-0000-4000-8000-000000000002', participationEvent: '7c000000-0000-4000-8000-000000000003',
  submissionToken: 'sub_valid_token_aaaaaaaaaaaaaa', revokedSubmissionToken: 'sub_revoked_token_bbbbbbbbbbbb', amendmentToken: 'amend_valid_token_cccccccccccc',
  submissionLink: '7c000000-0000-4000-8000-000000000004', amendmentLink: '7c000000-0000-4000-8000-000000000005',
 };
 // Lookups of seeded rows, by their stable seed codes.
 const found = JSON.parse(await engine.run(`select json_build_object(
  'sessionWho',(select id from public.sessions where committee_id=${q(ids.who)} limit 1),
  'brazilWho',(select id from public.delegates where committee_id=${q(ids.who)} and country='Brazil'),
  'docReview',(select id from public.documents where code='GA1 / 02'),
  'docApproved',(select id from public.documents where code='WHO / 01'),
  'docSubmitted',(select id from public.documents where code='SC / 01'),
  'schoolA',(select id from public.schools order by name limit 1),
  'chairStaff',(select s.id from public.staff s join public.conference_staff r on r.staff_id=s.id and r.role='chair' limit 1))::text`)) as Record<string, string>;
 Object.assign(f, found);

 const users = [...ACTOR_KEYS.map(k => ACTORS[k].sub), ...DEVICES].filter((s): s is string => !!s);
 const grants = ACTOR_KEYS.map(k => ({a: ACTORS[k] as Actor})).filter(x => x.a.grant).map(({a}) => {
  const grant = a.grant!;
  const conf = grant.conf === 'A' ? f.confA : f.confB;
  const scope = grant.scope === null ? 'null' : q(grant.conf === 'B' ? COMMITTEE_B : f.committee[grant.scope]);
  const expires = grant.state === 'expired' ? "now() - interval '1 hour'" : "now() + interval '30 days'";
  const revoked = grant.state === 'revoked' ? 'now()' : 'null';
  return `(${q(conf)},${q(a.sub!)},${q(grant.role)},${scope},${expires},${revoked})`;
 });
 await engine.run(`
  create schema authz_probe;
  grant usage on schema authz_probe to anon, authenticated, service_role;
  -- Runs one statement as the CURRENT role, never as the table owner, and records the outcome instead of aborting.
  create function authz_probe.attempt(call_sql text) returns void language plpgsql as $f$
  declare v text;
  begin
   begin
    execute 'select (' || call_sql || ')::text' into v;
    perform set_config('authz.code', 'ok', true);
    perform set_config('authz.msg', coalesce(v, ''), true);
   exception when others then
    perform set_config('authz.code', sqlstate, true);
    perform set_config('authz.msg', sqlerrm, true);
   end;
  end $f$;
  grant execute on function authz_probe.attempt(text) to anon, authenticated, service_role;

  insert into auth.users(id) values ${users.map(u => `(${q(u)})`).join(',')} on conflict do nothing;
  insert into public.conferences(id,name,venue,date) values (${q(CONF_B)},'Other conference','Elsewhere','2026-11-05');
  insert into public.committees(id,conference_id,code,name,room) values (${q(COMMITTEE_B)},${q(CONF_B)},'BC1','Committee B','R1');
  insert into public.user_access(conference_id,user_id,role,committee_id,expires_at,revoked_at) values ${grants.join(',')};
  -- Rows the commands act on. All of them live in conference A.
  insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title,status)
   values (${q(f.docDraft)},${q(f.confA)},${q(ids.ga1)},${q(ids.session)},${q(ids.france)},'GA1 / DRAFT','Draft fixture','Draft');
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","categoryId",points,"chairId")
   values (${q(f.participationEvent)},${q(f.confA)},${q(ids.ga1)},${q(ids.france)},${q(ids.session)},'speech',2,${q(uid(4))});
  insert into public.photo_slots(id,conference_id,school_id,starts_at,location) values (${q(f.photoSlot)},${q(f.confA)},${q(f.schoolA)},'2026-11-06T10:00:00Z','Hall');
  insert into public.submission_links(id,conference_id,committee_id,token,share_with) values (${q(f.submissionLink)},${q(f.confA)},${q(ids.ga1)},${q(f.submissionToken)},'');
  insert into public.submission_links(conference_id,committee_id,token,share_with,revoked_at) values (${q(f.confA)},${q(ids.who)},${q(f.revokedSubmissionToken)},'',now());
  insert into public.amendment_links(id,conference_id,committee_id,token) values (${q(f.amendmentLink)},${q(f.confA)},${q(ids.ga1)},${q(f.amendmentToken)});
 `);
 return f;
}
