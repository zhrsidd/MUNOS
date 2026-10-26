import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import nextEnv from '@next/env';
import { publicQrPlan, newPublicQrReport, verifyPublicQr, within, QrVerificationError, type StaffTokens } from './verification/public-qr';

// No defaults for the app, fixture, conference or report. Run only before cutover with synthetic data.
// See docs/PUBLIC_QR_VERIFICATION.md. Configuration is checked before any connection is constructed.
nextEnv.loadEnvConfig(process.cwd());
const value = (key: string) => {
  const matches = process.argv.slice(2).filter(x => x === key).length;
  if (matches !== 1) throw new QrVerificationError(`Supply ${key} exactly once.`);
  const result = process.argv[process.argv.indexOf(key) + 1];
  if (!result || result.startsWith('--')) throw new QrVerificationError(`Supply a value for ${key}.`);
  return result;
};
let report: ReturnType<typeof newPublicQrReport> | undefined;
let artifact: Awaited<ReturnType<typeof open>> | undefined;
try {
  const known = new Set(['--base-url', '--conference-id', '--fixture', '--output', '--preflight']);
  for (const argument of process.argv.slice(2)) if (argument.startsWith('--') && !known.has(argument)) throw new QrVerificationError('Unknown public QR verifier option.');
  let fixture: unknown;
  try { fixture = JSON.parse(await readFile(value('--fixture'), 'utf8')); } catch { throw new QrVerificationError('Cannot read the supplied JSON fixture.'); }
  const plan = publicQrPlan(fixture, { baseUrl: value('--base-url'), conferenceId: value('--conference-id'), output: value('--output') }, process.env);
  // Refuse symlink escapes as well as lexical ../ escapes. Open exclusively so no tracked or previous result is overwritten.
  await mkdir(dirname(plan.output), { recursive: true, mode: 0o700 });
  const actualParent = await realpath(dirname(plan.output));
  const cwd = await realpath(process.cwd());
  if (!['artifacts', '.test-sessions'].some(dir => actualParent === resolve(cwd, dir) || within(resolve(cwd, dir), actualParent))) throw new QrVerificationError('Artifact directory escapes the ignored output roots.');
  artifact = await open(plan.output, 'wx', 0o600);
  report = newPublicQrReport(plan);
  if (process.argv.includes('--preflight')) {
    report.limits.push('Preflight only: no connections, link lookups, pages or submissions were attempted.');
    await artifact.writeFile(JSON.stringify({ ...report, status: 'preflight-only' }, null, 2) + '\n');
    console.log('Public QR preflight passed. No requests were made; ignored artifact written.');
  } else {
    if (!process.env.SUPABASE_SECRET_KEY) throw new QrVerificationError('Server-only key must be supplied through an ignored local environment.');
    let staff: StaffTokens | undefined;
    if (plan.fixture.staff) {
      staff = {} as StaffTokens;
      for (const role of ['chair', 'approval', 'logistics'] as const) {
        try {
          const saved = JSON.parse(await readFile(plan.fixture.staff[role], 'utf8'));
          if (typeof saved.access_token !== 'string' || !saved.access_token) throw new QrVerificationError('missing token');
          if (typeof saved.expires_at !== 'number' || saved.expires_at * 1000 < Date.now() + 120_000) throw new QrVerificationError('expired');
          staff[role] = saved.access_token;
        } catch { throw new QrVerificationError('Optional staff session file is invalid or expires within two minutes. This verifier never signs in or refreshes sessions.'); }
      }
    }
    await verifyPublicQr(plan, process.env, report, staff);
    await artifact.writeFile(JSON.stringify(report, null, 2) + '\n');
    console.log('Public QR verification passed. Read the ignored JSON artifact for checks, created synthetic rows and limits.');
  }
} catch (error) {
  // Never stringify backend errors, request bodies, sessions, links or keys. Error text is deliberately omitted.
  if (artifact && report) {
    report.status = 'failed'; report.failedCheck = error instanceof QrVerificationError ? error.message : 'Unexpected verification failure; inspect the last completed check locally.';
    report.completedAt = new Date().toISOString();
    await artifact.writeFile(JSON.stringify(report, null, 2) + '\n');
  }
  console.error(error instanceof QrVerificationError ? error.message : 'Unexpected verification failure. Check the ignored report; do not mark the hosted gate verified.');
  process.exitCode = 1;
} finally { await artifact?.close(); }
