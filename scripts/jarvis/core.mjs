// DCMUN JARVIS: deterministic, side-effect-free escalation rules.
// Run via Node >=20. No model, network or Silyring access in this file.

export function initialState() {
  return {
    version: 1,
    countsHighWater: { delegates: null, committees: null },
    consecutive: { db: 0, site: 0, missing: 0, delegates: 0, committees: 0 },
    callAttempts: [],
    lastCallAt: {},
    notifiedActive: {},
  };
}

const incident = (id, title, evidence, action) => ({
  id, severity: "critical", title, evidence, action,
});

export function evaluateSnapshot(sample, previous = initialState()) {
  const state = structuredClone(previous);
  const counters = state.consecutive;
  const incidents = [];
  // The site signal is independent of the database signal, so it is evaluated on every path.
  // A responding site (siteOk true) must break a site-failure streak even when the database
  // reports a failure in the same check, otherwise a false "unreachable" call could result.
  const evaluateSite = () => {
    if (sample.siteOk === false) {
      counters.site++;
      if (counters.site >= 3) {
        incidents.push(incident(
          "site-unreachable",
          "The DCMUN application is unreachable",
          "Three consecutive health requests to the configured application URL failed.",
          "Check the MUNOS production deployment and test a staff device. Use the conference runbook if saving is affected."
        ));
      }
    } else {
      counters.site = 0; // true or not configured
    }
  };
  // databaseOk === null means "could not be verified" (for example the app's health endpoint
  // was unreachable or reports the database as not configured). That is never a database
  // failure strike and never resets one; only a definite true/false changes the counter.
  const databaseUnknown = sample.databaseOk === null;
  if (!databaseUnknown && !sample.databaseOk) {
    counters.db++;
    if (counters.db >= 3) {
      incidents.push(incident(
        "supabase-unreachable",
        "The DCMUN database is unreachable",
        "Three consecutive scheduled database checks failed.",
        "Open MUNOS and Supabase from your laptop and confirm whether staff can save changes. If staff devices show RED, follow the conference recovery runbook."
      ));
    }
    evaluateSite();
    return { state, incidents };
  }
  if (!databaseUnknown) counters.db = 0;

  if (sample.conferenceExists === false) {
    counters.missing++;
    if (counters.missing >= 2) {
      incidents.push(incident(
        "conference-missing",
        "The expected DCMUN conference record is missing",
        "The configured conference ID was not found on two consecutive reads.",
        "Check the target project and conference ID before taking any corrective action."
      ));
    }
    evaluateSite();
    return { state, incidents };
  }
  counters.missing = 0;

  evaluateSite();

  // Never alert from a single count dip. High-water marks persist across restarts.
  for (const [name, minBaseline, minDrop, ratio] of [
    ["delegates", 50, 25, 0.15],
    ["committees", 8, 3, 0.25],
  ]) {
    const value = sample.counts?.[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      counters[name] = 0;
      continue;
    }
    const high = state.countsHighWater[name];
    if (high == null || value > high) {
      state.countsHighWater[name] = value;
      counters[name] = 0;
      continue;
    }
    const significant = high >= minBaseline &&
      high - value >= Math.max(minDrop, Math.ceil(high * ratio));
    counters[name] = significant ? counters[name] + 1 : 0;
    if (counters[name] >= 2) {
      const entity = name === "delegates" ? "delegate" : "committee";
      incidents.push(incident(
        `mass-${name}-loss`,
        `Unexpected decrease in ${entity} records`,
        `The ${entity} count fell from the recorded high-water mark of ${high} to ${value} on two consecutive checks.`,
        "Check whether a legitimate approved administrative change occurred. Do not restore or edit records automatically."
      ));
    }
  }
  return { state, incidents };
}

// Turns one HTTP response from the app's /api/health into a monitor sample (pure, no network).
//  - no valid report                 -> siteOk false, databaseOk null (database state unknown)
//  - database or supabase "down"     -> siteOk true,  databaseOk false
//  - database "ok"                   -> siteOk true,  databaseOk true
//  - database "degraded", no detail  -> siteOk true,  databaseOk true (successful but slow round trip)
//  - anything else (not_configured, or "degraded" carrying a detail such as "HTTP 403",
//    which is a rejected request rather than slowness) -> siteOk true, databaseOk null: not verified.
export function interpretHealthReport(httpStatus, bodyText) {
  let report = null;
  try { report = JSON.parse(bodyText); } catch { /* not JSON */ }
  const valid = report && typeof report === "object" && typeof report.status === "string" &&
    (httpStatus === 200 || httpStatus === 503);
  if (!valid) return { databaseOk: null, siteOk: false };
  const databaseCheck = report.checks?.database;
  const database = databaseCheck?.status;
  const supabase = report.checks?.supabase?.status;
  const slowButWorking = database === "degraded" && !databaseCheck?.detail;
  const databaseOk = database === "down" || supabase === "down" ? false
    : database === "ok" || slowButWorking ? true : null;
  return { databaseOk, siteOk: true };
}

// An incident that already triggered a call stays "notified" until the signal that raised it
// confirms recovery. Merely being absent from one check is not recovery: an unreachable health
// endpoint (databaseOk null) or a skipped read would otherwise forget the incident and let the
// same continuous outage place another call after the cooldown. Unknown ids are never cleared.
export function clearRecoveredIncidents(state, sample) {
  const notified = state.notifiedActive ??= {};
  const countsRecovered = name => Number.isSafeInteger(sample.counts?.[name]) && state.consecutive[name] === 0;
  const recovered = {
    "supabase-unreachable": () => sample.databaseOk === true,
    "site-unreachable": () => sample.siteOk === true,
    "conference-missing": () => sample.conferenceExists === true,
    "mass-delegates-loss": () => countsRecovered("delegates"),
    "mass-committees-loss": () => countsRecovered("committees"),
  };
  for (const id of Object.keys(notified)) {
    if (recovered[id]?.()) delete notified[id];
  }
  return state;
}

export function canPlaceCall(state, incidentId, now = Date.now(), options = {}) {
  const cooldownMs = options.cooldownMs ?? 30 * 60_000;
  const perDay = options.perDay ?? 6;
  const lifetime = options.lifetime ?? 12;
  if (state.notifiedActive?.[incidentId]) return { allowed: false, reason: "ongoing incident already called" };
  const attempts = (state.callAttempts ?? []).filter(x => Number.isFinite(x.at));
  if (attempts.length >= lifetime) return { allowed: false, reason: "total call budget reached" };
  if (attempts.filter(x => now - x.at < 24 * 60 * 60_000).length >= perDay) {
    return { allowed: false, reason: "daily call budget reached" };
  }
  if (now - (state.lastCallAt?.[incidentId] ?? -Infinity) < cooldownMs) {
    return { allowed: false, reason: "incident cooldown" };
  }
  return { allowed: true };
}

export function recordCallAttempt(state, incidentId, now = Date.now()) {
  state.callAttempts ??= [];
  state.lastCallAt ??= {};
  state.callAttempts.push({ id: incidentId, at: now });
  state.lastCallAt[incidentId] = now;
  state.notifiedActive ??= {};
  state.notifiedActive[incidentId] = true;
  return state;
}

export function phoneScript(item) {
  // Keep it short to conserve ElevenLabs credits. No delegate names or credentials.
  return `Hey, quick heads-up. ${item.title}. This has been confirmed by repeated checks, and it needs your attention. Could you come to your laptop? I've prepared an incident report with the evidence and suggested next steps.`;
}
