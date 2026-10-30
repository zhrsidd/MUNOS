import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REQUIRED_FILES, checkEvidenceDir, scanReport, scanText } from '../scripts/verification/evidence-check';

// Fake secrets are assembled at run time so this source file never contains a scannable secret.
const jwt = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcDEF123456_-xyz'].join('.');
const secretKey = 'sb_' + 'secret_' + 'AbCdEf0123456789';
const publishable = 'sb_' + 'publishable_' + 'AbCdEf0123456789';
const code = ['1a2b', '3c4d', '5e6f', '7a8b', '9c0d', 'e1f2'].join('-');
const token = 'Zx9_' + 'Qw8-Er7TyUiOpAsDfGh12';

async function folder(files: Record<string, string> = {}, complete = true) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  const all = complete ? { ...Object.fromEntries(REQUIRED_FILES.map(f => [f, f.endsWith('.json') ? '{"ok":true}' : 'recorded'])), ...files } : files;
  for (const [name, body] of Object.entries(all)) { await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), body); }
  return root;
}
const rules = (text: string) => scanText('x.md', text).map(f => f.rule);

test('a complete folder with only placeholders and ordinary identifiers passes', async () => {
  const root = await folder({
    'stage-H3/command.txt': 'npm run rehearsal:run -- --app "$PREVIEW" --identities "$B/identities.json" --submit-token "$SUBMIT_TOKEN" --submit-committee GA1',
    'preflight/preflight-record.md': 'Ref kllhswucdhqqywnzxado. Conference 0331ceb6-3fa8-4731-92cb-2b4c0316d0cb. Commit d2e9e0c1b2a3d4e5f60718293a4b5c6d7e8f9012. SUBMIT_TOKEN=$SUBMIT_TOKEN, SUPABASE_SECRET_KEY=<set in shell>, VERCEL_AUTOMATION_BYPASS_SECRET= (unset)',
  });
  try {
    const result = await checkEvidenceDir(root);
    assert.deepEqual(result.findings, []); assert.deepEqual(result.missing, []); assert.equal(result.ok, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('each forbidden pattern is detected and reported without echoing the value', async () => {
  const cases: [string, string][] = [
    ['JWT-like token', `x ${jwt}`], ['Supabase secret/publishable key prefix', `key ${secretKey}`], ['Supabase secret/publishable key prefix', publishable],
    ['staff access code (six groups of four hex characters)', `code ${code.toUpperCase()}`], ['access code without separators (24 hex characters)', `code ${code.replaceAll('-', '')}`],
    ['public submission link with a token', `https://p.vercel.app/submit/${token}`], ['literal --submit-token value', `--submit-token "${token}"`],
    ['secret variable assigned a value', 'SUPABASE_SECRET_KEY=' + 'abc123'], ['secret variable assigned a value', 'export SUBMIT_TOKEN="' + token + '"'],
    ['session token field with a value', '{"refresh_token":"abcdef"}'], ['Authorization bearer value', `Authorization: Bearer ${'a'.repeat(30)}`],
    ['Vercel protection bypass header value', 'x-vercel-protection-bypass: ' + 'abcdef123'], ['database URL with a password', 'postgres://postgres:' + 'pw@127.0.0.1:5432/db'],
  ];
  for (const [rule, text] of cases) assert.ok(rules(text).includes(rule), `${rule} not found in: ${rule}`);
  const finding = scanText('f.md', `ok\nline ${secretKey}`)[0];
  assert.deepEqual(finding, { file: 'f.md', line: 2, rule: 'Supabase secret/publishable key prefix' });
  assert.ok(!JSON.stringify(scanText('f.md', `${jwt} ${code} ${token}`)).includes(jwt));
});

test('ordinary evidence is not flagged: UUIDs, SHAs, placeholders and prose about keys', () => {
  const ok = [
    'conference 0331ceb6-3fa8-4731-92cb-2b4c0316d0cb', 'sha 4db21e590696fc8a5152507551568927ef06a030', 'sha256 d5cad3dba472bb77f623d9ee5296218de0b19afbfe24ab40fc2a9eb41c4a9d9d',
    'The sb_secret_ prefix and SUPABASE_SECRET_KEY must stay out of this folder.', 'SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY', 'SUBMIT_TOKEN=REDACTED', 'SUBMIT_TOKEN=',
    '--submit-token "$SUBMIT_TOKEN"', 'https://x.vercel.app/submit/<token>', 'Bearer <token>', '{"access_token":""}', 'time 2026-10-31T13:05:00Z',
  ];
  for (const text of ok) assert.deepEqual(scanText('a.md', text), [], text);
});

test('forbidden names, links, unexpected types, report samples and oversized files are flagged', async () => {
  const root = await folder({ '.env.local': 'x', 'cleanup/identities.json': '{}', 'stage-S0/report.json': '{"samples":[]}', 'notes/run.xlsx': 'x', 'dashboard/cpu.png': 'png' });
  await symlink('/etc/hostname', join(root, 'incidents/link.txt'));
  try {
    const result = await checkEvidenceDir(root);
    const by = (file: string) => result.findings.filter(f => f.file === file).map(f => f.rule);
    assert.ok(by('.env.local')[0].startsWith('forbidden file name'));
    assert.ok(by('cleanup/identities.json')[0].startsWith('forbidden file name'));
    assert.deepEqual(by('stage-S0/report.json'), ['runner report still contains the samples array']);
    assert.ok(by('notes/run.xlsx')[0].startsWith('unexpected file type'));
    assert.deepEqual(by('incidents/link.txt'), ['symbolic link']);
    assert.deepEqual(result.unscanned, ['dashboard/cpu.png']);
    assert.equal(result.ok, false);
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.deepEqual(scanReport('stage-H3/report.json', '{not json'), [{ file: 'stage-H3/report.json', rule: 'report is not valid JSON' }]);
  assert.deepEqual(scanReport('stage-H3/command.txt', '{"samples":[]}'), []);
});

test('a missing required file fails unless incomplete evidence is explicitly allowed', async () => {
  const root = await folder({ 'SUMMARY.md': 'partial', 'stage-S0/command.txt': 'npm run rehearsal:run' }, false);
  try {
    const strict = await checkEvidenceDir(root);
    assert.equal(strict.ok, false); assert.ok(strict.missing.includes('stage-H3/report.json')); assert.deepEqual(strict.findings, []);
    const partial = await checkEvidenceDir(root, { allowIncomplete: true });
    assert.equal(partial.ok, true); assert.equal(partial.missing.length, REQUIRED_FILES.length - 2);
    await writeFile(join(root, 'SUMMARY.md'), `leaked ${jwt}`);
    assert.equal((await checkEvidenceDir(root, { allowIncomplete: true })).ok, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the checker is local only and the required layout names every run stage and both fixtures', () => {
  for (const stage of ['S0', 'R1', 'R2', 'R3', 'H3']) for (const name of ['command.txt', 'report.json', 'go-no-go.md', 'fingerprint-after.txt']) assert.ok(REQUIRED_FILES.includes(`stage-${stage}/${name}`));
  for (const fixture of ['A', 'B']) assert.ok(REQUIRED_FILES.includes(`cleanup/fixture-${fixture}-revoke-verify.txt`));
  assert.ok(REQUIRED_FILES.includes('preflight/migrations.txt'), 'the session-model schema check (PF3b) is part of the evidence');
});
