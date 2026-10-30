// Offline checker for the load-window evidence directory (docs/LOAD_RUN_SHEET_2026-10-31.md). Pure rules plus a local
// directory walk: no network, no environment reads. A finding names the file, the line and the rule, NEVER the matched text,
// so running the checker cannot itself spread a secret into a log or terminal scrollback.
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

export interface Finding { file: string; line?: number; rule: string }
export interface EvidenceResult { ok: boolean; findings: Finding[]; missing: string[]; scanned: number; unscanned: string[] }

export const STAGES = ['S0', 'R1', 'R2', 'R3', 'H3'] as const;
/** Files that must exist before the evidence folder is called complete (relative to the evidence root). */
export const REQUIRED_FILES = [
  'SUMMARY.md', 'preflight/preflight-record.md', 'preflight/target-guard.json', 'preflight/fingerprint-before.txt', 'preflight/migrations.txt',
  ...STAGES.flatMap(s => [`stage-${s}/command.txt`, `stage-${s}/report.json`, `stage-${s}/go-no-go.md`, `stage-${s}/fingerprint-after.txt`]),
  'dashboard/metrics-log.csv', 'incidents/incident-log.md',
  'cleanup/fixture-A-revoke-verify.txt', 'cleanup/fixture-B-revoke-verify.txt', 'cleanup/retirement-pending.md',
];
const TEXT = new Set(['.md', '.txt', '.json', '.csv', '.sql', '.log', '.tsv']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']); // cannot be scanned: a person must look before they are kept
const MAX_TEXT_BYTES = 5_000_000;
const FORBIDDEN_NAMES = [/^\.env/i, /^development\.json$/i, /^identities\.json$/i, /^rehearsal-multi-identities\.json$/i, /^\.test-sessions$/i, /^(chair-\d+|approval|admins|executive)\.json$/i];
/** Secret-carrying variable names; a value is acceptable only when it is empty, a $placeholder, <placeholder>, (note) or REDACTED. */
const SECRET_NAMES = 'SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|VERCEL_AUTOMATION_BYPASS_SECRET|SUBMIT_TOKEN|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|REFRESH_TOKEN|ACCESS_TOKEN';
const ASSIGNMENT = new RegExp(`\\b(?:${SECRET_NAMES})\\b["']?\\s*=\\s*(\\S*)`, 'g');
const RULES: { rule: string; pattern: RegExp }[] = [
  { rule: 'JWT-like token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { rule: 'Supabase secret/publishable key prefix', pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{6,}/ },
  { rule: 'staff access code (six groups of four hex characters)', pattern: /\b[0-9A-Fa-f]{4}(?:-[0-9A-Fa-f]{4}){5}\b/ },
  { rule: 'access code without separators (24 hex characters)', pattern: /(?<![0-9A-Za-z])[0-9A-Fa-f]{24}(?![0-9A-Za-z])/ },
  { rule: 'public submission link with a token', pattern: /\/submit\/[A-Za-z0-9_-]{22,64}/ },
  { rule: 'literal --submit-token value', pattern: /--submit-token[ =]+["']?[A-Za-z0-9_-]{22,}/ },
  { rule: 'session token field with a value', pattern: /["'](?:access_token|refresh_token)["']\s*:\s*["'][^"']+/ },
  { rule: 'Authorization bearer value', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  { rule: 'Vercel protection bypass header value', pattern: /x-vercel-protection-bypass["']?\s*[:=]\s*["']?[^\s"'$<]+/i },
  { rule: 'database URL with a password', pattern: /\bpostgres(?:ql)?:\/\/[^:\s/@]+:[^@\s]+@/i },
];
const harmless = (value: string) => { const v = value.replace(/^["']|["']$/g, ''); return v === '' || v.startsWith('$') || v.startsWith('<') || v.startsWith('(') || /^REDACTED$/i.test(v) || /^\*+$/.test(v); };

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { rule, pattern } of RULES) if (pattern.test(line)) findings.push({ file, line: index + 1, rule });
    for (const match of line.matchAll(ASSIGNMENT)) if (!harmless(match[1])) { findings.push({ file, line: index + 1, rule: 'secret variable assigned a value' }); break; }
  });
  return findings;
}
/** A runner report copied into evidence must have its `samples` array removed (jq 'del(.samples)'). */
export function scanReport(file: string, text: string): Finding[] {
  if (!/(^|\/)report[^/]*\.json$/i.test(file)) return [];
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && 'samples' in parsed ? [{ file, rule: 'runner report still contains the samples array' }] : [];
  } catch { return [{ file, rule: 'report is not valid JSON' }]; }
}

async function walk(root: string, rel: string, out: { files: string[]; findings: Finding[] }) {
  for (const entry of await readdir(join(root, rel))) {
    const path = rel ? `${rel}/${entry}` : entry;
    if (FORBIDDEN_NAMES.some(p => p.test(entry))) out.findings.push({ file: path, rule: 'forbidden file name (secret or session material)' });
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) out.findings.push({ file: path, rule: 'symbolic link' });
    else if (info.isDirectory()) await walk(root, path, out);
    else out.files.push(path);
  }
}
export async function checkEvidenceDir(root: string, options: { allowIncomplete?: boolean } = {}): Promise<EvidenceResult> {
  const out = { files: [] as string[], findings: [] as Finding[] };
  await walk(root, '', out);
  const unscanned: string[] = [];
  let scanned = 0;
  for (const file of out.files) {
    const ext = extname(file).toLowerCase();
    if (IMAGE.has(ext)) { unscanned.push(file); continue; }
    if (!TEXT.has(ext)) { out.findings.push({ file, rule: `unexpected file type ${ext || '(none)'}` }); continue; }
    const info = await lstat(join(root, file));
    if (info.size > MAX_TEXT_BYTES) { out.findings.push({ file, rule: 'text file too large to review' }); continue; }
    const text = await readFile(join(root, file), 'utf8');
    scanned++;
    out.findings.push(...scanText(file, text), ...scanReport(file, text));
  }
  const missing = REQUIRED_FILES.filter(f => !out.files.includes(f));
  return { ok: out.findings.length === 0 && (options.allowIncomplete || missing.length === 0), findings: out.findings, missing, scanned, unscanned };
}
