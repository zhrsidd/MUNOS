import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { assertToolTarget } from '../../lib/platform/target-guard';
import { checkAppUrl, checkHealthEnvironment, checkFixtureConference } from '../rehearsal/guard';
import { SUBMISSION_TOKEN, type LinkInfo } from '../../lib/submissions/rules';
import type { AmendmentLinkInfo } from '../../lib/amendments/rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Env = Record<string, string | undefined>;
export interface PublicQrFixture {
  version: 1;
  purpose: 'synthetic-public-qr';
  projectRef: string;
  conferenceId: string;
  appOrigin: string;
  expectedAppCommit?: string;
  resolution: { token: string; committeeId: string; submitterId: string };
  amendment: { token: string; committeeId: string; submitterId: string; resolutionId: string };
  /** Optional existing role-scoped sessions. Omit to leave staff visibility explicitly unverified. */
  staff?: { chair: string; approval: string; logistics: string };
}
export interface PublicQrOptions { baseUrl: string; conferenceId: string; output: string }
export interface PublicQrPlan {
  fixture: PublicQrFixture;
  origin: string;
  projectRef: string;
  output: string;
  supabaseUrl: string;
}
export interface PublicQrReport {
  projectRef: string;
  conferenceId: string;
  appOrigin: string;
  startedAt: string;
  completedAt?: string;
  appBuild?: { environment: string; commit: string };
  status: 'running' | 'passed' | 'failed';
  checks: string[];
  created: { resolutionCodes: string[]; amendmentIds: string[] };
  limits: string[];
  failedCheck?: string;
}
export class QrVerificationError extends Error {}
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new QrVerificationError(message); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function origin(value: unknown): string {
  requireThat(typeof value === 'string', 'App origin must be an explicit URL.');
  let u: URL;
  try { u = new URL(value); } catch { throw new QrVerificationError('App origin must be an explicit URL.'); }
  requireThat(!u.username && !u.password && !u.search && !u.hash && u.pathname === '/', 'App URL must be an origin without credentials, path, query or fragment.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  requireThat((local && u.protocol === 'http:') || u.protocol === 'https:', 'Nonlocal apps require HTTPS.');
  return u.origin;
}
/** Pure preflight. No client construction, HTTP, session refresh, schema or environment changes. */
export function publicQrPlan(input: unknown, options: PublicQrOptions, env: Env, cwd = process.cwd()): PublicQrPlan {
  let projectRef: string;
  try { projectRef = assertToolTarget(env.NEXT_PUBLIC_SUPABASE_URL, env); } catch { throw new QrVerificationError('Target guard refused the project configuration; nothing was contacted.'); }
  requireThat(env.VERCEL_ENV !== 'production', 'Public QR verification never runs in a production environment.');
  requireThat(env.NEXT_PUBLIC_DATA_BACKEND === 'supabase', 'Public QR verification requires the Supabase backend.');
  requireThat(record(input) && input.version === 1 && input.purpose === 'synthetic-public-qr', 'Use a version 1 synthetic-public-qr fixture.');
  requireThat(input.projectRef === projectRef, 'Fixture project does not match the guarded Supabase project.');
  requireThat(typeof options.conferenceId === 'string' && UUID.test(options.conferenceId) && input.conferenceId === options.conferenceId, 'Fixture conference does not match the explicitly selected conference.');
  requireThat(checkFixtureConference(options.conferenceId, env).ok, 'Fixture conference is protected, or protected-conference configuration is invalid.');
  requireThat(checkAppUrl(options.baseUrl).ok, 'Use localhost or a nonproduction Vercel deployment/branch URL.');
  const appOrigin = origin(options.baseUrl);
  requireThat(input.expectedAppCommit === undefined || (typeof input.expectedAppCommit === 'string' && /^[a-f0-9]{40}$/.test(input.expectedAppCommit)), 'Optional expected app commit must be a complete lowercase commit SHA.');
  requireThat(origin(input.appOrigin) === appOrigin, 'Fixture app origin does not match the explicitly selected app.');
  const approved = (env.QR_VERIFICATION_APP_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean).map(origin);
  const production = (env.PRODUCTION_APP_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean).map(origin);
  requireThat(!production.includes(appOrigin), 'Production app origins are forbidden.');
  requireThat(approved.includes(appOrigin), 'App origin must be explicitly listed in QR_VERIFICATION_APP_ORIGINS.');
  for (const kind of ['resolution', 'amendment'] as const) {
    const link = input[kind];
    requireThat(record(link) && typeof link.token === 'string' && SUBMISSION_TOKEN.test(link.token), `Fixture ${kind} token is invalid.`);
    requireThat(typeof link.committeeId === 'string' && UUID.test(link.committeeId) && typeof link.submitterId === 'string' && UUID.test(link.submitterId), `Fixture ${kind} scope is invalid.`);
  }
  const resolution = input.resolution as Record<string, unknown>, amendment = input.amendment as Record<string, unknown>;
  requireThat(resolution.committeeId === amendment.committeeId, 'Use one synthetic committee for both QR links.');
  requireThat(resolution.token !== amendment.token, 'Resolution and amendment tokens must be distinct.');
  requireThat(typeof amendment.resolutionId === 'string' && UUID.test(amendment.resolutionId), 'Fixture amendment resolution is invalid.');
  if (input.staff !== undefined) {
    requireThat(record(input.staff) && ['chair', 'approval', 'logistics'].every(k => typeof (input.staff as Record<string, unknown>)[k] === 'string' && !!(input.staff as Record<string, unknown>)[k]), 'Optional staff sessions require chair, approval and logistics session-file paths.');
    requireThat(!!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Optional staff checks require the publishable key.');
  }
  const output = resolve(cwd, options.output);
  requireThat(['artifacts', '.test-sessions'].some(dir => within(resolve(cwd, dir), output)), 'Output must be inside artifacts/ or .test-sessions/, never tracked docs.');
  requireThat(output.endsWith('.json'), 'Output must be a JSON artifact.');
  return { fixture: input as unknown as PublicQrFixture, origin: appOrigin, projectRef, output, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL! };
}
export function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return !!path && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}
export function newPublicQrReport(plan: PublicQrPlan): PublicQrReport {
  return {
    projectRef: plan.projectRef, conferenceId: plan.fixture.conferenceId, appOrigin: plan.origin,
    startedAt: new Date().toISOString(), status: 'running', checks: [], created: { resolutionCodes: [], amendmentIds: [] },
    limits: ['Synthetic Google Doc IDs test registration only; actual document existence, sharing and Chair edit access are NOT verified.', 'No new PDF or file upload is performed. Historical attachment readability is not verified.', 'This smoke does not prove rate limits, link rotation, venue offline behavior or 110-device readiness.', 'The supplied app-origin binding is operator-approved configuration; the public health endpoint does not attest its backend identity.'],
  };
}
function safeClient(url: string, key: string, fetcher: typeof fetch, jwt?: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher, ...(jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {}) } });
}
async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>, label: string): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  requireThat(!error, label);
  return data as T;
}
/** Resolve both links before contacting the public app. The resolution link supplies conference identity. */
export function assertPublicQrLinks(plan: PublicQrPlan, resolution: LinkInfo | null, amendment: AmendmentLinkInfo | null): void {
  const f = plan.fixture;
  requireThat(resolution?.conferenceId === f.conferenceId && resolution?.committeeId === f.resolution.committeeId, 'Resolution link conference or committee does not match the fixture.');
  requireThat(resolution.submitters.some(d => d.id === f.resolution.submitterId), 'Resolution submitter is not in the fixture committee.');
  requireThat(amendment?.committee.id === f.amendment.committeeId && amendment?.resolution?.id === f.amendment.resolutionId, 'Amendment link or active resolution does not match the fixture.');
  requireThat(amendment.delegates.some(d => d.id === f.amendment.submitterId), 'Amendment submitter is not in the fixture committee.');
}
export type StaffTokens = { chair: string; approval: string; logistics: string };
/** Local tests can supply a fake fetch; no Google URL is fetched and public HTTP never receives a staff/server credential. */
export async function verifyPublicQr(plan: PublicQrPlan, env: Env, report: PublicQrReport, staff?: StaffTokens, fetcher: typeof fetch = fetch): Promise<void> {
  publicQrPlan(plan.fixture, { baseUrl: plan.origin, conferenceId: plan.fixture.conferenceId, output: plan.output }, env);
  requireThat(!!env.SUPABASE_SECRET_KEY, 'Server-only key is required for link checks.');
  const server = safeClient(plan.supabaseUrl, env.SUPABASE_SECRET_KEY!, fetcher);
  const f = plan.fixture;
  const mark = (name: string) => report.checks.push(name);
  const link = await rpc<LinkInfo | null>(server, 'submission_link_info', { link_token: f.resolution.token }, 'Resolution link lookup failed.');
  const amendment = await rpc<AmendmentLinkInfo | null>(server, 'amendment_link_info', { link_token: f.amendment.token }, 'Amendment link lookup failed.');
  assertPublicQrLinks(plan, link, amendment);
  mark('authoritative-link-conference-committee-submitters-and-open-resolution');
  const appFetch = async (path: string, init?: RequestInit) => {
    const response = await fetcher(`${plan.origin}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    requireThat(!response.headers.has('set-cookie'), 'Public QR response unexpectedly issued a cookie.');
    return response;
  };
  const healthResponse = await appFetch('/api/health');
  requireThat(healthResponse.status === 200, 'Public app health did not return 200.');
  const health = await healthResponse.json();
  requireThat(checkHealthEnvironment(health).ok, 'Public app health reports production or an unknown environment.');
  const commit = typeof health?.app?.commit === 'string' && /^[a-f0-9]{40}$/.test(health.app.commit) ? health.app.commit : '';
  requireThat(!f.expectedAppCommit || f.expectedAppCommit === commit, 'Public app build does not match the pinned commit.');
  report.appBuild = { environment: health.app.environment, commit };
  if (!f.expectedAppCommit) report.limits.push('App commit was not pinned in the fixture; this run alone is not final-candidate verification.');
  mark('app-health-nonproduction-build-and-optional-pinned-commit');
  for (const [path, text] of [[`/submit/${f.resolution.token}`, 'I have made sure the Chairs can edit this document.'], [`/amend/${f.amendment.token}`, 'I confirm this is the exact wording I want submitted.']]) {
    const page = await appFetch(path);
    requireThat(page.status === 200, 'Public QR page did not return 200.');
    const html = await page.text();
    requireThat(html.includes(text) && !html.includes(env.SUPABASE_SECRET_KEY!), 'Public QR page is unavailable or exposes server credentials.');
  }
  mark('resolution-and-amendment-pages-no-auth-cookie-or-server-key');
  const submissionId = randomUUID(), googleDocId = `qr_smoke_${randomUUID().replaceAll('-', '')}`, googleDoc = `https://docs.google.com/document/d/${googleDocId}/edit`;
  const postResolution = async (patch: Record<string, string> = {}, file = false) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ token: f.resolution.token, submissionId, submitterId: f.resolution.submitterId, googleDoc, ...patch })) form.set(key, value);
    // An empty file field exercises Docs-only refusal without uploading a PDF or any content.
    if (file) form.set('file', new Blob([]), 'refused-file.txt');
    const response = await appFetch('/api/submissions', { method: 'POST', body: form });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const first = await postResolution();
  requireThat(first.status === 201 && first.body.status === 'created' && typeof first.body.code === 'string', 'Resolution create failed.');
  report.created.resolutionCodes.push(first.body.code);
  const retries = await Promise.all([postResolution(), postResolution(), postResolution()]);
  requireThat(retries.every(x => x.status === 200 && x.body.status === 'replayed' && x.body.code === first.body.code), 'Concurrent resolution replay was not exactly once.');
  const duplicate = await postResolution({ submissionId: randomUUID() });
  requireThat(duplicate.status === 200 && duplicate.body.status === 'duplicate' && duplicate.body.code === first.body.code, 'Resolution source duplicate was not deduplicated.');
  const changed = await postResolution({ googleDoc: `https://docs.google.com/document/d/qr_changed_${randomUUID().replaceAll('-', '')}/edit` });
  requireThat(changed.status === 409 && changed.body.error === 'idempotency_conflict', 'Changed resolution replay was not refused.');
  const legacy = await postResolution({ submissionId: randomUUID(), title: 'Synthetic legacy client title', googleDoc: `https://docs.google.com/document/d/qr_legacy_${randomUUID().replaceAll('-', '')}/edit` });
  requireThat(legacy.status === 201 && legacy.body.status === 'created' && typeof legacy.body.code === 'string', 'Legacy resolution title compatibility failed.');
  report.created.resolutionCodes.push(legacy.body.code);
  mark('resolution-create-concurrent-replay-source-deduplication-changed-payload-conflict-and-legacy-title');
  for (const [patch, status, reason] of [
    [{ googleDoc: 'https://example.com/not-a-doc' }, 400, 'invalid_google_doc'],
    [{ submitterId: randomUUID() }, 400, 'invalid_submitter'],
    [{ token: randomUUID().replaceAll('-', '') }, 404, 'invalid_link'],
    [{ token: f.amendment.token }, 404, 'invalid_link'],
  ] as const) {
    const result = await postResolution({ submissionId: randomUUID(), ...patch });
    requireThat(result.status === status && result.body.error === reason, 'Resolution input or wrong-link-type refusal failed.');
  }
  const file = await postResolution({ submissionId: randomUUID() }, true);
  requireThat(file.status === 400 && file.body.error === 'docs_only', 'Resolution file field was not refused.');
  mark('resolution-invalid-doc-submitter-token-cross-link-and-docs-only-refusals');
  const amendmentSubmission = randomUUID(), wording = `Synthetic QR verification ${randomUUID()}`;
  const postAmendment = async (patch: Record<string, unknown> = {}) => {
    const response = await appFetch('/api/amendments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: f.amendment.token, submissionId: amendmentSubmission, submitterId: f.amendment.submitterId, resolutionId: f.amendment.resolutionId, type: 'Add', clause: 'Synthetic verification clause', wording, confirmed: true, ...patch }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const a = await postAmendment();
  requireThat(a.status === 201 && a.body.status === 'created' && typeof a.body.id === 'string', 'Amendment create failed.');
  report.created.amendmentIds.push(a.body.id);
  const ar = await Promise.all([postAmendment(), postAmendment(), postAmendment()]);
  requireThat(ar.every(x => x.status === 200 && x.body.status === 'replayed' && x.body.id === a.body.id), 'Concurrent amendment replay was not exactly once.');
  const ad = await postAmendment({ submissionId: randomUUID() });
  requireThat(ad.status === 200 && ad.body.status === 'duplicate' && ad.body.id === a.body.id, 'Amendment duplicate was not deduplicated.');
  for (const [patch, status, reason] of [
    [{ wording: `${wording} changed` }, 409, 'idempotency_conflict'],
    [{ submissionId: randomUUID(), submitterId: randomUUID() }, 400, 'invalid_submitter'],
    [{ submissionId: randomUUID(), resolutionId: randomUUID() }, 409, 'not_open'],
    [{ submissionId: randomUUID(), token: randomUUID().replaceAll('-', '') }, 404, 'invalid_link'],
    [{ submissionId: randomUUID(), token: f.resolution.token }, 404, 'invalid_link'],
    [{ submissionId: randomUUID(), confirmed: false }, 400, 'invalid_amendment'],
  ] as const) {
    const result = await postAmendment(patch);
    requireThat(result.status === status && result.body.error === reason, 'Amendment input or wrong-link-type refusal failed.');
  }
  mark('amendment-create-concurrent-replay-deduplication-conflicts-and-scope-refusals');
  if (staff) {
    requireThat(!!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Staff checks require the publishable key.');
    for (const role of ['chair', 'approval', 'logistics'] as const) {
      const client = safeClient(plan.supabaseUrl, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, fetcher, staff[role]);
      const { data: grants, error } = await client.from('user_access').select('role,committee_id').eq('conference_id', f.conferenceId);
      requireThat(!error && grants?.length === 1 && grants[0].role === role && (role !== 'chair' || grants[0].committee_id === f.resolution.committeeId), 'Staff session is not scoped only to its declared role.');
      const snapshot = await rpc<{ conference?: { id?: string }; documents: { id: string; code: string; status: string }[]; resolutionLinks?: { documentId: string; workingDocId: string | null }[] }>(client, 'conference_state_snapshot', { conf: f.conferenceId }, 'Staff snapshot lookup failed.');
      requireThat(snapshot.conference?.id === f.conferenceId, 'Staff snapshot conference mismatch.');
      const docs = snapshot.documents.filter(d => d.code === first.body.code);
      if (role === 'chair') {
        requireThat(docs.length === 1 && docs[0].status === 'Draft' && snapshot.resolutionLinks?.some(x => x.documentId === docs[0].id && x.workingDocId === googleDocId), 'Chair cannot read the newly registered Draft and canonical document link.');
      } else requireThat(docs.length === 0, 'Draft resolution leaked to Approval or Logistics.');
    }
    mark('role-scoped-chair-draft-and-link-readable-approval-and-logistics-denied');
  } else report.limits.push('Staff document/link visibility was not run: no optional role-scoped sessions supplied.');
  report.status = 'passed';
  report.completedAt = new Date().toISOString();
}
