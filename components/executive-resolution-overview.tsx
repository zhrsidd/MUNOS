"use client";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { approvalHistory, latestFeedback } from "@/lib/approval-history";
import { resolutionOverview } from "@/lib/resolution-overview";
import { ApprovalHistory } from "./documents";
import { ResolutionSources } from "./operations/resolution-links";
import { Chip, Empty, PageHeading, Panel } from "./ui";

export function ExecutiveResolutionOverview() {
  const { data } = useConference();
  const [committeeId, setCommitteeId] = useState("");
  const [query, setQuery] = useState("");
  const groups = resolutionOverview(data, committeeId, query);
  return <>
    <PageHeading eyebrow="EXECUTIVE" title="Resolution status" description="All committees · approval, printing and debate progress. Read-only; decisions stay in their workspaces." />
    <div className="resolution-overview-filters">
      <label>Committee<select value={committeeId} onChange={e => setCommitteeId(e.target.value)}>
        <option value="">All committees</option>
        {data.committees.map(c => <option key={c.id} value={c.id}>{c.code}{c.archived ? " · archived" : ""}</option>)}
      </select></label>
      <label>Find a resolution<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Code, title, country or status" /></label>
    </div>
    {!groups.length && <Empty title="No matching resolutions" text="Try another country, title or status, or clear the filters." />}
    {groups.map(({ committee, resolutions }) => <Panel key={committee.id} title={`${committee.code}${committee.archived ? " · Archived" : ""}`} subtitle={`${committee.name} · ${resolutions.length} resolution${resolutions.length === 1 ? "" : "s"}`}>
      {!resolutions.length && <p className="muted">No resolutions recorded.</p>}
      {resolutions.map(({ resolution: r, submitter, status, approval, printing }) => {
        const feedback = latestFeedback(data, r.id);
        return <article className="executive-resolution-row" key={r.id} aria-label={`${r.code} · ${r.title}`}>
          <div className="executive-resolution-heading"><div><small>{r.code} · {submitter}</small><h3>{r.title}</h3></div><Chip>{status}</Chip></div>
          <p className="muted">Approval: {status === "Changes requested" ? status : approval} · Printing: {printing}{r.outcome ? ` · Outcome: ${r.outcome}${r.outcomeMethod === "observed" ? " (observed majority, no counts)" : ""}` : ""}</p>
          <ResolutionSources resolution={r} storageKey={null} fileName="" />
          {feedback && <blockquote className="executive-resolution-feedback"><strong>Latest Approval Panel feedback · {feedback.reviewer}</strong><p>{feedback.comment}</p></blockquote>}
          <details><summary>Approval history</summary><ApprovalHistory entries={approvalHistory(data, r.id)} /></details>
        </article>;
      })}
    </Panel>)}
  </>;
}
