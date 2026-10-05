// Verify a deployed Conference OS URL (Preview or Production).
//   npm run verify:deployment -- https://conference-os.example.com [expected-commit]
// Checks the health endpoint, build identity and that the operational screens load.
const [base, expectedCommit] = process.argv.slice(2);
if (!base) { console.error("Usage: npm run verify:deployment -- <url> [expected-commit-sha]"); process.exit(2); }
const root = base.replace(/\/$/, "");
const results: [string, boolean, string][] = [];
async function check(name: string, run: () => Promise<string>) {
  try { results.push([name, true, await run()]); } catch (error) { results.push([name, false, error instanceof Error ? error.message : String(error)]); }
}
await check("Health endpoint", async () => {
  const response = await fetch(`${root}/api/health`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.status === "down") throw Error(`status ${body.status} (HTTP ${response.status})`);
  if (expectedCommit && !String(body.app.commit).startsWith(expectedCommit)) throw Error(`running ${body.app.commit || "unknown"}, expected ${expectedCommit}`);
  return `${body.status} · ${body.app.version} · ${String(body.app.commit).slice(0, 7) || "no commit"} · ${body.app.environment} · supabase ${body.checks.supabase.status} · storage ${body.checks.storage.status}`;
});
for (const path of ["/chair", "/approval", "/logistics", "/admin/health", "/projector"]) {
  await check(`Page ${path}`, async () => {
    const response = await fetch(`${root}${path}`, { redirect: "manual" });
    if (response.status !== 200) throw Error(`HTTP ${response.status}`);
    return "200";
  });
}
await check("Unknown submission link is rejected", async () => {
  const response = await fetch(`${root}/submit/not-a-real-link-000000000000`);
  const text = await response.text();
  if (!/not valid/i.test(text)) throw Error(`unexpected response (HTTP ${response.status})`);
  return "rejected";
});
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(36)} ${detail}`);
process.exit(results.every(r => r[1]) ? 0 : 1);
