import test from 'node:test';
import assert from 'node:assert/strict';
import { publicQrPlan, assertPublicQrLinks, newPublicQrReport, verifyPublicQr, type PublicQrFixture } from '../scripts/verification/public-qr';
import { POST as submit } from '../app/api/submissions/route';
import { POST as amend } from '../app/api/amendments/route';
import type { LinkInfo } from '../lib/submissions/rules';
import type { AmendmentLinkInfo } from '../lib/amendments/rules';
const ref = 'kllhswucdhqqywnzxado', prod = 'prodprodprodprodprod';
const conf = '63000000-0000-4000-8000-000000000001', committee = '63000000-0000-4000-8000-000000000002', submitter = '63000000-0000-4000-8000-000000000003', resolution = '63000000-0000-4000-8000-000000000004';
const fixture: PublicQrFixture = { version: 1, purpose: 'synthetic-public-qr', projectRef: ref, conferenceId: conf, appOrigin: 'http://localhost:4319', resolution: { token: 'R'.repeat(32), committeeId: committee, submitterId: submitter }, amendment: { token: 'A'.repeat(32), committeeId: committee, submitterId: submitter, resolutionId: resolution } };
const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', NEXT_PUBLIC_DATA_BACKEND: 'supabase', NEXT_PUBLIC_CONFERENCE_ID: resolution, STAGING_SUPABASE_REFS: ref, EXPECTED_SUPABASE_REF: prod, SUPABASE_SECRET_KEY: 'test-server-key-never-public', QR_VERIFICATION_APP_ORIGINS: fixture.appOrigin };
const options = { baseUrl: fixture.appOrigin, conferenceId: conf, output: 'artifacts/public-qr/results.json' };
const link: LinkInfo = { linkId: 'link', conferenceId: conf, committeeId: committee, conferenceName: 'Synthetic', committeeCode: 'SYN', committeeName: 'Synthetic', shareWith: '', submitters: [{ id: submitter, country: 'Synthetic delegation', flag: '🌐' }] };
const amendmentLink: AmendmentLinkInfo = { committee: { id: committee, code: 'SYN', name: 'Synthetic' }, resolution: { id: resolution, code: 'SYN / 01', title: 'Synthetic' }, delegates: [{ id: submitter, country: 'Synthetic delegation' }] };

test('QR preflight requires explicit current project, conference, origin and ignored output; no connections', () => {
  const plan = publicQrPlan(fixture, options, env);
  assert.equal(plan.origin, fixture.appOrigin); assert.equal(plan.projectRef, ref);
  const reject = (input: unknown, opts = options, config: Record<string, string> = env) => assert.throws(() => publicQrPlan(input, opts, config));
  reject(fixture, options, { ...env, STAGING_SUPABASE_REFS: '' });
  reject(fixture, options, { ...env, NEXT_PUBLIC_SUPABASE_URL: `https://${prod}.supabase.co` });
  reject(fixture, options, { ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://gglltljhdpkfjnyjmnif.supabase.co', STAGING_SUPABASE_REFS: 'gglltljhdpkfjnyjmnif' });
  reject(fixture, options, { ...env, VERCEL_ENV: 'production' });
  reject(fixture, options, { ...env, NEXT_PUBLIC_DATA_BACKEND: 'local' });
  reject({ ...fixture, projectRef: prod });
  reject({ ...fixture, conferenceId: resolution });
  reject(fixture, { ...options, conferenceId: resolution });
  reject(fixture, options, { ...env, PROTECTED_CONFERENCE_IDS: conf });
  reject(fixture, options, { ...env, PROTECTED_CONFERENCE_IDS: 'bad' });
  reject(fixture, options, { ...env, QR_VERIFICATION_APP_ORIGINS: '' });
  reject(fixture, options, { ...env, PRODUCTION_APP_ORIGINS: fixture.appOrigin });
  for (const baseUrl of ['https://production.example', 'http://remote.example', 'http://user:secret@localhost:4319', `${fixture.appOrigin}/submit`, `${fixture.appOrigin}/?token=secret`, `${fixture.appOrigin}/#secret`]) reject(fixture, { ...options, baseUrl });
  for (const output of ['docs/submission-http-results.json', '../outside.json', 'artifacts/../../outside.json', 'artifacts/results.txt', 'artifacts']) reject(fixture, { ...options, output });
  reject({ ...fixture, purpose: 'production' });
  reject({ ...fixture, amendment: { ...fixture.amendment, committeeId: resolution } });
  reject({ ...fixture, amendment: { ...fixture.amendment, token: fixture.resolution.token } });
});
test('authoritative link mismatch refuses before public app requests', async () => {
  const plan = publicQrPlan(fixture, options, env);
  assert.doesNotThrow(() => assertPublicQrLinks(plan, link, amendmentLink));
  for (const bad of [null, { ...link, conferenceId: resolution }, { ...link, committeeId: resolution }, { ...link, submitters: [] }]) assert.throws(() => assertPublicQrLinks(plan, bad, amendmentLink));
  for (const bad of [null, { ...amendmentLink, resolution: null }, { ...amendmentLink, committee: { ...amendmentLink.committee, id: resolution } }, { ...amendmentLink, delegates: [] }]) assert.throws(() => assertPublicQrLinks(plan, link, bad));
  let publicCalls = 0;
  const fake: typeof fetch = async (input) => {
    const u = new URL(String(input));
    if (u.origin === fixture.appOrigin) { publicCalls++; throw Error('No public request allowed'); }
    return Response.json(u.pathname.endsWith('/submission_link_info') ? { ...link, conferenceId: resolution } : amendmentLink);
  };
  await assert.rejects(() => verifyPublicQr(plan, env, newPublicQrReport(plan), undefined, fake), /conference or committee/);
  assert.equal(publicCalls, 0);
  let calls = 0;
  await assert.rejects(() => verifyPublicQr(plan, { ...env, EXPECTED_SUPABASE_REF: ref, STAGING_SUPABASE_REFS: '' }, newPublicQrReport(plan), undefined, async () => { calls++; throw Error(); }), /guard refused/);
  assert.equal(calls, 0, 'even a direct runner call rechecks production guard before any HTTP');
});
test('verifier exercises real Docs-only resolution and amendment POST routes, with replay/conflicts and no network or credential leak', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const resolutionReceipts = new Map<string, { payload: string; code: string }>();
  const sourceCodes = new Map<string, string>();
  const amendmentReceipts = new Map<string, { payload: string; id: string }>();
  const amendmentSources = new Map<string, string>();
  let publicPosts = 0;
  const reject = (message: string) => Response.json({ code: 'P0001', message, details: '', hint: '' }, { status: 400 });
  const fake: typeof fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (u.origin === fixture.appOrigin) {
      assert.ok(!new Headers(init?.headers).has('authorization'));
      assert.ok(!new Headers(init?.headers).has('apikey'));
      assert.ok(!String(init?.body).includes(env.SUPABASE_SECRET_KEY));
      assert.equal(init?.redirect, 'error', 'public requests never follow redirects');
      if (u.pathname === '/api/health') return Response.json({ app: { environment: 'development', commit: 'a'.repeat(40) } });
      if (init?.method !== 'POST') return new Response(u.pathname.startsWith('/submit/') ? 'I have made sure the Chairs can edit this document.' : 'I confirm this is the exact wording I want submitted.');
      publicPosts++;
      const request = new Request(u, init);
      return u.pathname === '/api/submissions' ? submit(request) : amend(request);
    }
    assert.equal(u.origin, `https://${ref}.supabase.co`, 'no real network, Google, Auth or third-party host');
    assert.ok(u.pathname.startsWith('/rest/v1/rpc/'), 'no Auth or direct table requests');
    const args = JSON.parse(String(init?.body)) as Record<string, string>;
    if (u.pathname.endsWith('/submission_link_info')) return Response.json(args.link_token === fixture.resolution.token ? link : null);
    if (u.pathname.endsWith('/amendment_link_info')) return Response.json(args.link_token === fixture.amendment.token ? amendmentLink : null);
    if (u.pathname.endsWith('/submit_resolution')) {
      const payload = JSON.stringify(args), old = resolutionReceipts.get(args.submission);
      if (old) return old.payload === payload ? Response.json({ status: 'replayed', code: old.code }) : reject('idempotency_conflict');
      const existing = sourceCodes.get(args.google_doc_id);
      if (existing) return Response.json({ status: 'duplicate', code: existing });
      const code = `SYN / ${sourceCodes.size + 1}`;
      sourceCodes.set(args.google_doc_id, code); resolutionReceipts.set(args.submission, { payload, code });
      return Response.json({ status: 'created', code });
    }
    if (u.pathname.endsWith('/submit_amendment')) {
      const payload = JSON.stringify(args), old = amendmentReceipts.get(args.submission);
      if (old) return old.payload === payload ? Response.json({ status: 'replayed', id: old.id }) : reject('idempotency_conflict');
      if (args.link_token !== fixture.amendment.token) return reject('invalid_link');
      if (args.submitter !== submitter) return reject('invalid_submitter');
      if (args.resolution !== resolution) return reject('not_open');
      const existing = amendmentSources.get(args.wording);
      if (existing) return Response.json({ status: 'duplicate', id: existing });
      const id = '63000000-0000-4000-8000-000000000099';
      amendmentSources.set(args.wording, id); amendmentReceipts.set(args.submission, { payload, id });
      return Response.json({ status: 'created', id });
    }
    throw Error('Unexpected fake RPC');
  };
  globalThis.fetch = fake;
  try {
    const plan = publicQrPlan(fixture, options, env), report = newPublicQrReport(plan);
    await verifyPublicQr(plan, env, report, undefined, fake);
    assert.equal(report.status, 'passed'); assert.equal(sourceCodes.size, 2); assert.equal(amendmentSources.size, 1);
    assert.equal(report.created.resolutionCodes.length, 2); assert.equal(report.created.amendmentIds.length, 1);
    assert.ok(publicPosts > 20);
    for (const secret of [env.SUPABASE_SECRET_KEY, fixture.resolution.token, fixture.amendment.token]) assert.ok(!JSON.stringify(report).includes(secret), 'report excludes secrets and live QR tokens');
    assert.ok(report.limits.some(x => x.includes('Staff document/link visibility was not run')));
    assert.ok(report.limits.some(x => x.includes('sharing') && x.includes('NOT verified')));
  } finally {
    globalThis.fetch = previousFetch;
    for (const [k, v] of Object.entries(previousEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('CLI preflight makes only a private ignored artifact, refuses overwrite and symlink escapes', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  await mkdir('artifacts', { recursive: true });
  const dir = await mkdtemp(resolve('artifacts/qr-cli-')), outside = await mkdtemp(join(tmpdir(), 'qr-outside-'));
  try {
    const fixturePath = join(dir, 'fixture.json'), reportPath = join(dir, 'preflight.json');
    await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
    const args = ['--import', 'tsx', 'scripts/verify-submission-http.mts', '--base-url', fixture.appOrigin, '--conference-id', conf, '--fixture', fixturePath, '--output', reportPath, '--preflight'];
    const run = (argv = args) => spawnSync(process.execPath, argv, { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...env, VERCEL_ENV: '', PROTECTED_CONFERENCE_IDS: '', PRODUCTION_APP_ORIGINS: '' }, timeout: 10_000 });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const raw = await readFile(reportPath, 'utf8'), saved = JSON.parse(raw);
    assert.equal(saved.status, 'preflight-only'); assert.deepEqual(saved.checks, []);
    assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
    assert.ok(!`${raw}${first.stdout}${first.stderr}`.includes(env.SUPABASE_SECRET_KEY));
    assert.ok(!raw.includes(fixture.resolution.token));
    assert.equal(run().status, 1, 'existing report cannot be overwritten');
    assert.equal(await readFile(reportPath, 'utf8'), raw);
    await symlink(outside, join(dir, 'escape'));
    const escaped = [...args]; escaped[escaped.indexOf('--output') + 1] = join(dir, 'escape', 'result.json');
    assert.equal(run(escaped).status, 1);
    await assert.rejects(() => stat(join(outside, 'result.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('production or unknown app build and wrong candidate SHA refuse before any public write', async () => {
  for (const health of [{ app: { environment: 'production', commit: 'a'.repeat(40) } }, { app: { environment: 'mystery', commit: 'a'.repeat(40) } }, { app: { environment: 'preview', commit: 'b'.repeat(40) } }]) {
    const plan = publicQrPlan({ ...fixture, expectedAppCommit: 'a'.repeat(40) }, options, env);
    let posts = 0;
    const fake: typeof fetch = async (input, init) => {
      const u = new URL(String(input));
      if (u.origin !== fixture.appOrigin) return Response.json(u.pathname.endsWith('/submission_link_info') ? link : amendmentLink);
      if (init?.method === 'POST') posts++;
      assert.equal(u.pathname, '/api/health');
      return Response.json(health);
    };
    await assert.rejects(() => verifyPublicQr(plan, env, newPublicQrReport(plan), undefined, fake), /production|pinned commit/);
    assert.equal(posts, 0);
  }
  assert.throws(() => publicQrPlan(fixture, options, { ...env, NEXT_PUBLIC_CONFERENCE_ID: conf }), /protected/);
  assert.throws(() => publicQrPlan(fixture, options, { ...env, NEXT_PUBLIC_CONFERENCE_ID: '' }), /protected/);
  assert.throws(() => publicQrPlan(fixture, options, { ...env, PROTECTED_CONFERENCE_IDS: conf.toUpperCase() }), /protected/);
  assert.throws(() => publicQrPlan({ ...fixture, expectedAppCommit: 'abc' }, options, env), /complete lowercase/);
});
