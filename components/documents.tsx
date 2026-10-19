"use client";
import { useState } from "react";
import Link from "next/link";
import { useConference } from "@/lib/context";
import type { Resolution } from "@/lib/domain";
import { resolutionFeedback, resolutionNextAction, resolutionOrder, sentBack, type Feedback } from "@/lib/resolution-view";
import { Chip, Empty, Icon, Modal, PageHeading, Panel } from "./ui";
import { ResolutionSources } from "./operations/resolution-links";

const qatarTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Qatar", dateStyle: "medium", timeStyle: "short" });

/** The working Google Doc, the Approval copy and any uploaded file, for the latest version. */
function Sources({ resolution }: { resolution: Resolution }) {
  const { data } = useConference();
  const version = data.versions.find((v) => v.id === resolution.versionIds.at(-1));
  return <ResolutionSources resolution={resolution} storageKey={version?.storageKey ?? null} fileName={version?.fileName ?? ""} />;
}
/** Approval Panel feedback, shown in full where the Chair and the panel are already looking. */
function FeedbackNote({ feedback, changes }: { feedback: Feedback; changes: boolean }) {
  return (
    <section className={`feedback${changes ? " changes" : ""}`} aria-label="Approval Panel feedback">
      <p className="feedback-meta">
        <strong>{changes ? "Changes requested" : "Approval Panel"}</strong> · <time dateTime={feedback.createdAt}>{qatarTime(feedback.createdAt)}</time>
      </p>
      <p className="feedback-text">{feedback.text}</p>
    </section>
  );
}
function EarlierFeedback({ items }: { items: Feedback[] }) {
  if (!items.length) return null;
  return (
    <details className="feedback-earlier">
      <summary>Earlier feedback ({items.length})</summary>
      {items.map((f) => (
        <FeedbackNote key={f.id} feedback={f} changes={false} />
      ))}
    </details>
  );
}
function ResolutionRow({ resolution }: { resolution: Resolution }) {
  const { data, act } = useConference();
  const submitter = data.delegates.find((d) => d.id === resolution.submitterId);
  const { latest, earlier } = resolutionFeedback(resolution);
  const next = resolutionNextAction(resolution);
  const back = sentBack(resolution);
  const heading = `resolution-${resolution.id}`;
  return (
    <article className="resolution-row" aria-labelledby={heading}>
      <header className="resolution-head">
        <div>
          <small className="eyebrow">{resolution.code}</small>
          <h3 id={heading}>{resolution.title}</h3>
          <p className="muted">{submitter ? `Submitted by ${submitter.country} · ${submitter.name}` : "Submitter unknown"}</p>
        </div>
        <div className="resolution-status">
          <Chip tone={back ? "review" : ""}>{back ? "Changes requested" : resolution.status}</Chip>
          {resolution.outcome && <Chip tone="blue">{resolution.outcome}</Chip>}
        </div>
      </header>
      <div className="resolution-doc">
        <Sources resolution={resolution} />
      </div>
      {latest ? <FeedbackNote feedback={latest} changes={back} /> : (resolution.status === "Submitted" || resolution.status === "Review") && <p className="muted">No feedback from the Approval Panel yet.</p>}
      <EarlierFeedback items={earlier} />
      <footer className="resolution-next">
        {next.status ? (
          <button className="primary" onClick={() => void act({ type: "document", id: resolution.id, status: next.status! }, "chair")}>
            {next.label}
          </button>
        ) : next.href ? (
          <Link className="button primary" href={next.href}>
            {next.label}
          </Link>
        ) : (
          <span className="muted">{next.label}</span>
        )}
      </footer>
    </article>
  );
}
export function Documents({ committeeId, sessionId }: { committeeId: string; sessionId: string }) {
  const { data, act } = useConference();
  const [modal, setModal] = useState<"new" | null>(null);
  const [title, setTitle] = useState("");
  const [submitterId, setSubmitterId] = useState(data.delegates.find((d) => d.committeeId === committeeId)?.id || "");
  const documents = data.documents.filter((r) => r.committeeId === committeeId).sort(resolutionOrder);
  return (
    <>
      <PageHeading
        eyebrow="RESOLUTIONS"
        title="Resolutions"
        description="Title, submitter, status, the working document and the Approval Panel's feedback, in one place."
        action={
          <button className="primary" disabled={!sessionId || !data.delegates.some((d) => d.committeeId === committeeId)} onClick={() => setModal("new")}>
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
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  {
                    type: "newDocument",
                    committeeId,
                    sessionId,
                    title,
                    submitterId,
                  },
                  "chair",
                )
              ) {
                setModal(null);
                setTitle("");
              }
            }}
          >
            <label>
              Resolution title
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Main submitter
              <select
                value={submitterId}
                onChange={(e) => setSubmitterId(e.target.value)}
              >
                {data.delegates
                  .filter((d) => d.committeeId === committeeId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.country} · {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className="primary">Create draft</button>
          </form>
        </Modal>
      )}
    </>
  );
}
function ResolutionDetail({ resolution }: { resolution: Resolution }) {
  const { data } = useConference();
  const submitter = data.delegates.find((d) => d.id === resolution.submitterId);
  const { latest, earlier } = resolutionFeedback(resolution);
  return (
    <div className="resolution-detail">
      <p className="muted">{submitter ? `Submitted by ${submitter.country} · ${submitter.name}` : "Submitter unknown"}</p>
      <Sources resolution={resolution} />
      {latest && <FeedbackNote feedback={latest} changes={false} />}
      <EarlierFeedback items={earlier} />
    </div>
  );
}
export function Approval() {
  const { data, act } = useConference();
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
  return (
    <>
      <PageHeading
        eyebrow="APPROVAL PANEL"
        title="A clear path to the floor."
        description="Review the latest version. Send a decision back to the committee."
        action={<Chip tone="blue">{inbox.length} awaiting review</Chip>}
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
                    <span className="eyebrow">{r.code}</span>
                    <Chip>{r.status}</Chip>
                  </div>
                  <h3>{r.title}</h3>
                  <p>
                    Version {r.versionIds.length} ·{" "}
                    {
                      data.delegates.find((d) => d.id === r.submitterId)
                        ?.country
                    }
                  </p>
                  <span className="card-link">Review submission →</span>
                </button>
              ))}
            </div>
          </Panel>
          {resolution && (
            <div>
              <div className="review-title">
                <div>
                  <div className="eyebrow">
                    {resolution.code} · VERSION {resolution.versionIds.length}
                  </div>
                  <h2>{resolution.title}</h2>
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
export function Logistics() {
  const { data, act } = useConference();
  const [showCompleted, setShowCompleted] = useState(false);
  const queue = data.documents.filter((r) => r.status === "Approved");
  const completed = data.documents.filter((r) =>
    ["Printed", "In Debate", "Closed"].includes(r.status),
  );
  return (
    <>
      <PageHeading
        eyebrow="ADMINS"
        title="Ready. Set. Print."
        description="Only approved versions enter this queue. Mark them printed when the copies are ready."
        action={<Chip tone="blue">{queue.length} pending jobs</Chip>}
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
        subtitle="Prepare copies, then mark the job complete."
      >
        {queue.length ? (
          <div className="print-list">
            {queue.map((r) => {
              const c = data.committees.find((c) => c.id === r.committeeId)!;
              return (
                <div className="print-job" key={r.id}>
                  <span className="committee-badge">{c.code}</span>
                  <div>
                    <span className="eyebrow">
                      {r.code} · VERSION {r.versionIds.length}
                    </span>
                    <h3>{r.title}</h3>
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
      <Panel
        title="Completed jobs"
        subtitle={`${completed.length} documents have been printed`}
        action={
          <button
            className="text-button"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? "Hide history" : "Show history"}
          </button>
        }
      >
        {showCompleted &&
          completed.map((r) => (
            <div className="summary-row" key={r.id}>
              <div>
                <strong>
                  {r.code} · {r.title}
                </strong>
                <p>
                  {r.copies} copies · v{r.versionIds.length}
                </p>
              </div>
              <Chip tone="green">Printed</Chip>
            </div>
          ))}
      </Panel>
    </>
  );
}
