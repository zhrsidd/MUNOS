"use client";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { renderSVG } from "uqr";
import { useConference } from "@/lib/context";
import { repository } from "@/lib/repository";
import { newSubmissionToken } from "@/lib/operations/commands";
import { browserClient } from "@/lib/supabase/client";
import { Chip, PageHeading, Panel } from "../ui";

const submitUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/submit/${token}`;
function useDemo() {
  const health = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  return health.mode === "local";
}
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-field">
      <input readOnly value={url} aria-label="Submission link" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => setCopied(false))}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
export function QrCode({ value, label }: { value: string; label: string }) {
  const svg = useMemo(() => renderSVG(value, { ecc: "M", border: 2 }), [value]);
  return <div className="qr-box" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
/** Chair Console → Documents: the committee's QR code for delegates. */
export function SubmissionQrPanel({ committeeId }: { committeeId: string }) {
  const { data } = useConference();
  const committee = data.committees.find((c) => c.id === committeeId);
  const link = data.submissionLinks?.find((l) => l.committeeId === committeeId);
  if (!committee) return null;
  return (
    <Panel title={`${committee.code} submission QR`} subtitle="Delegates scan this to submit a resolution. It goes straight to the Approval Panel.">
      {link ? (
        <div className="submission-panel">
          <QrCode value={submitUrl(link.token)} label={`QR code for ${committee.code} resolution submission`} />
          <div>
            <CopyLink url={submitUrl(link.token)} />
            <div className="actions">
              <a className="button" href={`/submit/${link.token}/sheet`} target="_blank" rel="noreferrer">
                Print room sheet
              </a>
              <a className="button" href={`/submit/${link.token}`} target="_blank" rel="noreferrer">
                Open submission page
              </a>
            </div>
            <p className="muted">Share only with delegates in this committee. If the link is shared outside the room, ask the Executive to replace it.</p>
          </div>
        </div>
      ) : (
        <p className="muted">No submission link yet. The Executive creates it in Executive → Submission links.</p>
      )}
    </Panel>
  );
}
/** Executive → Submission links: create, replace and retire one link per committee. */
export function SubmissionLinks() {
  const { data, act } = useConference();
  const demo = useDemo();
  const [contact, setContact] = useState(() => data.submissionLinks?.find((l) => l.contact)?.contact ?? "");
  const links = data.submissionLinks ?? [];
  const missing = data.committees.filter((c) => !links.some((l) => l.committeeId === c.id));
  const save = (committeeId: string, action: "create" | "rotate" | "revoke") =>
    act({ type: "submissionLink", action, committeeId, contact: contact.trim(), ...(action === "revoke" ? {} : { token: newSubmissionToken(committeeId, demo) }) }, "admin");
  return (
    <>
      <PageHeading
        eyebrow="EXECUTIVE"
        title="Submission links"
        description="One QR code per committee. Delegates submit without an account; resolutions enter the Approval inbox as Submitted."
        action={
          missing.length ? (
            <button className="primary" onClick={() => void (async () => { for (const c of missing) if (!(await save(c.id, "create"))) break; })()}>
              Create {missing.length} missing link{missing.length === 1 ? "" : "s"}
            </button>
          ) : undefined
        }
      />
      <Panel title="Fallback contact" subtitle="Shown to delegates if submission fails (for example an email address). Applied to links created or replaced from now on.">
        <div className="panel-body">
        <input className="search" value={contact} maxLength={200} placeholder="resolutions@dcmun.example" onChange={(e) => setContact(e.target.value)} aria-label="Fallback contact" />
        </div>
      </Panel>
      <Panel title="Committee links" subtitle="Replace a link if it was shared outside the committee. The old QR code stops working immediately.">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Committee</th>
                <th>Status</th>
                <th>Link</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.committees.map((c) => {
                const link = links.find((l) => l.committeeId === c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.code}</strong> · {c.name}
                    </td>
                    <td>{link ? <Chip tone="green">Active</Chip> : <Chip tone="neutral">None</Chip>}</td>
                    <td>{link ? <CopyLink url={submitUrl(link.token)} /> : "—"}</td>
                    <td>
                      <div className="actions">
                        {link ? (
                          <>
                            <a className="button" href={`/submit/${link.token}/sheet`} target="_blank" rel="noreferrer">
                              Print sheet
                            </a>
                            <button onClick={() => window.confirm(`Replace the ${c.code} link? The current QR code stops working immediately.`) && void save(c.id, "rotate")}>Replace</button>
                            <button onClick={() => window.confirm(`Turn off online submission for ${c.code}?`) && void save(c.id, "revoke")}>Turn off</button>
                          </>
                        ) : (
                          <button className="primary" onClick={() => void save(c.id, "create")}>
                            Create link
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Security: each link is a 128-bit random code. Anyone holding it can submit to that committee only, at most 20 files per 10 minutes. It
          cannot read anything. {demo && "Local demo: links work against demo data only."} Chairs see their committee&apos;s QR in Chair Console → Documents.
        </p>
      </Panel>
      <p className="muted">
        <Link href="/approval">Open the Approval inbox →</Link>
      </p>
    </>
  );
}
/** Opens the stored file for a submitted version through a short-lived signed URL (staff RLS). */
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
      setError("Document storage is temporarily unavailable. Try again shortly.");
    }
  }
  if (demo) return <span className="muted">{fileName} · stored by the local demo server (no file preview in demo mode)</span>;
  return (
    <span>
      <button className="button" onClick={() => void open()}>
        Open submitted file
      </button>{" "}
      <span className="muted">{fileName}</span>
      {error && <span role="alert"> · {error}</span>}
    </span>
  );
}
