// Local, offline check of the load-window evidence folder (see docs/LOAD_RUN_SHEET_2026-10-31.md, "Evidence").
//   npm run check:load-evidence -- evidence/load-2026-10-31 [--allow-incomplete]
// Reads files under the given directory only. Never prints matched text; findings give file, line and rule.
import { checkEvidenceDir } from './verification/evidence-check';
const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
if (!dir) { console.error('Usage: npm run check:load-evidence -- <evidence-directory> [--allow-incomplete]'); process.exit(2); }
const result = await checkEvidenceDir(dir, { allowIncomplete: args.includes('--allow-incomplete') }).catch((e: Error) => { console.error(`Cannot read ${dir}: ${e.message}`); process.exit(2); });
for (const f of result.findings) console.log(`FORBIDDEN  ${f.file}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
for (const f of result.missing) console.log(`${args.includes('--allow-incomplete') ? 'pending  ' : 'MISSING  '}${f}`);
for (const f of result.unscanned) console.log(`REVIEW BY EYE (image/PDF cannot be scanned; crop any key, token or code)  ${f}`);
console.log(JSON.stringify({ ok: result.ok, textFilesScanned: result.scanned, findings: result.findings.length, missing: result.missing.length, imagesToReview: result.unscanned.length }));
process.exitCode = result.ok ? 0 : 1;
