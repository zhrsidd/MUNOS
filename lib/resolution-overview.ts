import type { ConferenceData, DocumentStatus } from "./domain";
import { sentBack } from "./resolution-view";
import { matchesResolutionSearch, resolutionIdentities } from "./resolution-identity";

/** Progress is derived from the recorded workflow stage, without inventing decision timestamps. */
export function resolutionProgress(status: DocumentStatus) {
  switch (status) {
    case "Draft": return { approval: "Not submitted", printing: "Not ready" };
    case "Submitted": return { approval: "Awaiting review", printing: "Not ready" };
    case "Review": return { approval: "In review", printing: "Not ready" };
    case "Approved": return { approval: "Approved", printing: "Awaiting print" };
    default: return { approval: "Approved", printing: "Printed" };
  }
}

/**
 * Read-only projection of the existing scoped snapshot, including empty and archived committees. Each resolution carries
 * its shared identity (`GA1/01 — France`); the search matches code, Main Submitter country, status and outcome, never title.
 */
export function resolutionOverview(data: ConferenceData, committeeId = "", query = "") {
  const identify = resolutionIdentities(data.delegates);
  return [...data.committees].filter(c => !committeeId || c.id === committeeId)
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }) || a.id.localeCompare(b.id))
    .map(committee => ({ committee, resolutions: data.documents.filter(r => r.committeeId === committee.id)
      .map(resolution => { const identity = identify(resolution); return { resolution, identity, submitter: identity.submitter ?? "",
        status: sentBack(resolution) || (resolution.status === "Draft" && data.documentDecisions?.some(d => d.documentId === resolution.id && d.decision === "changes_requested")) ? "Changes requested" : resolution.status,
        ...resolutionProgress(resolution.status) }; })
      .filter(r => matchesResolutionSearch(query, { code: r.identity.code, country: r.identity.country, extra: [committee.code, committee.name, r.status, r.resolution.outcome] }))
      .sort((a, b) => a.resolution.code.localeCompare(b.resolution.code, "en", { numeric: true }) || a.resolution.id.localeCompare(b.resolution.id)) }))
    .filter(group => !query.trim() || group.resolutions.length);
}
