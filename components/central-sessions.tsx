"use client";
import { useState } from "react";
import styles from "./management.module.css";
import { useConference } from "@/lib/context";
import { Chip, Empty, Modal, PageHeading, Panel } from "./ui";
import { sessionInputTime, sessionSlotFields, sessionTimeLabel } from "./central-session-fields";

type Confirmation = { id: string; action: "archive" | "delete" };
export function CentralSessions() {
  const { data, act } = useConference();
  const [filter, setFilter] = useState("active");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [error, setError] = useState("");
  const [editRevision, setEditRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const slots = data.sessionSlots ?? [];
  const existing = slots.find(s => s.id === editing);
  const target = slots.find(s => s.id === confirm?.id);
  const visible = slots.filter(s => filter === "all" || (filter === "archived" ? s.archived : !s.archived)).sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const historical = data.sessions.filter(s => !s.slotId).sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const activeCommittees = data.committees.filter(c => !c.archived).length;
  function close() { if (!busy) { setEditing(null); setConfirm(null); setError(""); } }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (editing !== "new" && (!existing || existing.revision !== editRevision)) { setError("This session changed while you were editing. Close this dialog and reopen it to review the latest schedule."); return; }
    const form = new FormData(event.currentTarget);
    try {
      const fields = sessionSlotFields(String(form.get("name")), String(form.get("start")), String(form.get("end")));
      setBusy(true); setError("");
      const saved = await act({ type: "sessionSlot", action: existing ? "update" : "create", ...(existing ? { id: existing.id } : {}), ...fields }, "admin");
      if (saved) setEditing(null); else setError("The session could not be saved. Check the status message and retry after reviewing the current schedule.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the session details."); }
    finally { setBusy(false); }
  }
  async function change(action: "archive" | "delete") {
    if (!target || busy) return;
    setBusy(true); setError("");
    try {
      if (await act({ type: "sessionSlot", id: target.id, action }, "admin")) setConfirm(null);
      else setError(action === "delete" ? "Deletion was refused. Linked activity must be preserved; archive this session instead, or review the status message if access changed." : "The session could not be archived. Review the status message and retry.");
    } finally { setBusy(false); }
  }
  return <>
    <PageHeading eyebrow="EXECUTIVE" title="Conference sessions" description="One shared schedule. Each committee keeps its own attendance, debate and participation history." action={<button className="primary" onClick={() => { setError(""); setEditing("new"); }}>+ Add session</button>} />
    <Panel title="Central schedule" subtitle={`New sessions are created for all ${activeCommittees} active committees. Times shown in Qatar (UTC+03:00).`} action={<label>Show <select aria-label="Filter central sessions" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All sessions</option></select></label>}>
      {visible.length ? <div className="table-scroll"><table><thead><tr><th>Session</th><th>Start · Qatar</th><th>End · Qatar</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map(s => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{sessionTimeLabel(s.startsAt)}</td><td>{sessionTimeLabel(s.endsAt)}</td><td><Chip tone={s.archived ? "neutral" : "green"}>{s.archived ? "Archived" : "Active"}</Chip></td><td><div className={styles.actions}><button disabled={s.archived} onClick={() => { setEditing(s.id); setEditRevision(s.revision); setError(""); }}>Edit</button>{!s.archived && <button onClick={() => { setConfirm({ id:s.id, action:"archive" }); setError(""); }}>Archive</button>}<button onClick={() => { setConfirm({ id:s.id, action:"delete" }); setError(""); }}>Delete</button></div></td></tr>)}</tbody></table></div> : <Empty title={filter === "archived" ? "No archived sessions" : "No central sessions yet"} text="Create a session to add the same schedule to every active committee." />}
    </Panel>
    {historical.length > 0 && <Panel title="Earlier committee sessions" subtitle="These records predate the central schedule and remain read-only here. They have not been grouped automatically because their names and times may differ."><div className="table-scroll"><table><thead><tr><th>Session</th><th>Committee</th><th>Start · Qatar</th><th>Status</th></tr></thead><tbody>{historical.map(s => <tr key={s.id}><td>{s.name}</td><td>{data.committees.find(c => c.id === s.committeeId)?.code ?? "Historical committee"}</td><td>{sessionTimeLabel(s.startsAt)}</td><td><Chip tone="neutral">{s.archived ? "Archived" : s.state}</Chip></td></tr>)}</tbody></table></div><p className="footnote">Attendance, documents and contributions stay linked to their original committee session. Creating a central slot does not move that history.</p></Panel>}
    {editing !== null && <Modal title={existing ? "Edit conference session" : "Add conference session"} onClose={close}><form onSubmit={e => void save(e)} key={editing}><label>Session name<input name="name" required defaultValue={existing?.name ?? ""} placeholder="Session 1 · Friday morning" /></label><div className="form-grid"><label>Start · Qatar time<input name="start" type="datetime-local" required defaultValue={sessionInputTime(existing?.startsAt)} /></label><label>End · Qatar time (optional)<input name="end" type="datetime-local" defaultValue={sessionInputTime(existing?.endsAt)} /></label></div><p className="footnote">{existing ? "Updates change the shared schedule while preserving every committee’s session ID and history." : "This creates a separate session for every active committee. New committees also receive the central schedule."}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className={styles.actions}><button className="primary" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Create for all committees"}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div></form></Modal>}
    {confirm && target && <Modal title={`${confirm.action === "archive" ? "Archive" : "Delete"} ${target.name}?`} onClose={close}><div className={styles.confirm}><p>{confirm.action === "archive" ? "This removes the session from current-session choices. Its committee sessions and all history are preserved." : "Deletion is allowed only when none of its committee sessions has operational activity. Any linked records will block deletion."}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className={styles.actions}><button disabled={busy} onClick={() => void change(confirm.action)}>{busy ? "Saving…" : confirm.action === "archive" ? "Archive session" : "Delete unused session"}</button>{confirm.action === "delete" && !target.archived && <button className="primary" disabled={busy} onClick={() => { setConfirm({id:target.id,action:"archive"}); setError(""); }}>Archive instead</button>}<button disabled={busy} onClick={close}>Cancel</button></div></div></Modal>}
  </>;
}
