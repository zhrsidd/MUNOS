"use client";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { renderSVG } from "uqr";
import { useConference } from "@/lib/context";
import { repository } from "@/lib/repository";
import { newSubmissionToken } from "@/lib/operations/commands";
import type { Committee } from "@/lib/domain";
import { Chip, PageHeading, Panel } from "../ui";

const submitUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/submit/${token}`;
export function useDemo() {
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
    <Panel title={`${committee.code} submission QR`} subtitle="Delegates share their Google Doc with you, then scan this to register it. It appears under Delegate submissions.">
      {link ? (
        <div className="submission-panel">
          <QrCode value={submitUrl(link.token)} label={`QR code for ${committee.code} resolution submission`} />
          <div>
            <p>
              Preferred: <b>Anyone with the link → Editor</b>. For school restrictions, the form shows assigned Chair contact emails from Executive → Chairs &amp; staff.
            </p>
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
/** Executive → Submission links: one QR link per committee and the address delegates share their Google Doc with. */
export function SubmissionLinks() {
  const { data, act } = useConference();
  const demo = useDemo();
  const links = data.submissionLinks ?? [];
  const missing = data.committees.filter((c) => !links.some((l) => l.committeeId === c.id));
  const save = (c: Committee, action: "create" | "rotate" | "revoke", shareWith = "") =>
    act({ type: "submissionLink", action, committeeId: c.id, shareWith, ...(action === "revoke" ? {} : { token: newSubmissionToken(c.id, demo) }) }, "admin");
  return (
    <>
      <PageHeading
        eyebrow="EXECUTIVE"
        title="Submission links"
        description="One QR code per committee. Delegates write in Google Docs, share the document with their Chair, then register it here without an account. The Chair sends it on to Approval."
        action={
          missing.length ? (
            <button className="primary" onClick={() => void (async () => { for (const c of missing) if (!(await save(c, "create"))) break; })()}>
              Create {missing.length} missing link{missing.length === 1 ? "" : "s"}
            </button>
          ) : undefined
        }
      />
      <Panel title="Chair contact details" subtitle="The form prefers Anyone with the link → Editor. If school restrictions prevent that, delegates can share directly with the assigned Chairs listed below.">
        <p className="panel-body"><Link href="/admin/staff">Manage Chair names and contact emails →</Link> These contacts do not grant app access and are separate from future Drive automation.</p>
      </Panel>
      <Panel title="Committee links" subtitle="Replace a link if it was shared outside the committee: the old QR code stops working immediately. Updating staff contacts keeps the QR code.">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Committee</th>
                <th>Assigned Chair contacts</th>
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
                      <div>{link ? <Chip tone="green">Active</Chip> : <Chip tone="neutral">No link</Chip>}</div>
                    </td>
                    <td>{data.staff.filter(s=>s.role==="chair" && s.committeeIds.includes(c.id)).map(s=><div key={s.id}>{s.name} · {s.email || "Email not configured"}</div>)}</td>
                    <td>{link ? <CopyLink url={submitUrl(link.token)} /> : "—"}</td>
                    <td>
                      <div className="actions">
                        {link ? (
                          <>
                            <a className="button" href={`/submit/${link.token}/sheet`} target="_blank" rel="noreferrer">
                              Print sheet
                            </a>
                            <button onClick={() => window.confirm(`Replace the ${c.code} link? The current QR code stops working immediately.`) && void save(c, "rotate")}>Replace</button>
                            <button onClick={() => window.confirm(`Turn off online submission for ${c.code}?`) && void save(c, "revoke")}>Turn off</button>
                          </>
                        ) : (
                          <button className="primary" onClick={() => void save(c, "create")}>
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
          Security: each link is a 128-bit random code. Anyone holding it can register a resolution for that committee only (at most 20 per 10 minutes); it
          can only see committee submission details and assigned Chair contacts. Conference OS stores the Google Doc&apos;s id, never its text. {demo && "Local demo: links work against demo data only."} Chairs see
          their QR in Chair Console → Documents.
        </p>
      </Panel>
      <p className="muted">
        <Link href="/approval">Open the Approval inbox →</Link>
      </p>
    </>
  );
}
