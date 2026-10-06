"use client";
import { useState } from "react";
import Link from "next/link";
import { useConference } from "@/lib/context";
import { Resolution } from "@/lib/domain";
import { Chip, Empty, Icon, Modal, PageHeading, Panel, Timeline } from "./ui";
import { ResolutionSources } from "./operations/resolution-links";
export function DocumentPreview({ resolution }: { resolution: Resolution }) {
  const { data } = useConference();
  const [versionId, setVersionId] = useState("");
  const version = data.versions.find(
    (v) =>
      v.id ===
      (resolution.versionIds.includes(versionId)
        ? versionId
        : resolution.versionIds.at(-1)),
  );
  return (
    <div className="document-preview">
      <div className="preview-toolbar">
        <span>
          <Icon name="documents" />
          Document preview
        </span>
        <select
          aria-label="Document version"
          value={version?.id || ""}
          onChange={(e) => setVersionId(e.target.value)}
        >
          {resolution.versionIds.map((id) => {
            const v = data.versions.find((x) => x.id === id)!;
            return (
              <option key={id} value={id}>
                Version {v.number}
                {id === resolution.versionIds.at(-1) ? " · Latest" : ""}
              </option>
            );
          })}
        </select>
      </div>
      <div className="paper">
        <div className="paper-brand">
          DCMUN <span>RESOLUTION</span>
        </div>
        <pre>{version?.text}</pre>
        <div className="paper-footer">
          {resolution.code} · v{version?.number}
          <span>Illustrative demo document</span>
        </div>
      </div>
      <div className="preview-caption">
        <ResolutionSources resolution={resolution} storageKey={version?.storageKey ?? null} fileName={version?.fileName ?? ""} />
      </div>
    </div>
  );
}
export function Documents({
  committeeId,
  sessionId,
}: {
  committeeId: string;
  sessionId: string;
}) {
  const { data, act } = useConference();
  const [selected, setSelected] = useState("");
  const [modal, setModal] = useState<"new" | "version" | null>(null);
  const [title, setTitle] = useState("");
  const [submitterId, setSubmitterId] = useState(
    data.delegates.find((d) => d.committeeId === committeeId)?.id || "",
  );
  const [fileName, setFileName] = useState("resolution-v2.txt");
  const [text, setText] = useState("");
  const documents = data.documents.filter((r) => r.committeeId === committeeId);
  const resolution = documents.find((r) => r.id === selected) || documents[0];
  return (
    <>
      <PageHeading
        eyebrow="RESOLUTION MANAGEMENT"
        title="From draft to decision."
        description="One resolution record connects review, printing, debate, and the final outcome."
        action={
          <button
            className="primary"
            disabled={
              !sessionId ||
              !data.delegates.some((d) => d.committeeId === committeeId)
            }
            onClick={() => setModal("new")}
          >
            + New resolution
          </button>
        }
      />
      <div className="documents-layout">
        <div>
          <Panel
            title="Committee documents"
            subtitle={`${documents.length} resolutions`}
          >
            <div className="document-list">
              {documents.map((r) => (
                <button
                  className={
                    r.id === resolution?.id
                      ? "document-card selected"
                      : "document-card"
                  }
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                >
                  <div>
                    <span className="eyebrow">{r.code}</span>
                    <Chip>{r.status}</Chip>
                  </div>
                  <h3>{r.title}</h3>
                  <p>
                    v{r.versionIds.length} ·{" "}
                    {
                      data.delegates.find((d) => d.id === r.submitterId)
                        ?.country
                    }
                  </p>
                  {r.outcome && <Chip tone="blue">{r.outcome}</Chip>}
                </button>
              ))}
            </div>
            {!documents.length && (
              <Empty
                title="A clean slate"
                text="Create a draft resolution to begin the workflow."
              />
            )}
          </Panel>
          <div className="callout small">
            <Icon name="documents" />
            <p>
              Database state drives the workflow. Drive will mirror document
              versions for archive and fallback.
            </p>
          </div>
        </div>
        {resolution && (
          <div>
            <Panel
              title={resolution.code}
              subtitle={resolution.title}
              action={<Chip>{resolution.status}</Chip>}
            >
              <Timeline status={resolution.status} />
              <div className="next-action">
                <div>
                  <strong>{nextAction(resolution)}</strong>
                  <p>
                    {resolution.status === "Draft"
                      ? "Add a version or submit the draft to the Approval Panel."
                      : resolution.status === "Approved"
                        ? "This resolution is now in the Logistics print queue."
                        : resolution.status === "Review" ||
                            resolution.status === "Submitted"
                          ? "The Approval Panel will review the latest version."
                          : resolution.status === "Printed"
                            ? "The printed document is ready to introduce to the committee."
                            : resolution.status === "In Debate"
                              ? "Record participation and votes in the Chair Console."
                              : "The final outcome is preserved with the resolution."}
                  </p>
                </div>
                <div className="actions">
                  {resolution.status === "Draft" && (
                    <>
                      <button
                        onClick={() => {
                          setText(
                            data.versions.find(
                              (v) => v.id === resolution.versionIds.at(-1),
                            )?.text || "",
                          );
                          setModal("version");
                        }}
                      >
                        + Mock version
                      </button>
                      <button
                        className="primary"
                        onClick={() =>
                          void act(
                            {
                              type: "document",
                              id: resolution.id,
                              status: "Submitted",
                            },
                            "chair",
                          )
                        }
                      >
                        Submit for review →
                      </button>
                    </>
                  )}
                  {resolution.status === "Printed" && (
                    <button
                      className="primary"
                      disabled={documents.some((r) => r.status === "In Debate")}
                      onClick={() =>
                        void act(
                          {
                            type: "document",
                            id: resolution.id,
                            status: "In Debate",
                          },
                          "chair",
                        )
                      }
                    >
                      Open debate →
                    </button>
                  )}
                  {resolution.status === "In Debate" && (
                    <Link className="button primary" href="/chair/voting">
                      Go to voting →
                    </Link>
                  )}
                  {resolution.outcome && (
                    <Chip tone="blue">{resolution.outcome}</Chip>
                  )}
                </div>
              </div>
              <DocumentPreview key={resolution.id} resolution={resolution} />
            </Panel>
            <Panel
              title="Version history & review notes"
              subtitle="Versions remain attached to the resolution throughout its lifecycle."
            >
              {[...resolution.versionIds].reverse().map((id) => {
                const v = data.versions.find((v) => v.id === id)!;
                return (
                  <div className="version-row" key={id}>
                    <span className="version-icon">
                      <Icon name="documents" />
                    </span>
                    <div>
                      <strong>Version {v.number}</strong>
                      <p>{v.fileName}</p>
                    </div>
                    <span>
                      {id === resolution.versionIds.at(-1) ? (
                        <Chip tone="blue">Latest</Chip>
                      ) : (
                        <span className="muted">Previous</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {resolution.comments.map((c) => (
                <div className="review-comment" key={c.id}>
                  <strong>Approval Panel</strong>
                  <p>{c.text}</p>
                  <small>
                    {new Date(c.createdAt).toLocaleString("en-GB", {
                      timeZone: "Asia/Qatar",
                    })}
                  </small>
                </div>
              ))}
            </Panel>
          </div>
        )}
      </div>
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
      {modal === "version" && resolution && (
        <Modal
          title="Add a mock document version"
          onClose={() => setModal(null)}
        >
          <p className="footnote">
            This saves a text preview locally. PDF upload and storage adapters
            are deferred.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  { type: "version", id: resolution.id, fileName, text },
                  "chair",
                )
              )
                setModal(null);
            }}
          >
            <label>
              Filename
              <input
                required
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
              />
            </label>
            <label>
              Document text
              <textarea
                required
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button className="primary">
              Save version {resolution.versionIds.length + 1}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function nextAction(r: Resolution) {
  return {
    Draft: "Next: submit for review",
    Submitted: "Waiting for review",
    Review: "Under review",
    Approved: "Next: print approved version",
    Printed: "Next: introduce to debate",
    "In Debate": "The resolution is on the floor",
    Closed: `Closed · ${r.outcome || "Outcome pending"}`,
  }[r.status];
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
              <DocumentPreview key={resolution.id} resolution={resolution} />
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
  const [preview, setPreview] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const queue = data.documents.filter((r) => r.status === "Approved");
  const completed = data.documents.filter((r) =>
    ["Printed", "In Debate", "Closed"].includes(r.status),
  );
  const resolution = data.documents.find((r) => r.id === preview);
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
                    <button onClick={() => setPreview(r.id)}>
                      Open document ↗
                    </button>
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
      {resolution && (
        <Modal
          title={`${resolution.code} · Print preview`}
          onClose={() => setPreview(null)}
        >
          <DocumentPreview resolution={resolution} />
          <p className="footnote">
            Demo text preview. Actual PDF access and physical printing will use
            the Storage adapter.
          </p>
        </Modal>
      )}
    </>
  );
}
