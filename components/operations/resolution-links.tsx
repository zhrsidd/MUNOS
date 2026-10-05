"use client";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useConference } from "@/lib/context";
import type { Resolution } from "@/lib/domain";
import type { ResolutionLink } from "@/lib/operations/types";
import { googleDocMessages, googleDocUrl, parseGoogleDocLink } from "@/lib/submissions/google-doc";
import { browserClient } from "@/lib/supabase/client";
import { formatTime } from "../chair";
import { Chip, Panel } from "../ui";
import { useDemo } from "./submission-links";

// Google Docs is the resolution editor. These controls only point at the documents (URLs are rebuilt
// from stored ids, never taken from user input) and record workflow facts around them.

export function GoogleDocButton({ docId, label = "Open Google Doc", primary = false }: { docId: string; label?: string; primary?: boolean }) {
  return (
    <a className={`button${primary ? " primary" : ""}`} href={googleDocUrl(docId)} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  );
}
const linkFor = (links: ResolutionLink[] | undefined, id: string) => links?.find((l) => l.documentId === id);

/** Opens an uploaded fallback file through a short-lived signed URL (staff RLS). */
export function OpenSubmittedFile({ storageKey, fileName }: { storageKey: string; fileName: string }) {
  const demo = useDemo();
  const [error, setError] = useState("");
  async function open() {
    setError("");
    // Open synchronously so the browser does not treat it as a pop-up, then point it at the signed URL.
    const tab = window.open("", "_blank");
    try {
      const { data, error } = await browserClient().storage.from("resolutions").createSignedUrl(storageKey, 600);
      if (error || !data) throw error ?? Error("No URL");
      if (tab) tab.location.href = data.signedUrl;
      else window.location.href = data.signedUrl;
    } catch {
      tab?.close();
      setError("File storage is temporarily unavailable. Try again shortly.");
    }
  }
  if (demo) return <span className="muted">{fileName} · uploaded file (stored by the local demo server; no preview in demo mode)</span>;
  return (
    <span>
      <button className="button" onClick={() => void open()}>
        Open uploaded file
      </button>{" "}
      <span className="muted">{fileName}</span>
      {error && <span role="alert"> · {error}</span>}
    </span>
  );
}
/** Chair: attach a working Google Doc to a resolution that has none (e.g. one created in the Chair Console). */
function LinkWorkingDoc({ documentId }: { documentId: string }) {
  const { act } = useConference();
  const [value, setValue] = useState("");
  const parsed = parseGoogleDocLink(value);
  return (
    <span className="link-field">
      <input value={value} aria-label="Working Google Doc link" placeholder="Paste the Google Doc link" onChange={(e) => setValue(e.target.value)} />
      <button disabled={!parsed.ok} title={!parsed.ok && value ? googleDocMessages[parsed.problem] : undefined} onClick={() => parsed.ok && void act({ type: "resolutionLink", documentId, action: "workingDoc", docId: parsed.id }, "chair").then((ok) => ok && setValue(""))}>
        Link Google Doc
      </button>
    </span>
  );
}
/** Document preview caption: the working Google Doc, the Approval copy and any uploaded file. */
export function ResolutionSources({ resolution, storageKey, fileName }: { resolution: Resolution; storageKey: string | null; fileName: string }) {
  const { data } = useConference();
  const chair = usePathname()?.startsWith("/chair");
  const link = linkFor(data.resolutionLinks, resolution.id);
  return (
    <span className="resolution-sources">
      {link?.approvalCopyDocId && <GoogleDocButton docId={link.approvalCopyDocId} label="Open approval copy" primary={!chair} />}
      {link?.workingDocId && <GoogleDocButton docId={link.workingDocId} label="Open working Google Doc" primary={chair || !link.approvalCopyDocId} />}
      {storageKey && <OpenSubmittedFile storageKey={storageKey} fileName={fileName} />}
      {!link?.workingDocId && !storageKey && (chair ? <LinkWorkingDoc documentId={resolution.id} /> : <span className="muted">{fileName} · no Google Doc linked</span>)}
      {link?.access === "problem" && <Chip tone="draft">Chair can&apos;t access document</Chip>}
    </span>
  );
}
function SubmissionCard({ resolution, link, shareWith }: { resolution: Resolution; link: ResolutionLink; shareWith: string }) {
  const { data, act } = useConference();
  const [copy, setCopy] = useState("");
  const delegate = data.delegates.find((d) => d.id === resolution.submitterId);
  const version = data.versions.find((v) => v.id === resolution.versionIds[0]);
  const parsedCopy = parseGoogleDocLink(copy);
  const access = (state: ResolutionLink["access"]) => act({ type: "resolutionLink", documentId: resolution.id, action: "access", access: state }, "chair");
  async function sendToApproval() {
    if (copy.trim() && !parsedCopy.ok) return;
    if (parsedCopy.ok && !(await act({ type: "resolutionLink", documentId: resolution.id, action: "approvalCopy", docId: parsedCopy.id }, "chair"))) return;
    if (link.access !== "ok" && link.workingDocId && !(await access("ok"))) return;
    await act({ type: "document", id: resolution.id, status: "Submitted" }, "chair");
  }
  return (
    <article className={`submission-card ${link.access}`}>
      <div className="submission-card-head">
        <div>
          <small className="muted">{resolution.code}</small>
          <strong>{resolution.title}</strong>
          <p className="muted">
            {delegate ? `${delegate.flag} ${delegate.country}` : "Unknown submitter"} · submitted {link.submittedAt ? formatTime(link.submittedAt) : "—"}
            {!link.workingDocId && version?.storageKey && " · uploaded file"}
          </p>
        </div>
        {link.access === "problem" ? <Chip tone="draft">Can&apos;t access</Chip> : link.access === "ok" ? <Chip tone="green">Opens</Chip> : <Chip tone="neutral">Not checked</Chip>}
      </div>
      {link.access === "problem" && (
        <p className="submit-error">
          Ask {delegate?.country ?? "the delegate"} to share the Google Doc with {shareWith || "your Chair account"} as an <b>Editor</b>. Then open it again.
        </p>
      )}
      <div className="actions">
        {link.workingDocId && <GoogleDocButton docId={link.workingDocId} primary />}
        {!link.workingDocId && version?.storageKey && <OpenSubmittedFile storageKey={version.storageKey} fileName={version.fileName} />}
        {link.workingDocId &&
          (link.access === "problem" ? (
            <button onClick={() => void access("ok")}>Access fixed</button>
          ) : (
            <button onClick={() => void access("problem")}>Can&apos;t access</button>
          ))}
      </div>
      <label className="approval-copy">
        Approval-folder copy (optional)
        <input value={copy} placeholder="Paste the link to your copy in the Approval folder" onChange={(e) => setCopy(e.target.value)} aria-label={`Approval copy for ${resolution.code}`} />
        {copy.trim() && !parsedCopy.ok && <small className="field-error">{googleDocMessages[parsedCopy.problem]}</small>}
      </label>
      <div className="actions">
        <button className="primary" disabled={(!!copy.trim() && !parsedCopy.ok) || link.access === "problem"} onClick={() => void sendToApproval()}>
          Submit to Approval
        </button>
        <small className="muted">Make your copy in the Approval Panel&apos;s Drive folder first (manual for now).</small>
      </div>
    </article>
  );
}
/** Chair Console → Documents: resolutions delegates registered through the QR link, waiting for the Chair. */
export function DelegateSubmissions({ committeeId }: { committeeId: string }) {
  const { data } = useConference();
  const waiting = data.documents
    .filter((r) => r.committeeId === committeeId && r.status === "Draft")
    .map((r) => ({ r, link: linkFor(data.resolutionLinks, r.id) }))
    .filter((x): x is { r: Resolution; link: ResolutionLink } => !!x.link?.submittedAt);
  if (!waiting.length) return null;
  const shareWith = data.submissionLinks?.find((l) => l.committeeId === committeeId)?.shareWith ?? "";
  return (
    <Panel title={`Delegate submissions · ${waiting.length} waiting for you`} subtitle="Open the Google Doc, review and edit it there, copy it into the Approval folder, then Submit to Approval.">
      <div className="submission-list">
        {waiting.map(({ r, link }) => (
          <SubmissionCard key={r.id} resolution={r} link={link} shareWith={shareWith} />
        ))}
      </div>
    </Panel>
  );
}
