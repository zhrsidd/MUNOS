// DCMUN JARVIS: deterministic, side-effect-free escalation rules.
// Run via Node >=20. No model, network or Silyring access in this file.

export function initialState() {
  return {
    version: 1,
    countsHighWater: { delegates: null, committees: null },
    consecutive: { db: 0, site: 0, missing: 0, delegates: 0, committees: 0 },
    callAttempts: [],
    lastCallAt: {},
  };
}

const incident = (id, title, evidence, action) => ({
  id, severity: "critical", title, evidence, action,
});

export function evaluateSnapshot(sample, previous = initialState()) {
  const state = structuredClone(previous);
  const counters = state.consecutive;
  const incidents = [];
  if (!sample.databaseOk) {
    counters.db++;
    if (counters.db >= 3) {
      incidents.push(incident(
        "supabase-unreachable",
        "The DCMUN database is unreachable",
        "Three consecutive scheduled database checks failed.",
        "Open MUNOS and Supabase from your laptop and confirm whether staff can save changes. If staff devices show RED, follow the conference recovery runbook."
      ));
    }
    return { state, incidents };
  }
  counters.db = 0;

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
    return { state, incidents };
  }
  counters.missing = 0;

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

export function canPlaceCall(state, incidentId, now = Date.now(), options = {}) {
  const cooldownMs = options.cooldownMs ?? 30 * 60_000;
  const perDay = options.perDay ?? 6;
  const lifetime = options.lifetime ?? 12;
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
  return state;
}

export function phoneScript(item) {
  // Keep it short to conserve ElevenLabs credits. No delegate names or credentials.
  return `Hey, quick heads-up. ${item.title}. This has been confirmed by repeated checks, and it needs your attention. Could you come to your laptop? I've prepared an incident report with the evidence and suggested next steps.`;
}
