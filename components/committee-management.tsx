"use client";
import { useState } from "react";
import styles from "./management.module.css";
import { useConference } from "@/lib/context";
import { Chip, Empty, Modal, PageHeading, Panel } from "./ui";

export function CommitteeManagement() {
  const { data, act } = useConference();
  const [filter, setFilter] = useState("active");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{id:string;action:"archive"|"delete"} | null>(null);
  const [error, setError] = useState("");
  const [editRevision, setEditRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const existing = data.committees.find(c => c.id === editing);
  const target = data.committees.find(c => c.id === confirm?.id);
  const visible = data.committees.filter(c => filter === "all" || (filter === "archived" ? c.archived : !c.archived));
  const slots = (data.sessionSlots ?? []).filter(s => !s.archived);
  function close() { if (!busy) { setEditing(null); setConfirm(null); setError(""); } }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (editing !== "new" && (!existing || (existing.revision ?? 0) !== editRevision)) { setError("This committee changed while you were editing. Close this dialog and reopen it to review the latest details."); return; }
    const form = new FormData(event.currentTarget);
    const fields = {code:String(form.get("code")).trim(),name:String(form.get("name")).trim(),room:String(form.get("room")).trim()};
    if (!fields.code || !fields.name || !fields.room) { setError("Enter a code, name and room."); return; }
    if (data.committees.some(c => c.id !== existing?.id && c.code.toLocaleLowerCase() === fields.code.toLocaleLowerCase())) { setError("That committee code is already in use, including archived committees. Choose a unique code."); return; }
    setBusy(true);setError("");
    try {
      if (await act(existing ? {type:"committeeUpdate", id:existing.id,...fields} : {type:"committee",...fields},"admin")) setEditing(null);
      else setError("The committee could not be saved. Review the status message and current committee details before retrying.");
    } finally { setBusy(false); }
  }
  async function change(action:"archive"|"delete") {
    if (!target || busy) return;
    setBusy(true);setError("");
    try {
      if (await act({type:"committeeLifecycle",id:target.id,action},"admin")) setConfirm(null);
      else setError(action === "delete" ? "Deletion was refused. Committees with linked records must be archived instead. Review the status message if access changed." : "The committee could not be archived. Review the status message and retry.");
    } finally { setBusy(false); }
  }
  return <>
    <PageHeading eyebrow="EXECUTIVE" title="Committees" description="Manage committee details and preserve their operational history." action={<button className="primary" onClick={() => {setEditing("new");setError("");}}>+ Add committee</button>} />
    <Panel title="Committee directory" subtitle="Archived committees remain in historical records and are hidden from normal Chair operation." action={<label>Show <select aria-label="Filter committees" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All committees</option></select></label>}>
      {visible.length ? <div className="table-scroll"><table><thead><tr><th>Code</th><th>Committee</th><th>Room</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map(c => <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.name}</td><td>{c.room}</td><td><Chip tone={c.archived ? "neutral" : "green"}>{c.archived ? "Archived" : "Active"}</Chip></td><td><div className={styles.actions}><button onClick={() => {setEditing(c.id);setEditRevision(c.revision ?? 0);setError("");}}>Edit</button>{!c.archived && <button onClick={() => {setConfirm({id:c.id,action:"archive"});setError("");}}>Archive</button>}<button onClick={() => {setConfirm({id:c.id,action:"delete"});setError("");}}>Delete</button></div></td></tr>)}</tbody></table></div> : <Empty title={filter === "archived" ? "No archived committees" : "No active committees"} text="Add a committee to give its chairs a dedicated operational workspace." />}
    </Panel>
    {editing !== null && <Modal title={existing ? `Edit ${existing.code}` : "Add committee"} onClose={close}><form onSubmit={e => void save(e)} key={editing}><div className="form-grid"><label>Committee code<input name="code" required defaultValue={existing?.code ?? ""} placeholder="GA2" /></label><label>Room<input name="room" required defaultValue={existing?.room ?? ""} placeholder="Room 205" /></label></div><label>Committee name<input name="name" required defaultValue={existing?.name ?? ""} placeholder="Economic & Financial" /></label><p className="footnote">{existing ? "Editing these details preserves all linked records. The committee code must remain unique across the conference." : `This committee will receive all ${slots.length} active central session slots automatically, together with conference defaults.`}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className={styles.actions}><button className="primary" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Create committee"}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div></form></Modal>}
    {confirm && target && <Modal title={`${confirm.action === "archive" ? "Archive" : "Delete"} ${target.code}?`} onClose={close}><div className={styles.confirm}><p>{confirm.action === "archive" ? "Chairs will no longer see this committee in their normal workspace. All linked records remain available as history." : "Only a genuinely unused committee can be deleted. Delegates, assignments, submission links and operational history will block deletion; they are never removed with the committee."}</p>{error && <p role="alert" className="field-error">{error}</p>}<div className={styles.actions}><button disabled={busy} onClick={() => void change(confirm.action)}>{busy ? "Saving…" : confirm.action === "archive" ? "Archive committee" : "Delete unused committee"}</button>{confirm.action === "delete" && !target.archived && <button className="primary" disabled={busy} onClick={() => {setConfirm({id:target.id,action:"archive"});setError("");}}>Archive instead</button>}<button disabled={busy} onClick={close}>Cancel</button></div></div></Modal>}
  </>;
}
