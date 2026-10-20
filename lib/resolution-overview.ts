import type { ConferenceData, DocumentStatus } from "./domain";
import { sentBack } from "./resolution-view";

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

/** Read-only projection of the existing scoped snapshot, including empty and archived committees. */
export function resolutionOverview(data: ConferenceData, committeeId = "", query = "") {
  const needle = query.trim().toLocaleLowerCase("en");
  const delegates = new Map(data.delegates.map(d => [d.id, d]));
  return [...data.committees].filter(c => !committeeId || c.id === committeeId)
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }) || a.id.localeCompare(b.id))
    .map(committee => ({ committee, resolutions: data.documents.filter(r => r.committeeId === committee.id)
      .map(resolution => ({ resolution, submitter: delegates.get(resolution.submitterId)?.country ?? "Unknown delegation",
        status: sentBack(resolution) || (resolution.status === "Draft" && data.documentDecisions?.some(d => d.documentId === resolution.id && d.decision === "changes_requested")) ? "Changes requested" : resolution.status,
        ...resolutionProgress(resolution.status) }))
      .filter(r => !needle || `${committee.code} ${committee.name} ${r.resolution.code} ${r.resolution.title} ${r.submitter} ${r.status} ${r.resolution.outcome ?? ""}`.toLocaleLowerCase("en").includes(needle))
      .sort((a, b) => a.resolution.code.localeCompare(b.resolution.code, "en", { numeric: true }) || a.resolution.id.localeCompare(b.resolution.id)) }))
    .filter(group => !needle || group.resolutions.length);
}
