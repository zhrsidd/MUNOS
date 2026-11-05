#!/usr/bin/env node
// Standalone read-only local monitor. Never calls a model. Does not run until invoked.
// Requires Node >=20 and the MUNOS repo's existing @supabase/supabase-js dependency.
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir, rename, open, unlink, stat, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  initialState, evaluateSnapshot, canPlaceCall, recordCallAttempt, phoneScript, clearRecoveredIncidents,
  interpretHealthReport,
} from "./core.mjs";

const root = process.env.JARVIS_STATE_DIR || join(homedir(), ".local", "state", "dcmun-jarvis");
const statePath = join(root, "state.json");
const armedPath = join(root, "armed.flag");
const lockPath = join(root, "monitor.lock");
const reportPath = join(root, "latest.md");

async function makeRoot() { await mkdir(root, { recursive: true, mode: 0o700 }); }
async function readState() {
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    return saved.version === 1 ? saved : initialState();
  } catch (error) {
    if (error.code === "ENOENT") return initialState();
    throw error; // Fail closed rather than resetting the call budget.
  }
}
async function saveState(state) {
  const tmp = statePath + "." + process.pid + ".tmp";
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(tmp, statePath);
}
async function isArmed() {
  try { await stat(armedPath); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function keyForSilyring() {
  if (process.env.SILYRING_DEVICE_KEY?.trim()) return process.env.SILYRING_DEVICE_KEY.trim();
  try { return (await readFile(join(homedir(), ".silyring", "key"), "utf8")).trim(); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
function settings() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const conferenceId = process.env.CONFERENCE_ID || process.env.NEXT_PUBLIC_CONFERENCE_ID;
  if (!url || !key || !conferenceId) {
    throw Error("Missing SUPABASE_URL, SUPABASE_SECRET_KEY or CONFERENCE_ID in the local environment");
  }
  if (new URL(url).hostname !== "kllhswucdhqqywnzxado.supabase.co") {
    throw Error("Refusing any target other than the verified DCMUN Production project");
  }
  if (!/^[0-9a-f-]{36}$/i.test(conferenceId)) throw Error("Unexpected conference ID");
  return { url, key, conferenceId };
}
// Source of truth for the database signal. "health" (default whenever MUNOS_HEALTH_URL is set)
// reads the app's public /api/health report, which needs no database credentials and works with
// the project's hardened grants. "tables" (JARVIS_SOURCE=tables) runs direct count reads and needs
// SUPABASE_SECRET_KEY plus table SELECT grants, which the hardened DCMUN project does not give it.
function healthSourceEnabled() {
  const mode = (process.env.JARVIS_SOURCE || "").trim().toLowerCase();
  if (mode === "tables") return false;
  if (mode && mode !== "health") throw Error("JARVIS_SOURCE must be 'health' or 'tables'");
  return Boolean(process.env.MUNOS_HEALTH_URL?.trim());
}
function validatedHealthUrl() {
  const healthUrl = process.env.MUNOS_HEALTH_URL?.trim();
  if (!healthUrl) throw Error("MUNOS_HEALTH_URL is required for the app health source");
  const parsed = new URL(healthUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw Error("MUNOS_HEALTH_URL must use HTTPS (or local development localhost)");
  }
  return healthUrl;
}
// One GET to the app's health endpoint. Never throws on network or parse problems:
//  - no valid response            -> siteOk=false, databaseOk=null (database state unknown)
//  - database or Supabase "down"  -> siteOk=true,  databaseOk=false
//  - database "ok" or "degraded"  -> siteOk=true,  databaseOk=true ("degraded" only means slow)
//  - database not_configured      -> siteOk=true,  databaseOk=null (unverifiable, never a strike)
// Population counts and the conference record are not part of this report, so those rules stay idle.
async function collectFromHealth() {
  const healthUrl = validatedHealthUrl();
  let response, body;
  try {
    response = await fetch(healthUrl, {
      method: "GET", redirect: "manual", headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    body = (await response.text()).slice(0, 65_536);
  } catch { return { databaseOk: null, siteOk: false }; }
  return interpretHealthReport(response.status, body);
}
async function collect() {
  if (healthSourceEnabled()) return collectFromHealth();
  const { url, key, conferenceId } = settings();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const healthUrl = process.env.MUNOS_HEALTH_URL?.trim();
  let siteOk = null;
  if (healthUrl) {
    const parsed = new URL(healthUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw Error("MUNOS_HEALTH_URL must use HTTPS (or local development localhost)");
    }
    try {
      const response = await fetch(healthUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
      siteOk = response.ok || (response.status >= 300 && response.status < 400);
    } catch { siteOk = false; }
  }
  try {
    const conference = await client.from("conferences").select("id").eq("id", conferenceId).limit(1)
      .abortSignal(AbortSignal.timeout(8000));
    if (conference.error) throw conference.error;
    if (!conference.data?.length) return { databaseOk: true, conferenceExists: false, siteOk };

    // Count-only reads: do not fetch delegate names, emails, access codes or audit details.
    const [delegates, committees] = await Promise.all([
      client.from("delegates").select("id", { count: "exact", head: true }).eq("conference_id", conferenceId)
        .abortSignal(AbortSignal.timeout(8000)),
      client.from("committees").select("id", { count: "exact", head: true }).eq("conference_id", conferenceId)
        .abortSignal(AbortSignal.timeout(8000)),
    ]);
    if (delegates.error || committees.error || delegates.count == null || committees.count == null) {
      throw Error("Count query failed");
    }
    return {
      databaseOk: true, conferenceExists: true, siteOk,
      counts: { delegates: delegates.count, committees: committees.count },
    };
  } catch {
    return { databaseOk: false, siteOk }; // Error text intentionally omitted; may contain credentials.
  }
}
async function acquireLock() {
  try { return await open(lockPath, "wx", 0o600); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const age = Date.now() - (await stat(lockPath)).mtimeMs;
    if (age < 10 * 60_000) return null;
    await rm(lockPath, { force: true });
    try { return await open(lockPath, "wx", 0o600); }
    catch (error2) { if (error2.code === "EEXIST") return null; throw error2; }
  }
}
async function writeReport(item, sample) {
  const when = new Date().toISOString();
  const markdown = [
    "# DCMUN JARVIS — urgent incident",
    "", `**Time:** ${when}`, `**Incident:** ${item.id}`,
    `**Severity:** ${item.severity}`,
    "", "## Assessment", item.title, "",
    "## Evidence", item.evidence, "",
    "## Suggested response", item.action, "",
    "## Check context",
    `Database check: ${sample.databaseOk === null ? "not verified" : sample.databaseOk ? "healthy" : "failed"}`,
    `Application health check: ${sample.siteOk == null ? "not configured" : sample.siteOk ? "responding" : "failed"}`,
    "", "This report contains no delegate personal details. Confirm the issue in the application before intervening.",
  ].join("\n");
  await writeFile(reportPath, markdown, { mode: 0o600 });
  await writeFile(join(root, "latest.json"), JSON.stringify({ at: when, ...item }, null, 2), { mode: 0o600 });
}
async function placeCall(item, key) {
  const url = "https://api.silyring.com/call/" + encodeURIComponent(key) +
    "?nameCaller=" + encodeURIComponent("DCMUN JARVIS");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: phoneScript(item),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Error("Silyring returned HTTP " + response.status);
}
async function runOnce() {
  await makeRoot();
  const lock = await acquireLock();
  if (!lock) { console.log("Another JARVIS check is running; skipped."); return; }
  try {
    const state = await readState();
    const snapshot = await collect();
    const result = evaluateSnapshot(snapshot, state);
    result.state.lastCheckAt = new Date().toISOString();
    // A resolved incident may be reported again if it genuinely recurs, but only once its own
    // signal confirms recovery; an inconclusive check keeps it marked as already notified.
    clearRecoveredIncidents(result.state, snapshot);
    await saveState(result.state);
    if (!result.incidents.length) {
      const word = value => (value === null || value === undefined) ? "not verified" : value ? "ok" : "FAILED";
      const strikes = Object.entries(result.state.consecutive).filter(([, n]) => n > 0)
        .map(([name, n]) => name + "=" + n).join(", ") || "none";
      // local only; no notification
      console.log(`Check completed; no urgent incidents. database: ${word(snapshot.databaseOk)}; ` +
        `site: ${word(snapshot.siteOk)}; open strikes: ${strikes}.`);
      return;
    }
    // Only the highest-priority incident from this check can generate a call.
    const item = result.incidents.find(incident =>
      !result.state.notifiedActive[incident.id]) || result.incidents[0];
    await writeReport(item, snapshot); // Always write report BEFORE contacting user.
    console.log("Incident report saved:", reportPath, "(" + item.id + ")");
    if (!(await isArmed())) { console.log("Not armed; Silyring call suppressed."); return; }
    const callEligibility = canPlaceCall(result.state, item.id);
    if (!callEligibility.allowed) { console.log("Call suppressed:", callEligibility.reason); return; }
    const key = await keyForSilyring();
    if (!key) { console.error("No local Silyring device key; cannot call."); return; }
    // Record the attempt before network I/O; if the response is lost, NEVER redial blindly.
    recordCallAttempt(result.state, item.id);
    await saveState(result.state);
    try { await placeCall(item, key); console.log("Urgent call request sent."); }
    catch (error) { console.error("Call request failed (not retried):", error.message); }
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
async function main() {
  const command = process.argv[2] || "--status";
  await makeRoot();
  if (command === "--status") {
    const state = await readState();
    console.log(JSON.stringify({
      armed: await isArmed(),
      lastCheckAt: state.lastCheckAt || null,
      source: healthSourceEnabled() ? "app-health-endpoint" : "supabase-tables",
      lastIncidentReport: reportPath,
      totalCallAttempts: state.callAttempts?.length || 0,
      checksRequireModelCredits: false,
    }, null, 2));
  } else if (command === "--arm") {
    if (!healthSourceEnabled()) settings();
    const preflight = await collect();
    if (!preflight.databaseOk || preflight.conferenceExists === false) {
      throw Error("Cannot arm: the database check did not verify healthy, or the conference ID is missing");
    }
    if (!(await keyForSilyring())) throw Error("Silyring device key missing (~/.silyring/key)");
    await writeFile(armedPath, new Date().toISOString(), { mode: 0o600 });
    console.log("JARVIS armed. No monitor is started by this command.");
  } else if (command === "--disarm") {
    await rm(armedPath, { force: true });
    console.log("JARVIS disarmed. Future polls cannot place calls.");
  } else if (command === "--once") {
    await runOnce();
  } else {
    throw Error("Usage: monitor.mjs --status | --arm | --disarm | --once");
  }
}
main().catch(error => { console.error("JARVIS monitor stopped:", error.message); process.exitCode = 1; });
