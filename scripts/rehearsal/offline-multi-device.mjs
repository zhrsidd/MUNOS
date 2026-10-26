// Multi-device offline rehearsal, driven by Playwright. Documentation and run instructions: docs/OFFLINE_REHEARSAL_AUTOMATED.md
//
//   DEMO (default, safe, local):   npm run test:rehearsal:offline
//   HOSTED (isolated TEMP conference only, orchestrator-provisioned): REHEARSAL_MODE=hosted ... see the document.
//
// Each "device" is its own Playwright browser context: separate IndexedDB outbox, cookies, service worker and network switch.
// The script prints PASS / FAIL / SKIP lines and never prints an access code, key or token.
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {DeliveryLog, allowedRequest, checkBaseOrigin, checkBundles, checkHealthIdentity, pointsOf, stateDigest} from './delivery-audit.mjs';
import {waitForSpeechFinish} from './speech-finish.mjs';
import {project} from '../../lib/sync/repository';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOSTED = (process.env.REHEARSAL_MODE || 'demo').toLowerCase() === 'hosted';
const COMMITTEE_CODE = process.env.REHEARSAL_COMMITTEE_CODE || (HOSTED ? 'TST' : 'GA1');
const SKIP_VOTES = process.env.REHEARSAL_SKIP_VOTES === '1';
const ARTIFACTS = process.env.REHEARSAL_ARTIFACT_DIR || path.join(os.tmpdir(), `munos-offline-rehearsal-${Date.now()}`);
const SYNC_TIMEOUT = Number(process.env.REHEARSAL_SYNC_TIMEOUT_MS || 90_000);
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------------------------------------------- results
const results = [];
let current = null;
const marks = {pass: 0, skip: 0};
async function scenario(id, title, fn) {
  current = {id, title, status: 'pass', note: ''};
  results.push(current);
  log(`\n== ${id} ${title}`);
  try { await fn(); } catch (error) {
    current.status = 'fail';
    current.note = error instanceof Error ? error.message.split('\n')[0] : String(error);
    log(`FAIL ${id}: ${error instanceof Error ? error.message : error}`);
    await snapshotFailure(id);
  }
}
/** One assertion. */
async function check(label, fn) {
  await fn();
  marks.pass++;
  log(`  PASS ${label}`);
}
/** An assertion that needs a real server (apply_conference_mutation, receipts, PT409). Demo mode lists it as SKIP. */
async function hostedCheck(label, fn) {
  if (!HOSTED) { marks.skip++; log(`  SKIP (hosted only) ${label}`); return; }
  await check(label, fn);
}
async function eventually(label, fn, {timeout = 15_000, every = 400, nudge} = {}) {
  const end = Date.now() + timeout;
  let last = 'condition not met';
  let ticks = 0;
  for (;;) {
    try { const value = await fn(); if (value !== false) return value; } catch (error) { last = error instanceof Error ? error.message.split('\n')[0] : String(error); }
    if (Date.now() > end) throw Error(`Timed out after ${timeout} ms waiting for ${label} (${last})`);
    if (nudge && ++ticks % 12 === 0) await nudge().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, every));
  }
}

// ----------------------------------------------------------------------------------------------------------- playwright
function loadPlaywright() {
  const attempts = [];
  if (process.env.REHEARSAL_PLAYWRIGHT_DIR) attempts.push(() => createRequire(path.join(path.resolve(process.env.REHEARSAL_PLAYWRIGHT_DIR), 'noop.js'))('playwright'));
  // CommonJS resolution honours NODE_PATH, which ES-module `import` does not: this is how the scratch copy is found.
  attempts.push(() => createRequire(import.meta.url)('playwright'));
  attempts.push(() => createRequire(import.meta.url)('playwright-core'));
  for (const attempt of attempts) { try { return attempt(); } catch { /* try the next location */ } }
  throw Error('Playwright was not found. Set NODE_PATH (or REHEARSAL_PLAYWRIGHT_DIR) to a node_modules directory containing "playwright". See docs/OFFLINE_REHEARSAL_AUTOMATED.md.');
}

// ------------------------------------------------------------------------------------------------------------ servers
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
});
const DEMO_UNSET = ['NEXT_PUBLIC_DATA_BACKEND', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CONFERENCE_ID'];
function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit']});
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`${args.join(' ')} exited ${code}`)));
  });
}
async function startDemoServer() {
  if (process.env.REHEARSAL_DEMO_URL) return {url: process.env.REHEARSAL_DEMO_URL.replace(/\/$/, ''), stop: async () => {}};
  const env = {...process.env};
  for (const name of DEMO_UNSET) delete env[name];
  const next = path.join(ROOT, 'node_modules/next/dist/bin/next');
  if (process.env.REHEARSAL_BUILD === '1') { log('Building the demo app (next build --webpack, demo environment)...'); await run(process.execPath, [next, 'build', '--webpack'], env); }
  if (!existsSync(path.join(ROOT, '.next/BUILD_ID'))) throw Error('No production build found. Run with REHEARSAL_BUILD=1 or build first (see docs/OFFLINE_REHEARSAL_AUTOMATED.md).');
  const port = await freePort();
  const child = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(port)], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  const url = `http://127.0.0.1:${port}`;
  log(`Demo server pid ${child.pid} on port ${port}`);
  await eventually('the demo server to answer', async () => (await fetch(`${url}/api/health`)).status > 0, {timeout: 60_000}).catch(error => { child.kill('SIGTERM'); throw Error(`${error.message}\n${output.slice(-800)}`); });
  return {
    url,
    stop: () => new Promise(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM'); // only the process this script started
    }),
  };
}

// ------------------------------------------------------------------------------------------------------- state helpers
const committeeOf = d => d.committees.find(c => c.code === COMMITTEE_CODE);
function scope(d) {
  const committee = committeeOf(d);
  assert.ok(committee, `committee ${COMMITTEE_CODE} not found`);
  return {
    committee,
    sessionId: committee.currentSessionId,
    delegates: d.delegates.filter(x => x.committeeId === committee.id),
    resolution: d.documents.find(r => r.committeeId === committee.id && r.status === 'In Debate'),
  };
}

const attendanceOf = (d, id, sessionId) => d.attendance.find(a => a.delegateId === id && a.sessionId === sessionId)?.status ?? null;
const votesOf = (d, id, resolutionId, sessionId) => d.votes.filter(v => v.delegateId === id && v.resolutionId === resolutionId && v.sessionId === sessionId);
const openQueue = (d, sessionId) => d.queue.filter(q => q.sessionId === sessionId && (q.lane ?? 'open') === 'open').sort((a, b) => a.position - b.position);
const speechesIn = (d, sessionId) => (d.speeches ?? []).filter(s => s.sessionId === sessionId);
function duplicates(list) { const seen = new Set(); return list.filter(x => seen.has(x.id) ? true : (seen.add(x.id), false)); }
const digest = d => stateDigest(d, COMMITTEE_CODE);

// --------------------------------------------------------------------------------------------------------------- device
let browser;
let baseUrl;
let hostedCtx = null;
let allowOrigins = null; // {baseOrigin, supabaseOrigin}: the only destinations a browser context may reach
let supabaseOrigin = null;
let chairCode = null;
const devices = [];
class Device {
  constructor(name) { this.name = name; this.errors = []; this.dialogs = []; }
  async start() {
    this.ctx = await browser.newContext({viewport: {width: 1280, height: 1000}, acceptDownloads: true, serviceWorkers: 'allow'});
    await guardContext(this.ctx);
    this.page = await this.newPage();
    devices.push(this);
    return this;
  }
  async newPage() {
    const page = await this.ctx.newPage();
    page.on('pageerror', e => { this.errors.push(`${current?.id ?? '-'}: ${e.message.split('\n')[0]}`); if (process.env.REHEARSAL_DEBUG === '1') log(`  [${this.name} pageerror] ${e.stack}`); });
    // window.confirm() prompts (fresh ballot, dismiss exported action) are accepted and recorded, never silently skipped.
    if (process.env.REHEARSAL_DEBUG === '1') page.on('request', r => { if (r.url().includes('/rest/v1/')) log(`  [${this.name} ${r.method()}] ${new URL(r.url()).pathname}`); });
    page.on('dialog', d => { this.dialogs.push(d.message()); void d.accept(); });
    return page;
  }
  strip(page = this.page) { return page.locator('.save-status-message').innerText(); }
  async nudge(page = this.page) { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); }
  /** Every outbox/checkpoint this origin stores, read straight from IndexedDB (what survives a reload). */
  async checkpoint(page = this.page) {
    const all = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('conference-os-v3');
      open.onerror = () => reject(Error('indexedDB unavailable'));
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('workspaces')) { db.close(); resolve([]); return; }
        const req = db.transaction('workspaces').objectStore('workspaces').getAll();
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(Error('indexedDB read failed')); };
      };
    }));
    const wanted = all.find(c => HOSTED ? String(c.key).startsWith('supabase:') : c.key === 'local-demo');
    assert.ok(wanted, `${this.name}: no ${HOSTED ? 'supabase' : 'local-demo'} checkpoint in IndexedDB`);
    return wanted;
  }
  async base(page = this.page) { return (await this.checkpoint(page)).base; }
  async pending(page = this.page) { return (await this.checkpoint(page)).pending; }
  /** Open a staff screen. Hosted devices pass the access gate with the Chair code (typed into the password field, never logged). */
  async goto(route, { page = this.page } = {}) {
    await page.goto(baseUrl + route, {waitUntil: 'domcontentloaded'});
    await this.ready(page);
  }
  async ready(page = this.page) {
    if (HOSTED) {
      // The access gate can flash while the workspace restores (e.g. after an offline reload), so never block on it: poll, and
      // type the code only when the gate is the signed-out one ("Enter staff access code") and the device is online.
      const shell = page.locator('.save-status');
      const input = page.locator('input[type="password"]');
      const end = Date.now() + 45_000;
      while (Date.now() < end && !(await shell.isVisible().catch(() => false))) {
        const signedOut = await page.getByRole('heading', {name: 'Enter staff access code'}).isVisible().catch(() => false);
        if (signedOut && (await page.evaluate(() => navigator.onLine).catch(() => false))) {
          assert.ok(chairCode, 'a Chair code is required for hosted devices');
          try {
            await input.fill(chairCode, {timeout: 3000});
            await page.getByRole('button', {name: 'Open staff workspace'}).click({timeout: 3000});
          } catch { /* the gate went away mid-fill: the loop re-checks */ }
        }
        await page.waitForTimeout(500);
      }
    }
    await page.locator('.save-status').waitFor({state: 'visible', timeout: 45_000});
    // A device with no current session shows the selector with an empty value: choose the first real session.
    const select = page.locator('select[aria-label="Current session"]');
    if (await select.count()) {
      if ((await select.inputValue()) === '') {
        const first = await select.locator('option:not([value=""])').first().getAttribute('value');
        if (first) await select.selectOption(first);
      }
    }
  }
  async at(route, page = this.page) {
    if (new URL(page.url()).pathname !== route) await this.goto(route, {page});
    return page;
  }
  async stripIs(pattern, timeout = 15_000, page = this.page) {
    await eventually(`${this.name} sync strip to match ${pattern}`, async () => pattern.test(await this.strip(page)), {timeout});
  }
  async drained(timeout = SYNC_TIMEOUT) {
    await eventually(`${this.name} outbox to drain`, async () => (await this.pending()).length === 0, {timeout, nudge: () => this.nudge()});
  }
  async setOffline(offline) { await this.ctx.setOffline(offline); }

  // --- Chair actions, through the real UI ---
  async attendance(country, status) {
    const page = await this.at('/chair/roll-call');
    const group = page.getByRole('group', {name: `Attendance for ${country}`, exact: true});
    const button = group.getByRole('button', {name: new RegExp(`^(✓ )?${status.replace(/&/g, '&')}$`)});
    await button.click();
    await eventually(`${country} attendance ${status} to show`, async () => (await button.getAttribute('aria-pressed')) === 'true');
  }
  async queueAdd(country) {
    const page = await this.at('/chair');
    const picker = page.getByRole('combobox', {name: 'Add delegate', exact: true});
    await picker.click();
    await picker.fill(country);
    await page.getByRole('option', {name: new RegExp(`${country}`)}).first().click();
    await page.getByRole('button', {name: '+ Queue'}).click();
    await eventually(`${country} to appear in the speaker queue`, async () => (await page.locator('ol[aria-label="open speaker queue"]').innerText()).includes(country));
  }
  /** Recognise the next speaker, record the speech, return the floor. Returns the country and the points. */
  async speech({double = false} = {}) {
    const page = await this.at('/chair');
    const next = page.getByRole('button', {name: /^Next speaker · /});
    const country = (await next.innerText()).replace(/^Next speaker · /, '').trim();
    if (double) await next.dblclick(); else await next.click();
    const score = page.getByRole('button', {name: new RegExp(`^Record ${country} speech for \\d+ points$`)}).first();
    await score.waitFor({state: 'visible', timeout: 15_000});
    const started = project(await this.checkpoint());
    const speech = speechesIn(started, scope(started).sessionId).find(s => s.state !== 'finished');
    assert.ok(speech, 'the recognized speech must be in the durable device checkpoint');
    const points = Number(/for (\d+) points/.exec(await score.getAttribute('aria-label'))[1]);
    if (double) await score.dblclick(); else await score.click();
    await page.getByText('Speech recorded', {exact: true}).waitFor({timeout: 15_000});
    await page.getByRole('button', {name: /^Finish · return floor to Chair/}).click();
    // An empty queue is also shown DURING a speech. Require the actual floor heading and persisted finished state instead.
    await waitForSpeechFinish(page, async () => project(await this.checkpoint()), speech.id);
    return {country, points};
  }
  async participation(country, category, points) {
    const page = await this.at('/chair/participation');
    const row = page.locator('.participation-row').filter({has: page.getByRole('button', {name: `Adjust points for ${country}`, exact: true})});
    const total = async () => Number(/(\d+) pts/.exec(await row.locator('.opportunity-total').innerText())[1]);
    const before = await total();
    await row.getByRole('button', {name: `Record ${category} ${points} points for ${country}`, exact: true}).click();
    await eventually(`${country} points to show +${points}`, async () => (await total()) === before + points);
  }
  async vote(country, choice) {
    const page = await this.at('/chair/voting');
    const row = page.locator('.roll-row').filter({has: page.getByText(country, {exact: true})});
    const button = row.getByRole('button', {name: choice, exact: true});
    await button.click();
    await eventually(`${country} vote ${choice} to show`, async () => (await button.getAttribute('aria-pressed')) === 'true');
  }
  async leaderboard() {
    const page = await this.at('/chair');
    await page.locator('ol.points-leaderboard li').first().waitFor();
    // Row markup: <span flag/> <span country/> <strong>N<span sr-only> points</span></strong>
    const rows = await page.locator('ol.points-leaderboard li').evaluateAll(items => items.map(li => [li.children[1].textContent.trim(), parseInt(li.querySelector('strong').textContent, 10)]));
    return Object.fromEntries(rows);
  }
}
/** Let the baseline read finish before measuring request retries and idempotency. The in-flight-read race has its own tests. */
async function settle(device) {
  await device.stripIs(/^(All changes synced|Demo · saved in this browser)$/, 30_000);
  await new Promise(resolve => setTimeout(resolve, 4000));
}
/** Deny by default: abort every request that is not the app origin or the validated Supabase origin (codes could ride on any). */
async function guardContext(ctx) {
  await ctx.route('**/*', route => allowedRequest(route.request().url(), allowOrigins) ? route.fallback() : route.abort('blockedbyclient'));
}
/** Before any code is typed: the deployment's own bundles must embed the validated Supabase project and conference. */
async function verifyDeployment(config) {
  const ctx = await browser.newContext({serviceWorkers: 'block'});
  try {
    await guardContext(ctx);
    const page = await ctx.newPage();
    await page.goto(`${baseUrl}/chair`, {waitUntil: 'load', timeout: 60_000});
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /\.js(\?|$)/.test(n)));
    const texts = [];
    for (const url of new Set(scripts)) if (allowedRequest(url, allowOrigins)) texts.push(await (await ctx.request.get(url)).text());
    checkBundles(texts, {supabaseUrl: config.url, conferenceId: config.conferenceId});
    const health = await (await ctx.request.get(`${baseUrl}/api/health`)).json().catch(() => null);
    checkHealthIdentity(health, process.env.REHEARSAL_EXPECTED_COMMIT);
  } finally { await ctx.close(); }
}
async function snapshotFailure(id) {
  mkdirSync(ARTIFACTS, {recursive: true});
  for (const d of devices) { try { await d.page.screenshot({path: path.join(ARTIFACTS, `${id}-${d.name}.png`)}); } catch { /* page closed */ } }
}

// ------------------------------------------------------------------------------------------------- hosted server view
/** Authoritative state: the Executive's snapshot (hosted). Demo mode has no server; callers use the device's own base instead. */
let readChairView = null;
const serverState = async () => readChairView();
async function authoritative(device) { return HOSTED ? serverState() : device.base(); }

// ======================================================================================================================
async function main() {
  const startedAt = new Date().toISOString();
  let server = {stop: async () => {}};
  let config = null;
  let hosted = null;
  if (HOSTED) {
    // Order matters. (1) Offline checks of the inputs: nothing is contacted. (2) Browser opens the deployment WITHOUT any code
    // and proves it embeds the validated project and conference. (3) Only then is any code used (Executive preflight, devices).
    baseUrl = (process.env.REHEARSAL_BASE_URL || '').replace(/\/$/, '');
    const origin = checkBaseOrigin(baseUrl, process.env.REHEARSAL_EXPECTED_ORIGIN);
    hosted = await import('./offline-hosted.mts');
    config = hosted.readConfig();
    allowOrigins = {baseOrigin: origin, supabaseOrigin: new URL(config.url).origin};
    supabaseOrigin = allowOrigins.supabaseOrigin;
  } else {
    server = await startDemoServer();
    baseUrl = server.url;
    allowOrigins = {baseOrigin: new URL(baseUrl).origin, supabaseOrigin: null};
    log(`DEMO mode (no server): ${baseUrl}`);
  }
  const {chromium} = loadPlaywright();
  browser = await chromium.launch({
    headless: process.env.REHEARSAL_HEADED !== '1',
    executablePath: process.env.REHEARSAL_CHROMIUM_PATH || undefined,
    args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
  });
  if (HOSTED) {
    try {
      await verifyDeployment(config);
      log('Deployment identity verified: embeds the validated project and conference; browser limited to the app and project origins.');
      hostedCtx = await hosted.preflight(config);
      chairCode = await hosted.chairCodeFromEnv();
      if (!chairCode && process.env.REHEARSAL_MINT === '1') chairCode = await hosted.mintRoleCode(hostedCtx, 'chair', hostedCtx.committeeId);
      assert.ok(chairCode, 'Set REHEARSAL_CHAIR_CODE, REHEARSAL_CODES_FILE (from offline-hosted.mts mint), or REHEARSAL_MINT=1');
      readChairView = await hosted.chairAuditor(hostedCtx, chairCode);
    } catch (error) { await browser.close().catch(() => undefined); throw error; }
    log(`HOSTED mode. project=${config.ref} conference=${config.conferenceId} committee=${hostedCtx.committeeId} (${hostedCtx.conferenceName})`);
  }
  try {
    await runScenarios();
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
  const failed = results.filter(r => r.status === 'fail');
  mkdirSync(ARTIFACTS, {recursive: true});
  writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify({mode: HOSTED ? 'hosted' : 'demo', startedAt, finishedAt: new Date().toISOString(), passedAssertions: marks.pass, skippedHostedOnly: marks.skip, scenarios: results}, null, 1));
  log(`\n== SUMMARY (${HOSTED ? 'hosted' : 'demo'})`);
  for (const r of results) log(`  ${r.status.toUpperCase().padEnd(4)} ${r.id} ${r.title}${r.note ? ` - ${r.note}` : ''}`);
  log(`  ${marks.pass} assertions passed, ${marks.skip} hosted-only assertions skipped, ${failed.length} scenario(s) failed. Report: ${path.join(ARTIFACTS, 'report.json')}`);
  if (failed.length) process.exitCode = 1;
}

async function runScenarios() {
  // Two Chair devices of the same committee: independent contexts (separate IndexedDB outbox, cookies, service worker).
  const A = await new Device('A').start();
  const B = await new Device('B').start();
  const ctx = {};

  await scenario('S0', 'Open two independent Chair devices and prepare the fixture', async () => {
    for (const d of [A, B]) await d.goto('/chair/roll-call');
    await check('both devices are on the expected backend', async () => {
      const text = await A.page.locator('.workspace-footer').innerText();
      assert.ok(HOSTED ? !/Local demo/.test(text) : /Local demo/.test(text), `unexpected data mode: ${text.slice(-60)}`);
    });
    await check('the offline shell service worker controls both devices', async () => {
      for (const d of [A, B]) {
        await d.page.evaluate(() => navigator.serviceWorker.ready);
        // The first visit installs the worker; one reload makes the page controlled by it.
        if (!(await d.page.evaluate(() => !!navigator.serviceWorker.controller))) { await d.page.reload({waitUntil: 'domcontentloaded'}); await d.ready(); }
        assert.ok(await d.page.evaluate(() => !!navigator.serviceWorker.controller), `${d.name} is not controlled by the service worker`);
      }
    });
    const base = await A.base();
    const {delegates, sessionId} = scope(base);
    assert.ok(sessionId, 'no current session after selection');
    assert.ok(delegates.length >= 5, 'need at least 5 delegates in the committee');
    // Every delegate the rehearsal touches must be present so attendance, queue, speech and vote are all legal.
    for (const dg of delegates.slice(0, 5)) {
      const status = attendanceOf(base, dg.id, sessionId);
      if (!status || status === 'Absent') await A.attendance(dg.country, 'Present');
    }
    if (HOSTED) await A.drained();
    const settled = await authoritative(A);
    const s = scope(settled);
    const queued = new Set(openQueue(settled, s.sessionId).map(q => q.delegateId));
    ctx.sessionId = s.sessionId;
    ctx.resolutionId = s.resolution?.id;
    [ctx.dAtt, ctx.dPts, ctx.dVote, , ctx.dStale] = s.delegates.slice(0, 5);
    ctx.dQ = s.delegates.slice(3).find(x => !queued.has(x.id)) ?? s.delegates[3];
    log(`  fixture: session=${ctx.sessionId} delegates=${s.delegates.length} resolutionInDebate=${Boolean(ctx.resolutionId)} (ids only; countries ${ctx.dAtt.country}/${ctx.dPts.country}/${ctx.dVote.country}/${ctx.dQ.country}/${ctx.dStale.country})`);
    await check('both devices start with an empty outbox and a healthy strip', async () => {
      for (const d of [A, B]) {
        assert.equal((await d.pending()).length, 0);
        await d.stripIs(HOSTED ? /^(All changes synced|Sent · updating this view)$/ : /^Demo · saved in this browser$/);
      }
    });
    if (HOSTED) await B.nudge();
  });

  await scenario('S1', 'Devices are independent contexts', async () => {
    const before = digest(await B.base());
    const target = attendanceOf(await A.base(), ctx.dStale.id, ctx.sessionId) === 'Present' ? 'Present & Voting' : 'Present';
    await A.attendance(ctx.dStale.country, target);
    await check('A recorded the attendance change durably in its own IndexedDB', async () => {
      await eventually('A to persist', async () => HOSTED ? true : attendanceOf(await A.base(), ctx.dStale.id, ctx.sessionId) === target);
    });
    if (!HOSTED) {
      await check('demo: B (a separate context) is unaffected - no server exists to carry the change', async () => {
        assert.equal(digest(await B.base()), before);
        assert.notEqual(attendanceOf(await B.base(), ctx.dStale.id, ctx.sessionId), target);
      });
    }
    await hostedCheck('B converges to A\'s change through the server (Realtime or focus refresh)', async () => {
      await A.drained();
      await eventually('B to see the change', async () => attendanceOf(await B.base(), ctx.dStale.id, ctx.sessionId) === target, {timeout: SYNC_TIMEOUT, nudge: () => B.nudge()});
    });
  });

  await scenario('S2', 'Offline: queued attendance, speaker queue, speech score, participation points and a vote', async () => {
    const baseline = await authoritative(A);
    ctx.pre = {
      events: baseline.events.filter(e => e.sessionId === ctx.sessionId).length,
      speeches: speechesIn(baseline, ctx.sessionId).length,
      ptsPts: pointsOf(baseline, ctx.dPts.id),
      att: attendanceOf(baseline, ctx.dAtt.id, ctx.sessionId),
    };
    ctx.attTarget = ctx.pre.att === 'Present & Voting' ? 'Present' : 'Present & Voting';
    ctx.voteTarget = ctx.resolutionId && !SKIP_VOTES ? (votesOf(baseline, ctx.dVote.id, ctx.resolutionId, ctx.sessionId)[0]?.choice === 'For' ? 'Against' : 'For') : null;
    await A.setOffline(true);
    await check('A reports offline on the sync strip and in the browser', async () => {
      assert.equal(await A.page.evaluate(() => navigator.onLine), false);
      await A.stripIs(/^Offline/);
    });
    let actions = 0;
    await A.attendance(ctx.dAtt.country, ctx.attTarget); actions += 1;
    await A.queueAdd(ctx.dQ.country); actions += 1;
    ctx.spoke = await A.speech(); actions += 3; // speechStart + speechScore + speechFinish
    await A.participation(ctx.dPts.country, 'Speech', 2); actions += 1;
    if (ctx.voteTarget) { await A.vote(ctx.dVote.country, ctx.voteTarget); actions += 1; }
    ctx.actions = actions;
    await check('every offline action is on screen immediately and saved durably on A', async () => {
      const cp = await A.checkpoint();
      if (HOSTED) {
        assert.equal(cp.pending.length, actions, `expected ${actions} queued mutations`);
        assert.ok(cp.pending.every(m => m.state === 'pending'), 'queued mutations must not be conflicts yet');
        for (const type of ['attendance', 'queueAdd', 'speechStart', 'speechScore', 'speechFinish', 'participation']) assert.ok(cp.pending.some(m => m.command.type === type), `no queued ${type}`);
        await A.stripIs(new RegExp(`^Offline · ${actions} changes saved on this device$`));
      } else {
        assert.equal(attendanceOf(cp.base, ctx.dAtt.id, ctx.sessionId), ctx.attTarget);
        assert.equal(pointsOf(cp.base, ctx.dPts.id), ctx.pre.ptsPts + 2);
        assert.equal(speechesIn(cp.base, ctx.sessionId).length, ctx.pre.speeches + 1);
        assert.equal(cp.pending.length, 0, 'demo has no outbox: the base is written directly');
        await A.stripIs(/^Offline$/);
      }
    });
    await hostedCheck('nothing reached the server while A was offline, and B is unchanged', async () => {
      const server = await serverState();
      assert.equal(server.events.filter(e => e.sessionId === ctx.sessionId).length, ctx.pre.events, 'server events changed while A was offline');
      assert.equal(attendanceOf(server, ctx.dAtt.id, ctx.sessionId), ctx.pre.att, 'server attendance changed while A was offline');
      assert.equal(speechesIn(server, ctx.sessionId).length, ctx.pre.speeches, 'server speeches changed while A was offline');
      assert.equal(pointsOf(await B.base(), ctx.dPts.id), ctx.pre.ptsPts, 'B points changed while A was offline');
    });
    if (!HOSTED) await check('demo: B (a separate context) did not receive A\'s offline work', async () => assert.equal(pointsOf(await B.base(), ctx.dPts.id), ctx.pre.ptsPts));
  });

  await scenario('S3', 'Reload while offline with queued work (the IndexedDB outbox survives)', async () => {
    const before = await A.checkpoint();
    const pendingIds = before.pending.map(m => m.id);
    await A.page.reload({waitUntil: 'domcontentloaded'});
    await A.ready();
    await check('the offline shell loads from the service worker cache', async () => {
      assert.equal(await A.page.evaluate(() => navigator.onLine), false);
      await A.page.locator('.save-status').waitFor();
    });
    await check('queued work is still there after the reload', async () => {
      const after = await A.checkpoint();
      assert.deepEqual(after.pending.map(m => m.id), pendingIds, 'outbox ids changed across the reload');
      assert.equal(digest(after.base), digest(before.base));
      await A.stripIs(HOSTED ? new RegExp(`^Offline · ${ctx.actions} changes saved on this device$`) : /^Offline$/);
    });
    await check('the screen still shows A\'s offline attendance choice (projected from the outbox)', async () => {
      const page = await A.at('/chair/roll-call');
      const button = page.getByRole('group', {name: `Attendance for ${ctx.dAtt.country}`, exact: true}).getByRole('button', {name: new RegExp(`^(✓ )?${ctx.attTarget}$`)});
      await eventually('the choice to be selected', async () => (await button.getAttribute('aria-pressed')) === 'true');
    });
    await check('no page errors during the offline reload', async () => assert.deepEqual(A.errors, []));
  });

  await scenario('S4', 'Reconnect and automatic drain', async () => {
    await A.setOffline(false);
    await check('A leaves the Offline state and the outbox drains with no operator action', async () => {
      await A.stripIs(HOSTED ? /^(All changes synced|Sent · updating this view|Waiting to send.*|Saved on this device)$/ : /^Demo · saved in this browser$/, 30_000);
      await A.drained();
      if (HOSTED) await A.stripIs(/^All changes synced$/, SYNC_TIMEOUT);
    });
    await check('each queued action took effect exactly once (no duplicate speeches, events or votes)', async () => {
      const state = await authoritative(A);
      const s = scope(state);
      assert.equal(attendanceOf(state, ctx.dAtt.id, ctx.sessionId), ctx.attTarget);
      assert.equal(state.events.filter(e => e.sessionId === ctx.sessionId).length, ctx.pre.events + 2, 'one speech event plus one participation event');
      assert.equal(pointsOf(state, ctx.dPts.id), ctx.pre.ptsPts + 2);
      assert.equal(speechesIn(state, ctx.sessionId).length, ctx.pre.speeches + 1);
      assert.equal(speechesIn(state, ctx.sessionId).filter(x => x.state !== 'finished').length, 0, 'the floor was returned to the Chair');
      if (ctx.voteTarget) {
        const votes = votesOf(state, ctx.dVote.id, ctx.resolutionId, ctx.sessionId);
        assert.equal(votes.length, 1, 'exactly one vote for the delegate');
        assert.equal(votes[0].choice, ctx.voteTarget);
      }
      assert.deepEqual(duplicates(state.events).map(e => e.id), []);
      assert.ok(s.delegates.length >= 5);
    });
    await hostedCheck('B converges to the drained state', async () => {
      await eventually('B to match the server', async () => digest(await B.base()) === digest(await serverState()), {timeout: SYNC_TIMEOUT, nudge: () => B.nudge()});
    });
    await check('A shows no page errors after reconnecting', async () => assert.deepEqual(A.errors, []));
  });

  await scenario('S5', 'Retry behaviour under flaky or aborted requests', async () => {
    const before = await authoritative(A);
    const pts0 = pointsOf(before, ctx.dPts.id);
    const events0 = before.events.filter(e => e.sessionId === ctx.sessionId).length;
    if (HOSTED) {
      // Request 1 never reaches the server (connection failure). Request 2 reaches the server but its response is lost.
      // Request 3 passes. The Chair did one thing; the server must record one effect.
      let seen = 0;
      const log5 = new DeliveryLog();
      const rule = async route => {
        const request = route.request();
        if (request.method() !== 'POST') { await route.continue(); return; }
        seen += 1;
        const n = seen;
        if (n === 1) { log5.record('attempt 1 (dropped before the server)', request.postData(), undefined, undefined); await route.abort('connectionfailed'); return; }
        // Attempts 2+ really reach the server; the reply is captured BEFORE it is dropped (2) or passed on (3+).
        const upstream = await route.fetch();
        const text = await upstream.text();
        log5.record(`attempt ${n}${n === 2 ? ' (response then lost)' : ''}`, request.postData(), upstream.status(), text);
        if (n === 2) { await route.abort('connectionreset'); return; }
        await route.fulfill({response: upstream, body: text});
      };
      await A.ctx.route(`${supabaseOrigin}/rest/v1/rpc/apply_*_mutation*`, rule);
      try {
      await A.at('/chair/participation');
      await settle(A);
      await A.participation(ctx.dPts.country, 'Speech', 1);
      await check('the failed first attempt leaves the action queued on the device, not lost', async () => {
        await eventually('the first request to be seen', async () => seen >= 1);
        assert.equal((await A.pending()).length, 1);
      });
      await A.drained();
      } finally { await A.ctx.unroute(`${supabaseOrigin}/rest/v1/rpc/apply_*_mutation*`, rule); }
      await check('automatic retry used the SAME mutation (3 attempts) and the server holds exactly one effect', async () => {
        assert.ok(seen >= 3, `expected at least 3 attempts, saw ${seen}`);
        // The lost response must have followed an ACCEPTED commit, and every retry must be the same mutation and payload.
        log5.assertAccepted('attempt 2 (response then lost)');
        log5.assertIdentical(3);
        const server = await serverState();
        assert.equal(pointsOf(server, ctx.dPts.id), pts0 + 1, 'points counted once');
        assert.equal(server.events.filter(e => e.sessionId === ctx.sessionId).length, events0 + 1);
      });
    } else {
      // Demo has no mutation endpoint. What it can show: a failing network never blocks or duplicates a local save, and the
      // System health screen reports the failed service check instead of hiding it.
      await A.ctx.route('**/api/health', route => route.abort('connectionfailed'));
      await A.participation(ctx.dPts.country, 'Speech', 1);
      const health = await A.at('/chair/health');
      await health.getByText('Technical details').click();
      await check('demo: System health reports the unreachable service check while requests fail', async () => {
        await eventually('the failure to show', async () => /did not respond/.test(await health.locator('.tech-details').innerText()));
      });
      await A.ctx.unroute('**/api/health');
      await check('demo: the save during the failure was applied exactly once', async () => {
        const state = await A.base();
        assert.equal(pointsOf(state, ctx.dPts.id), pts0 + 1);
        assert.equal(state.events.filter(e => e.sessionId === ctx.sessionId).length, events0 + 1);
      });
    }
  });

  await scenario('S6', 'Idempotency: one Chair action, one effect', async () => {
    const before = await authoritative(A);
    const speeches0 = speechesIn(before, ctx.sessionId).length;
    const speechEvents0 = before.events.filter(e => e.sessionId === ctx.sessionId && e.categoryId === 'speech').length;
    await A.at('/chair');
    // Exercise finishing the ONLY queued speech: the queue's "No delegates waiting" text also exists while that speech is
    // still active, so it must never be mistaken for a committed return of the floor. Only this fixture session is touched.
    const queued = A.page.locator('ol[aria-label="open speaker queue"] li');
    while (await queued.count()) {
      const count = await queued.count();
      await queued.first().getByRole('button', {name: /^Remove .* from open speaker queue$/}).click();
      await eventually('the queued delegate to be removed durably', async () => (await queued.count()) === count - 1);
    }
    await A.queueAdd(ctx.dQ.country);
    // A fast double tap on Next speaker and on the speech score must start ONE speech and record ONE score.
    const spoke = await A.speech({double: true});
    await A.at('/chair/participation'); // Immediately hard-navigate: the speech helper must already have waited for durability.
    await check('double-tap: one speech started, one speech score recorded', async () => {
      if (HOSTED) await A.drained();
      const state = await authoritative(A);
      assert.equal(speechesIn(state, ctx.sessionId).length, speeches0 + 1);
      assert.equal(state.events.filter(e => e.sessionId === ctx.sessionId && e.categoryId === 'speech').length, speechEvents0 + 1);
      assert.equal(speechesIn(state, ctx.sessionId).filter(x => x.state !== 'finished').length, 0, `${spoke.country}'s speech was finished and the floor returned`);
    });
    await check('reloading does not replay the action', async () => {
      await A.page.reload({waitUntil: 'domcontentloaded'});
      await A.ready();
      if (HOSTED) await A.drained();
      const state = await authoritative(A);
      assert.equal(state.events.filter(e => e.sessionId === ctx.sessionId && e.categoryId === 'speech').length, speechEvents0 + 1);
      assert.deepEqual(duplicates(state.events).map(e => e.id), []);
      assert.deepEqual(duplicates(state.votes).map(v => v.id), []);
      assert.deepEqual(duplicates(speechesIn(state, ctx.sessionId)).map(x => x.id), []);
    });
    if (HOSTED) {
      const state = await serverState();
      const pts0 = pointsOf(state, ctx.dPts.id);
      let sent = 0;
      const log6 = new DeliveryLog();
      const rule = async route => {
        const request = route.request();
        if (request.method() !== 'POST') { await route.continue(); return; }
        sent += 1;
        // Deliver the SAME request (same mutation uuid and payload) to the server twice; capture both upstream replies and
        // answer the app with the first. A rejected replay is recorded and fails the check below, never hidden.
        const first = await route.fetch();
        const firstText = await first.text();
        log6.record(`request ${sent} delivery 1`, request.postData(), first.status(), firstText);
        const second = await route.fetch();
        log6.record(`request ${sent} delivery 2`, request.postData(), second.status(), await second.text());
        await route.fulfill({response: first, body: firstText});
      };
      await A.ctx.route(`${supabaseOrigin}/rest/v1/rpc/apply_*_mutation*`, rule);
      try {
        await A.at('/chair/participation');
        await settle(A);
        await A.participation(ctx.dPts.country, 'Speech', 2);
        await A.drained();
      } finally { await A.ctx.unroute(`${supabaseOrigin}/rest/v1/rpc/apply_*_mutation*`, rule); }
      await check('the server received the identical mutation twice and applied it once (+2, not +4)', async () => {
        assert.ok(sent >= 1);
        log6.assertAccepted(); // both deliveries: 2xx and no RPC error
        assert.ok(log6.records.length >= 2 && log6.records.length % 2 === 0, 'deliveries come in identical pairs');
        log6.assertIdentical(2);
        assert.equal(pointsOf(await serverState(), ctx.dPts.id), pts0 + 2);
      });
    }
    await hostedCheck('mutation receipts: a replayed mutation never creates a second row on the server', async () => {
      assert.deepEqual(duplicates((await serverState()).events).map(e => e.id), []);
    });
  });

  await scenario('S7', 'Stale conflict: an offline edit of an item another device changed', async () => {
    const dg = ctx.dStale;
    const startState = await authoritative(A);
    const start = attendanceOf(startState, dg.id, ctx.sessionId);
    const aWants = start === 'Present & Voting' ? 'Present' : 'Present & Voting';
    const bWants = start === 'Absent' ? 'Present' : 'Absent';
    if (HOSTED) {
      await eventually('B to see the same starting value', async () => attendanceOf(await B.base(), dg.id, ctx.sessionId) === start, {timeout: SYNC_TIMEOUT, nudge: () => B.nudge()});
      await A.at('/chair/roll-call');
      await A.setOffline(true);
      await A.stripIs(/^Offline/);
      await A.attendance(dg.country, aWants); // queued with the revision A last saw
      const pts0 = pointsOf(startState, ctx.dPts.id);
      await A.participation(ctx.dPts.country, 'Speech', 1); // queued BEHIND the soon-to-conflict action
      await B.attendance(dg.country, bWants); // online change to the same item
      await B.drained();
      await A.setOffline(false);
      await check('A reconnects and shows the conflict on the sync strip (not "synced")', async () => {
        await A.stripIs(/^Review needed$/, SYNC_TIMEOUT);
      });
      await check('A\'s stale change was RETAINED, flagged, and did not overwrite B', async () => {
        const pending = await A.pending();
        const att = pending.find(m => m.command.type === 'attendance');
        assert.equal(att?.state, 'conflict');
        assert.ok(att?.message, 'the conflict carries an explanation');
        assert.equal(attendanceOf(await serverState(), dg.id, ctx.sessionId), bWants);
      });
      await check('work queued behind the conflict stays queued, unsent, and is not lost', async () => {
        const pending = await A.pending();
        assert.ok(pending.some(m => m.command.type === 'participation' && m.state === 'pending'));
        assert.equal(pointsOf(await serverState(), ctx.dPts.id), pts0);
      });
      const health = await A.at('/chair/health');
      await check('System health lists the saved change for review with its original action', async () => {
        await health.getByRole('heading', {name: 'Review saved attendance change'}).waitFor({timeout: 15_000});
        await health.getByText('Original saved action').click();
        assert.match(await health.locator('pre').first().innerText(), /"type": "attendance"/);
      });
      await check('Retry does not force the conflicting change through', async () => {
        await health.getByRole('button', {name: 'Retry connection'}).click();
        await new Promise(resolve => setTimeout(resolve, 4000));
        assert.equal((await A.pending()).find(m => m.command.type === 'attendance')?.state, 'conflict');
        assert.equal(attendanceOf(await serverState(), dg.id, ctx.sessionId), bWants);
      });
      const dismiss = health.getByRole('button', {name: /^Keep conference value/});
      await check('Discard is gated behind Export: disabled until the recovery file is exported', async () => {
        assert.equal(await dismiss.isDisabled(), true);
        const [download] = await Promise.all([health.waitForEvent('download'), health.getByRole('button', {name: 'Export device recovery file'}).click()]);
        const { readFile } = await import('node:fs/promises');
        const text = await readFile(await download.path(), 'utf8');
        const exported = JSON.parse(text);
        assert.ok(exported.pending.some(m => m.command.type === 'attendance'), 'the recovery file contains the conflicted action');
        await eventually('Discard to enable', async () => (await dismiss.isDisabled()) === false);
      });
      await check('Discard (Keep conference value) clears the conflict and frees the queued work', async () => {
        await dismiss.click();
        await A.drained();
        await A.stripIs(/^All changes synced$/, SYNC_TIMEOUT);
        const server = await serverState();
        assert.equal(attendanceOf(server, dg.id, ctx.sessionId), bWants, 'conference value kept');
        assert.equal(pointsOf(server, ctx.dPts.id), pts0 + 1, 'the queued participation arrived exactly once');
        assert.ok(A.dialogs.some(m => /Dismiss this exported action/.test(m)));
      });
    } else {
      // Demo: the only stale-write path with no server is two tabs of ONE device sharing one IndexedDB. Tab 2 cannot hear
      // tab 1 (BroadcastChannel muted), so it holds a stale view; its save must be refused, not applied over tab 1's.
      const tab1 = A.page;
      await A.at('/chair/roll-call', tab1);
      const tab2 = await A.newPage();
      await tab2.addInitScript(() => { window.BroadcastChannel = class { postMessage() {} close() {} set onmessage(_) {} addEventListener() {} removeEventListener() {} }; });
      await A.goto('/chair/roll-call', {page: tab2});
      await A.attendance(dg.country, aWants); // tab 1 saves first (revision moves on)
      const group = tab2.getByRole('group', {name: `Attendance for ${dg.country}`, exact: true});
      await group.getByRole('button', {name: new RegExp(`^(✓ )?${bWants}$`)}).click();
      await check('demo: the stale tab\'s save is refused with an explanation (not applied over the newer value)', async () => {
        await eventually('the refusal notice', async () => /Another tab updated this item/.test(await tab2.locator('.toast').innerText()));
      });
      await check('demo: the stored value is still the newer one', async () => assert.equal(attendanceOf(await A.base(), dg.id, ctx.sessionId), aWants));
      await check('demo: the handled stale-tab refusal causes no uncaught page errors', async () => assert.deepEqual(A.errors, []));
      await tab2.close();
    }
    await hostedCheck('A converges to the conference value', async () => {
      await eventually('A to hold the conference value', async () => attendanceOf(await A.base(), dg.id, ctx.sessionId) === bWants, {timeout: SYNC_TIMEOUT, nudge: () => A.nudge()});
    });
  });

  await scenario('S8', 'System health: recovery tools are present and safe', async () => {
    const health = await A.at('/chair/health');
    await A.goto('/chair/health');
    await check('Retry connection is harmless when nothing is wrong', async () => {
      const before = digest(await A.base());
      await A.page.getByRole('button', {name: 'Retry connection'}).click();
      await new Promise(resolve => setTimeout(resolve, 1500));
      assert.equal(digest(await A.base()), before);
    });
    await check('Export device recovery file produces valid JSON of the device checkpoint', async () => {
      const [download] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', {name: 'Export device recovery file'}).click()]);
      const { readFile } = await import('node:fs/promises');
      const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.ok(Array.isArray(exported.pending) && exported.base?.conference?.id);
    });
    await check('no conflict panel is shown when there is no conflict', async () => assert.equal(await A.page.getByText(/^Review saved .* change$/).count(), 0));
    void health;
  });

  await scenario('S9', 'Final consistency', async () => {
    await check('no device has queued or conflicting work left', async () => {
      for (const d of [A, B]) { await d.drained(); assert.equal((await d.pending()).length, 0); }
    });
    await check('no duplicate event, vote, queue or speech ids on any device', async () => {
      for (const d of [A, B]) {
        const state = await d.base();
        assert.deepEqual(duplicates(state.events).map(e => e.id), []);
        assert.deepEqual(duplicates(state.votes).map(e => e.id), []);
        assert.deepEqual(duplicates(state.queue).map(e => e.id), []);
        assert.deepEqual(duplicates(speechesIn(state, ctx.sessionId)).map(e => e.id), []);
      }
    });
    await check('the on-screen points leaderboard equals the points derived from the stored events (points counted once)', async () => {
      for (const d of [A, B]) {
        // Navigation can refresh a stale device. Compare its live DOM and checkpoint AFTER that refresh, allowing the
        // render/read to settle without navigating again or accepting any points discrepancy.
        await d.at('/chair');
        await eventually(`${d.name} leaderboard and current checkpoint to agree`, async () => {
          const shown = await d.leaderboard();
          const state = await d.base();
          for (const dg of scope(state).delegates) assert.equal(shown[dg.country], pointsOf(state, dg.id), `${d.name} ${dg.country}`);
        }, {timeout: SYNC_TIMEOUT});
      }
    });
    await hostedCheck('both devices and the server hold the same state (attendance, events, points, votes, queue, speeches)', async () => {
      await eventually('A and B to match the server', async () => {
        const server = digest(await serverState());
        return digest(await A.base()) === server && digest(await B.base()) === server;
      }, {timeout: SYNC_TIMEOUT, nudge: async () => { await A.nudge(); await B.nudge(); }});
    });
    await hostedCheck('the sync strip on both devices says All changes synced', async () => {
      for (const d of [A, B]) await d.stripIs(/^All changes synced$/, SYNC_TIMEOUT);
    });
    if (!HOSTED) await check('demo: the two devices hold DIFFERENT state - they only converge through a server (hosted mode)', async () => {
      assert.notEqual(digest(await A.base()), digest(await B.base()));
    });
    await check('no uncaught page errors on either device in the whole run', async () => {
      assert.deepEqual([...A.errors, ...B.errors], []);
    });
  });

  // Optional measurement (REHEARSAL_PROBE_SEND_LATENCY=1, hosted): an action recorded while the device's opening sync read is
  // still in flight. Records how long it waits for the next automatic send with NO focus/online nudges. Informational: it
  // reports the latency, it does not fail the run.
  if (HOSTED && process.env.REHEARSAL_PROBE_SEND_LATENCY === '1') await scenario('S10', 'Probe: action recorded during an in-flight sync read', async () => {
    await A.page.goto(baseUrl + '/chair/participation', {waitUntil: 'domcontentloaded'});
    await A.page.locator('.participation-row').first().waitFor({timeout: 45_000});
    const start = Date.now();
    await A.participation(ctx.dPts.country, 'Speech', 1);
    await eventually('the action to be sent without any nudge', async () => (await A.pending()).length === 0, {timeout: 170_000, every: 1000});
    log(`  NOTE send latency with no nudge: ${Math.round((Date.now() - start) / 1000)} s`);
  });
}

main().catch(error => {
  console.error(`REHEARSAL ABORTED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
