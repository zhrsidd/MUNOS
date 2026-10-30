"use client";
import { useState } from "react";
import { PRINT_SPARES } from "@/lib/print";
import Link from "next/link";
import { useConference } from "@/lib/context";
import type { Resolution } from "@/lib/domain";
import { approvalHistory, decisionTone, type HistoryEntry } from "@/lib/approval-history";
import { observedDeclaration } from "@/lib/repository";
import { resolutionNextAction, resolutionOrder, sentBack } from "@/lib/resolution-view";
import { previewIdentity } from "@/lib/resolution-identity";
import { compatResolutionTitle } from "@/lib/resolution-title";
import { Chip, Empty, Icon, Modal, PageHeading, Panel } from "./ui";
import { ResolutionName } from "./resolution-identity";
import { useResolutionIdentities } from "@/lib/use-resolution-identity";
import { ResolutionSources } from "./operations/resolution-links";

const qatarTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Qatar", dateStyle: "medium", timeStyle: "short" });

/** The working Google Doc, the Approval copy and any uploaded file, for the latest version. */
function Sources({ resolution }: { resolution: Resolution }) {
  const { data } = useConference();
  const version = data.versions.find((v) => v.id === resolution.versionIds.at(-1));
  return <ResolutionSources resolution={resolution} storageKey={version?.storageKey ?? null} fileName={version?.fileName ?? ""} />;
}
/** Approval Panel feedback, shown in full where the Chair and the panel are already looking. */
function FeedbackNote({ entry, changes }: { entry: HistoryEntry; changes: boolean }) {
  return (
    <section className={`feedback${changes ? " changes" : ""}`} aria-label="Approval Panel feedback">
      <p className="feedback-meta">
        <strong>{changes ? "Changes requested" : "Approval Panel feedback"}</strong> · {entry.reviewer} · <time dateTime={entry.at}>{qatarTime(entry.at)}</time> Qatar time
      </p>
      <p className="feedback-text">{entry.comment}</p>
    </section>
  );
}
function EarlierFeedback({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) return null;
  return (
    <details className="feedback-earlier">
      <summary>Earlier feedback · {entries.length}</summary>
      {entries.map((e) => (
        <FeedbackNote key={e.id} entry={e} changes={false} />
      ))}
    </details>
  );
}
/** Every decision, newest first. Reads as a list: screen readers announce the count and each entry in order. */
export function ApprovalHistory({ entries, showResolution = false, label = "Approval history" }: { entries: HistoryEntry[]; showResolution?: boolean; label?: string }) {
  if (!entries.length) return <p className="muted">No decisions recorded yet.</p>;
  return (
    <ol className="history" aria-label={label}>
      {entries.map((e) => (
        <li key={e.id} className="history-entry">
          <div className="history-line">
            <Chip tone={decisionTone[e.kind]}>{e.kind === "approved" && !e.comment ? "Approved — no comment added" : e.label}</Chip>
            {showResolution && (
              <strong className="history-resolution">
                <ResolutionName identity={e.identity} />
              </strong>
            )}
            <span className="muted">
              {e.round ? `Round ${e.round}` : "Before decisions were recorded"}
              {e.version ? ` · version ${e.version}` : ""} · by {e.reviewer} · <time dateTime={e.at}>{qatarTime(e.at)}</time> Qatar time
            </span>
          </div>
          {e.comment && <p className="history-comment">{e.comment}</p>}
        </li>
      ))}
    </ol>
  );
}
/** An observed (clear majority) result: who declared it and when. It has no country votes or totals to show. */
export function DeclarationLine({ resolutionId }: { resolutionId: string }) {
  const { data } = useConference();
  const declared = observedDeclaration(data, resolutionId);
  if (!declared) return null;
  const kept = declared.keptBallots;
  const tail = kept ? `; ${kept} earlier ballot${kept === 1 ? "" : "s"} kept, not counted.` : ".";
  return (
    <p className="decision-line">
      <strong>Clear majority declared</strong> by {declared.by} · <time dateTime={declared.at}>{qatarTime(declared.at)}</time>
      {` Qatar time. No country votes or totals recorded${tail}`}
    </p>
  );
}
function ResolutionRow({ resolution }: { resolution: Resolution }) {
  const { data, act } = useConference();
  const identity = useResolutionIdentities()(resolution);
  const history = approvalHistory(data, resolution.id);
  const withComment = history.filter((e) => e.comment);
  const latest = withComment[0] ?? null;
  const next = resolutionNextAction(resolution);
  const back = sentBack(resolution);
  const heading = `resolution-${resolution.id}`;
  const lastDecision = history[0];
  const resubmit = next.status && (
    <button className={back ? "link-action" : "primary"} onClick={() => void act({ type: "document", id: resolution.id, status: next.status! }, "chair")}>
      {back ? "Resubmit after editing →" : next.label}
    </button>
  );
  return (
    <article className={`resolution-row${back ? " changes" : ""}`} aria-labelledby={heading}>
      <header className="resolution-head">
        <div>
          <h3 id={heading}>
            <ResolutionName identity={identity} />
          </h3>
        </div>
        <div className="resolution-status">
          <Chip tone={back ? "review" : ""}>{back ? "Changes requested" : resolution.status}</Chip>
          {resolution.outcome && <Chip tone="blue">{resolution.outcome}{resolution.outcomeMethod === "observed" ? " · observed majority" : ""}</Chip>}
        </div>
      </header>
      {!back && (
        <div className="resolution-doc">
          <Sources resolution={resolution} />
        </div>
      )}
      {latest ? <FeedbackNote entry={latest} changes={back} /> : (resolution.status === "Submitted" || resolution.status === "Review") && <p className="muted">No feedback from the Approval Panel yet.</p>}
      {lastDecision && !lastDecision.comment && (
        <p className="decision-line">
          <strong>{lastDecision.kind === "approved" ? "Approved — no comment added" : lastDecision.label}</strong> by {lastDecision.reviewer} · <time dateTime={lastDecision.at}>{qatarTime(lastDecision.at)}</time> Qatar time
        </p>
      )}
      <DeclarationLine resolutionId={resolution.id} />
      <footer className="resolution-next">
        {back && <Sources resolution={resolution} />}
        {resubmit}
        {!next.status && next.href && (
          <Link className="button primary" href={next.href}>
            {next.label}
          </Link>
        )}
        {!next.status && !next.href && <span className="muted">{next.label}</span>}
      </footer>
      <EarlierFeedback entries={withComment.slice(1)} />
      {history.length > 0 && (
        <details className="feedback-earlier">
          <summary>Approval history · {history.length}</summary>
          <ApprovalHistory entries={history} label={`Approval history for ${identity.text}`} />
        </details>
      )}
    </article>
  );
}
/** The Chair's "New resolution" form. No title: only the Main Submitter, and the number is assigned on creation. */
export function NewResolutionForm({ committeeId, onDone }: { committeeId: string; onDone: () => void }) {
  const { data, act } = useConference();
  const [submitterId, setSubmitterId] = useState(data.delegates.find((d) => d.committeeId === committeeId)?.id || "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await act(
            {
              type: "newDocument",
              committeeId,
              // Not asked for or shown: only fills the legacy not-null column (lib/resolution-title.ts).
              title: compatResolutionTitle(),
              submitterId,
            },
            "chair",
          )
        )
          onDone();
      }}
    >
      <label>
        Main submitter
        <select value={submitterId} onChange={(e) => setSubmitterId(e.target.value)}>
          {data.delegates
            .filter((d) => d.committeeId === committeeId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.country} · {d.name}
              </option>
            ))}
        </select>
      </label>
      <p className="muted" aria-live="polite">
        <ResolutionName identity={previewIdentity(submitterId, data.delegates, committeeId)} />
      </p>
      <button className="primary">Create draft</button>
    </form>
  );
}
export function Documents({ committeeId }: { committeeId: string }) {
  const { data } = useConference();
  const [modal, setModal] = useState<"new" | null>(null);
  const documents = data.documents.filter((r) => r.committeeId === committeeId).sort(resolutionOrder);
  return (
    <>
      <PageHeading
        eyebrow={`Chair Console · ${data.committees.find((c) => c.id === committeeId)?.code ?? ""}`}
        title="Resolutions"
        description={documents.some((r) => r.status === "Draft") ? "Resolutions that need you are listed first." : "Each resolution with its document, feedback and next step."}
        action={
          <button className="primary" disabled={!data.delegates.some((d) => d.committeeId === committeeId)} onClick={() => setModal("new")}>
            + New resolution
          </button>
        }
      />
      {documents.length ? (
        <div className="resolution-list">
          {documents.map((r) => (
            <ResolutionRow key={r.id} resolution={r} />
          ))}
        </div>
      ) : (
        <Empty title="No resolutions yet" text="Delegates submit through the committee QR code, or create a draft here." />
      )}
      {modal === "new" && (
        <Modal title="New resolution" onClose={() => setModal(null)}>
          <NewResolutionForm committeeId={committeeId} onDone={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}
function ResolutionDetail({ resolution }: { resolution: Resolution }) {
  const { data } = useConference();
  const identity = useResolutionIdentities()(resolution);
  const history = approvalHistory(data, resolution.id);
  return (
    <div className="resolution-detail">
      <Sources resolution={resolution} />
      <section aria-labelledby={`history-${resolution.id}`}>
        <h3 id={`history-${resolution.id}`} className="history-heading">
          Decisions on this resolution
        </h3>
        <ApprovalHistory entries={history} label={`Decisions on ${identity.text}`} />
      </section>
    </div>
  );
}
export function Approval({ section = "" }: { section?: string }) {
  const { data, act } = useConference();
  const identify = useResolutionIdentities();
  const [selected, setSelected] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const inbox = data.documents.filter(
    (r) => r.status === "Review" || r.status === "Submitted",
  );
  const resolution = inbox.find((r) => r.id === selected) || inbox[0];
  async function review(status: "Approved" | "Draft") {
    if (!resolution) return;
    if (status === "Draft" && !comment.trim()) {
      setError("Add a comment so the chair knows what to change.");
      return;
    }
    if (
      await act(
        {
          type: "document",
          id: resolution.id,
          status,
          comment: comment.trim(),
        },
        "approval",
      )
    ) {
      setComment("");
      setError("");
    }
  }
  if (section === "history")
    return (
      <>
        <PageHeading eyebrow="APPROVAL PANEL" title="History" description="Every decision on every resolution, newest first, with the version and review round it applied to." />
        <Panel title="Decisions" subtitle="Comments written without a recorded decision appear as Comment.">
          <ApprovalHistory entries={approvalHistory(data)} showResolution />
        </Panel>
      </>
    );
  return (
    <>
      <PageHeading
        eyebrow="APPROVAL PANEL"
        title="Review inbox"
        description={inbox.length ? `${inbox.length} ${inbox.length === 1 ? "resolution is" : "resolutions are"} waiting for a decision.` : "Nothing is waiting for your review."}
      />
      {inbox.length ? (
        <div className="review-layout">
          <Panel title="Review inbox" subtitle="Submitted and awaiting review">
            <div className="document-list">
              {inbox.map((r) => (
                <button
                  key={r.id}
                  className={`document-card ${r.id === resolution?.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(r.id);
                    setComment("");
                    setError("");
                  }}
                >
                  <div>
                    <span className="eyebrow">VERSION {r.versionIds.length}</span>
                    <Chip>{r.status}</Chip>
                  </div>
                  <h3>
                    <ResolutionName identity={identify(r)} />
                  </h3>
                  <span className="card-link">Review submission →</span>
                </button>
              ))}
            </div>
          </Panel>
          {resolution && (
            <div>
              <div className="review-title">
                <div>
                  <div className="eyebrow">VERSION {resolution.versionIds.length}</div>
                  <h2>
                    <ResolutionName identity={identify(resolution)} />
                  </h2>
                </div>
                <Chip>{resolution.status}</Chip>
              </div>
              <ResolutionDetail resolution={resolution} />
              <Panel
                title="Your decision"
                subtitle="Approval sends this version directly to the print queue."
                action={
                  resolution.status === "Submitted" ? (
                    <button
                      onClick={() =>
                        void act(
                          {
                            type: "document",
                            id: resolution.id,
                            status: "Review",
                          },
                          "approval",
                        )
                      }
                    >
                      Start review
                    </button>
                  ) : undefined
                }
              >
                <label>
                  Review comment
                  <textarea
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value);
                      setError("");
                    }}
                    placeholder="Feedback for the chair and main submitter…"
                  />
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="decision-actions">
                  <button onClick={() => void review("Draft")}>
                    ↶ Request changes
                  </button>
                  <button
                    className="primary"
                    onClick={() => void review("Approved")}
                  >
                    ✓ Approve resolution
                  </button>
                </div>
              </Panel>
            </div>
          )}
        </div>
      ) : (
        <Empty
          title="The inbox is clear"
          text="New submissions will appear here. Approved resolutions are now with Logistics."
        />
      )}
    </>
  );
}
export function Logistics({ section = "" }: { section?: string }) {
  const { data, act } = useConference();
  const identify = useResolutionIdentities();
  const queue = data.documents.filter((r) => r.status === "Approved");
  const completed = data.documents.filter((r) =>
    ["Printed", "In Debate", "Closed"].includes(r.status),
  );
  if (section === "completed")
    return (
      <>
        <PageHeading eyebrow="ADMINS" title="Completed" description="Printed resolutions and where their documents are." />
        <Panel title="Completed jobs" subtitle={`${completed.length} documents have been printed`}>
            {completed.length ? (
              completed.map((r) => (
                <div className="summary-row" key={r.id}>
                  <div>
                    <strong>
                      <ResolutionName identity={identify(r)} />
                    </strong>
                    <p>
                      {r.copies} copies · v{r.versionIds.length}
                    </p>
                  </div>
                  <Sources resolution={r} />
                  <Chip tone="green">Printed</Chip>
                </div>
              ))
            ) : (
              <Empty title="Nothing printed yet" text="Printed jobs appear here." />
            )}
        </Panel>
      </>
    );
  return (
    <>
      <PageHeading
        eyebrow="ADMINS"
        title="Print queue"
        description={queue.length ? `${queue.length} ${queue.length === 1 ? "job is" : "jobs are"} ready to print. Mark each printed when the copies are ready.` : "No approved resolutions are waiting to print."}
      />
      <div className="print-summary">
        <Icon name="print" />
        <div>
          <strong>
            {queue.reduce((n, r) => n + r.copies, 0)} copies to prepare
          </strong>
          <p>
            Across {new Set(queue.map((r) => r.committeeId)).size} committees ·
            Latest approved versions
          </p>
        </div>
      </div>
      <Panel
        title="Print queue"
        subtitle={`Copies are one per committee delegate plus ${PRINT_SPARES} spares, counted when the resolution is approved. Prepare them, then mark the job complete.`}
      >
        {queue.length ? (
          <div className="print-list">
            {queue.map((r) => {
              const c = data.committees.find((c) => c.id === r.committeeId)!;
              return (
                <div className="print-job" key={r.id}>
                  <span className="committee-badge">{c.code}</span>
                  <div>
                    <span className="eyebrow">VERSION {r.versionIds.length}</span>
                    <h3>
                      <ResolutionName identity={identify(r)} />
                    </h3>
                    <p>{c.room} · Deliver to committee chair</p>
                  </div>
                  <div className="copies">
                    <strong>{r.copies}</strong>
                    <span>copies</span>
                  </div>
                  <div className="actions">
                    <Sources resolution={r} />
                    <button
                      className="primary"
                      onClick={() =>
                        void act(
                          { type: "document", id: r.id, status: "Printed" },
                          "logistics",
                        )
                      }
                    >
                      ✓ Mark printed
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title="All caught up"
            text="Approved resolutions will appear here automatically."
          />
        )}
      </Panel>
    </>
  );
}
