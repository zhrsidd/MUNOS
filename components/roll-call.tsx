"use client";
import { useState } from "react";
import { useConference } from "@/lib/context";
import type { AttendanceStatus } from "@/lib/domain";
import { lastRollCall, rollCallAt } from "@/lib/sessions/presence";
import { zonedTime } from "@/lib/operations/time";
import { Metric, Search } from "./chair";
import { DelegateIdentity, Panel } from "./ui";

const STATUSES: AttendanceStatus[] = ["Present", "Present & Voting", "Absent"];
interface Draft { id: string; revision: number; copiedFrom: string | null; observedAt: string; rows: Record<string, AttendanceStatus> }
const draftKey = (committeeId: string) => `munos:roll-call-draft:${committeeId}`;
function readDraft(committeeId: string): Draft | null {
  try { const raw = localStorage.getItem(draftKey(committeeId)); return raw ? JSON.parse(raw) as Draft : null; } catch { return null; }
}
function writeDraft(committeeId: string, draft: Draft | null) {
  try { if (draft) localStorage.setItem(draftKey(committeeId), JSON.stringify(draft)); else localStorage.removeItem(draftKey(committeeId)); } catch { /* the draft stays in memory */ }
}

/**
 * Roll call (docs/SESSION_MODEL.md section 6). A draft lives on this device and never affects presence; Commit sends the whole roll call
 * as one saved action. "Copy last roll call" starts a draft from the latest committed one; "Correct" makes its next revision.
 */
export function RollCallPanel({ committeeId }: { committeeId: string }) {
  const { data, act } = useConference();
  // The panel is remounted per committee (the Chair screen is keyed by committee), so the stored draft is read once here.
  const [draft, setDraftState] = useState<Draft | null>(() => readDraft(committeeId));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const setDraft = (next: Draft | null) => { setDraftState(next); writeDraft(committeeId, next); };
  const delegates = data.delegates.filter((d) => d.committeeId === committeeId);
  const shown = delegates.filter((d) => `${d.country} ${d.name}`.toLowerCase().includes(search.toLowerCase()));
  const live = rollCallAt(data, committeeId);
  const last = lastRollCall(data, committeeId);
  const statusOf = (id: string) => draft ? draft.rows[id] : live?.rows.find((r) => r.delegateId === id)?.status;
  const count = (s: AttendanceStatus) => delegates.filter((d) => statusOf(d.id) === s).length;
  const missing = draft ? delegates.filter((d) => !draft.rows[d.id]).length : 0;
  const start = (from?: "copy" | "correct") => {
    const base = from && last ? Object.fromEntries(last.rows.map((r) => [r.delegateId, r.status])) : {};
    setDraft({ id: from === "correct" && last ? last.id : crypto.randomUUID(), revision: from === "correct" && last ? last.revision + 1 : 1,
      copiedFrom: from === "copy" && last ? last.id : null, observedAt: new Date().toISOString(), rows: base });
  };
  async function commit() {
    if (!draft || missing || busy) return;
    setBusy(true);
    try {
      const saved = await act({ type: "rollCallCommit", committeeId, rollCallId: draft.id, revision: draft.revision, copiedFrom: draft.copiedFrom, observedAt: draft.observedAt,
        committedAt: new Date().toISOString(), rows: delegates.map((d) => ({ delegateId: d.id, status: draft.rows[d.id] })) }, "chair");
      if (saved) setDraft(null);
    } finally { setBusy(false); }
  }
  return <>
    <div className="metrics">
      <Metric value={count("Present") + count("Present & Voting")} label={draft ? "Present in this draft" : "Present in the room"} />
      <Metric value={count("Present & Voting")} label="Present & Voting" />
      <Metric value={count("Absent")} label="Absent" />
      <Metric value={draft ? missing : delegates.length - (live?.rows.length ?? 0)} label="Not yet called" />
    </div>
    <Panel title={draft ? (draft.revision > 1 ? "Correcting the roll call" : "New roll call (draft)") : "Current roll call"}
      subtitle={draft ? "Nothing changes until you commit. The draft stays on this device." : live ? `Committed at ${zonedTime(live.committedAt)}${live.revision > 1 ? ` · revision ${live.revision}` : ""}` : "No roll call yet. Nobody counts as present until one is committed."}
      action={<div className="actions">
        {draft ? <>
          <button className="primary" disabled={busy || missing > 0} onClick={() => void commit()}>{missing ? `Call ${missing} more` : "Commit roll call"}</button>
          <button disabled={busy} onClick={() => setDraft(null)}>Discard draft</button>
        </> : <>
          <button className="primary" onClick={() => start(last ? "copy" : undefined)}>{last ? "Copy last roll call" : "Start roll call"}</button>
          {last && <button onClick={() => start()}>Start from blank</button>}
          {last && <button onClick={() => start("correct")}>Correct last roll call</button>}
        </>}
        <Search value={search} onChange={setSearch} />
      </div>}>
      <div className="roll-list">
        {shown.map((d) => {
          const status = statusOf(d.id);
          return (
            <div className="roll-row" key={d.id}>
              <DelegateIdentity delegate={d} detail />
              <div className="attendance-segments" role="group" aria-label={`Attendance for ${d.country}`}>
                {STATUSES.map((s) => (
                  <button key={s} aria-pressed={s === status} className={s === status ? "selected" : ""} disabled={!draft}
                    onClick={() => draft && setDraft({ ...draft, rows: { ...draft.rows, [d.id]: s } })}>
                    <span aria-hidden="true">{s === status ? "✓" : ""}</span>
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
    <p className="footnote">Present & Voting delegates cannot abstain. A ballot uses the roll call in force when it opens; a later roll call does not change an open ballot.</p>
  </>;
}
