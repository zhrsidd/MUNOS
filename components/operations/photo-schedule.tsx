"use client";
import { useMemo, useState } from "react";
import { useConference } from "@/lib/context";
import type { PhotoSlot } from "@/lib/operations/types";
import { affectedCommittees, stageAt } from "@/lib/operations/photo-reminders";
import { parsePhotoSchedule, reviewPhotoSchedule, type PhotoDraft } from "@/lib/operations/photo-import";
import type { DateOrder } from "@/lib/operations/schedule-import";
import { CONFERENCE_TIMEZONE, zonedDate, zonedDay, zonedTime, zonedToUtc } from "@/lib/operations/time";
import { Chip, Empty, Modal, PageHeading, Panel } from "../ui";
import { useClock } from "./photo-reminders";

const EXAMPLE = `school,date,start_time,end_time,location
Doha College,Day 1,13:30,13:45,Main Courtyard
Park House English School,Day 1,13:45,14:00,Main Courtyard`;
type Form = { slotId?: string; schoolId: string; date: string; start: string; end: string; location: string; note: string; warnMinutes: number; enabled: boolean };

function SlotForm({ initial, close }: { initial: Form; close: () => void }) {
  const { data, act } = useConference();
  const [f, setF] = useState(initial);
  const [error, setError] = useState("");
  const set = (change: Partial<Form>) => setF((x) => ({ ...x, ...change }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.schoolId || !f.date || !f.start || !f.location.trim()) return setError("School, date, start time and location are required.");
    if (f.end && f.end <= f.start) return setError("The end time must be after the start time.");
    const fields = { schoolId: f.schoolId, startsAt: zonedToUtc(f.date, f.start), endsAt: f.end ? zonedToUtc(f.date, f.end) : null, location: f.location.trim(), note: f.note.trim(), warnMinutes: f.warnMinutes, enabled: f.enabled };
    const ok = await act(f.slotId ? { type: "photoSlot", action: "update", slotId: f.slotId, ...fields } : { type: "photoSlot", action: "create", ...fields }, "admin");
    if (ok) close();
  }
  return (
    <form className="photo-form" onSubmit={save}>
      <label>
        School
        <select value={f.schoolId} onChange={(e) => set({ schoolId: e.target.value })} required>
          <option value="">Choose a school…</option>
          {data.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({data.delegates.filter((d) => d.schoolId === s.id).length} delegates)
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Date
          <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
        </label>
        <label>
          Start
          <input type="time" value={f.start} onChange={(e) => set({ start: e.target.value })} required />
        </label>
        <label>
          End (optional)
          <input type="time" value={f.end} onChange={(e) => set({ end: e.target.value })} />
        </label>
      </div>
      <label>
        Location
        <input value={f.location} maxLength={120} placeholder="Main Courtyard" onChange={(e) => set({ location: e.target.value })} required />
      </label>
      <label>
        Note (optional)
        <input value={f.note} maxLength={300} placeholder="Bring blazers" onChange={(e) => set({ note: e.target.value })} />
      </label>
      <div className="form-row">
        <label>
          Warn chairs (minutes before)
          <input type="number" min={1} max={60} value={f.warnMinutes} onChange={(e) => set({ warnMinutes: Math.min(60, Math.max(1, Number(e.target.value) || 10)) })} />
        </label>
        {f.slotId && (
          <label className="inline">
            <input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Slot active (untick to cancel)
          </label>
        )}
      </div>
      <p className="muted">Times are conference time ({CONFERENCE_TIMEZONE}). Changing the time or place re-alerts chairs who already acknowledged.</p>
      {error && <p className="submit-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary">{f.slotId ? "Save changes" : "Add photo slot"}</button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function PhotoImport({ close }: { close: () => void }) {
  const { data, act } = useConference();
  const [text, setText] = useState("");
  const [order, setOrder] = useState<DateOrder>("DMY");
  const [rows, setRows] = useState<PhotoDraft[] | null>(null);
  const [error, setError] = useState("");
  const review = useMemo(() => (rows ? reviewPhotoSchedule(rows, data) : null), [rows, data]);
  const edit = (key: string, change: Partial<PhotoDraft>) => setRows((all) => all!.map((r) => (r.key === key ? { ...r, ...change } : r)));
  if (!rows || !review)
    return (
      <div className="photo-form">
        <p>
          Columns: <b>school, date, start_time, end_time, location</b> (optional <b>note</b>). Schools must already exist; names are matched carefully and anything uncertain is
          shown for you to confirm.
        </p>
        <label>
          Upload CSV
          <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        </label>
        <label>
          Or paste
          <textarea rows={7} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} aria-label="Photo schedule text" />
        </label>
        <label>
          Dates written as
          <select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
            <option value="DMY">Day/Month/Year</option>
            <option value="MDY">Month/Day/Year</option>
          </select>
        </label>
        {error && <p className="submit-error" role="alert">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={!text.trim()} onClick={() => { try { const r = parsePhotoSchedule(text, data, order); if (!r.length) setError("Nothing to import."); else setRows(r); } catch (e) { setError(e instanceof Error ? e.message : "Could not read the text."); } }}>
            Preview
          </button>
          <button onClick={() => setText(EXAMPLE)}>Load example</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    );
  const blocked = review.summary.invalid > 0 || review.summary.create === 0;
  return (
    <div className="photo-form">
      <p role="status">
        <b>{review.summary.create}</b> slot{review.summary.create === 1 ? "" : "s"} to create · {review.summary.duplicates} duplicate{review.summary.duplicates === 1 ? "" : "s"} skipped
        {review.summary.invalid > 0 && <> · <b className="danger-text">{review.summary.invalid} need attention</b></>}
      </p>
      <div className="table-scroll">
        <table className="schedule-table">
          <thead>
            <tr>
              <th>Import</th>
              <th>School in file</th>
              <th>Matched school</th>
              <th>When</th>
              <th>Location</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {review.rows.map((r) => (
              <tr key={r.key} className={!r.include ? "skipped" : r.errors.length ? "invalid" : ""}>
                <td>
                  <input type="checkbox" aria-label={`Import line ${r.line}`} checked={r.include} onChange={(e) => edit(r.key, { include: e.target.checked })} />
                </td>
                <td>{r.schoolText || "—"}</td>
                <td>
                  <select aria-label={`School line ${r.line}`} value={r.schoolId} onChange={(e) => edit(r.key, { schoolId: e.target.value })}>
                    <option value="">{r.match.kind === "suggested" ? `Did you mean ${r.match.suggestions[0].name}?` : "Choose school…"}</option>
                    {(r.match.kind === "suggested" ? [...r.match.suggestions, ...data.schools.filter((s) => !(r.match.kind === "suggested" && r.match.suggestions.includes(s)))] : data.schools).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {r.schoolId && <small className="muted">{r.delegates} delegates</small>}
                </td>
                <td>
                  {r.date} {r.start}
                  {r.end && `–${r.end}`}
                </td>
                <td>
                  <input aria-label={`Location line ${r.line}`} value={r.location} onChange={(e) => edit(r.key, { location: e.target.value })} />
                </td>
                <td className="schedule-result">
                  {!r.include ? <Chip tone="neutral">Skipped</Chip> : r.errors.length ? r.errors.map((e) => <span key={e} className="danger-text">{e}</span>) : r.duplicate ? <span className="muted">Already scheduled</span> : <Chip tone="green">Ready</Chip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="primary" disabled={blocked} onClick={() => void act({ type: "photoImport", rows: review.slots }, "admin").then((ok) => ok && close())}>
          Create {review.summary.create} slot{review.summary.create === 1 ? "" : "s"}
        </button>
        <button onClick={() => setRows(null)}>Back</button>
        <button onClick={close}>Cancel</button>
      </div>
    </div>
  );
}
const statusChip = (slot: PhotoSlot, now: number) => {
  if (!slot.enabled) return <Chip tone="neutral">Cancelled</Chip>;
  const stage = stageAt(slot, now);
  return stage === "upcoming" ? <Chip tone="neutral">Upcoming</Chip> : stage === "warning" ? <Chip tone="review">Chairs alerted</Chip> : stage === "due" ? <Chip tone="blue">Now</Chip> : <Chip tone="closed">Done</Chip>;
};
/** Executive → Group photos. */
export function PhotoSchedule() {
  const { data, act } = useConference();
  const [modal, setModal] = useState<{ kind: "form"; form: Form } | { kind: "import" } | null>(null);
  const now = useClock(30_000);
  const slots = data.photoSlots ?? [];
  const days = [...new Set(slots.map((s) => zonedDate(s.startsAt)))];
  const blank: Form = { schoolId: "", date: data.conference.date, start: "", end: "", location: "", note: "", warnMinutes: 10, enabled: true };
  const editForm = (s: PhotoSlot): Form => ({ slotId: s.id, schoolId: s.schoolId, date: zonedDate(s.startsAt), start: zonedTime(s.startsAt), end: s.endsAt ? zonedTime(s.endsAt) : "", location: s.location, note: s.note, warnMinutes: s.warnMinutes, enabled: s.enabled });
  const toggle = (s: PhotoSlot) => act({ type: "photoSlot", action: "update", slotId: s.id, schoolId: s.schoolId, startsAt: s.startsAt, endsAt: s.endsAt, location: s.location, note: s.note, warnMinutes: s.warnMinutes, enabled: !s.enabled }, "admin");
  return (
    <>
      <PageHeading
        eyebrow="EXECUTIVE"
        title="Group photos"
        description="School photo slots. Only chairs with delegates from that school are reminded — 10 minutes before and at the time."
        action={
          <div className="actions">
            <button onClick={() => setModal({ kind: "import" })}>Import CSV</button>
            <button className="primary" onClick={() => setModal({ kind: "form", form: blank })}>
              + Add photo slot
            </button>
          </div>
        }
      />
      {!slots.length && <Empty title="No photo slots yet" text="Add slots one by one or import a CSV with school, date, start time, end time and location." />}
      {days.map((day) => (
        <Panel key={day} title={zonedDay(slots.find((s) => zonedDate(s.startsAt) === day)!.startsAt)}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>School</th>
                  <th>Location</th>
                  <th>Committees to send delegates</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slots
                  .filter((s) => zonedDate(s.startsAt) === day)
                  .map((s) => {
                    const affected = affectedCommittees(data, s);
                    return (
                      <tr key={s.id} className={s.enabled ? "" : "skipped"}>
                        <td>
                          {zonedTime(s.startsAt)}
                          {s.endsAt && `–${zonedTime(s.endsAt)}`}
                        </td>
                        <td>
                          <strong>{data.schools.find((x) => x.id === s.schoolId)?.name}</strong>
                          {s.note && <small className="muted"> · {s.note}</small>}
                        </td>
                        <td>{s.location}</td>
                        <td>
                          {affected.length ? (
                            <span className="committee-acks">
                              {affected.map((a) => (
                                <span key={a.committee.id} title={a.dueAcknowledged ? "Delegates sent" : a.warningAcknowledged ? "Chair acknowledged" : "Not yet acknowledged"}>
                                  {a.committee.code} · {a.delegates} {a.dueAcknowledged ? "✓✓" : a.warningAcknowledged ? "✓" : ""}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="danger-text">No delegates from this school</span>
                          )}
                        </td>
                        <td>{statusChip(s, now)}</td>
                        <td>
                          <div className="actions">
                            <button onClick={() => setModal({ kind: "form", form: editForm(s) })}>Edit</button>
                            <button onClick={() => (s.enabled ? window.confirm("Cancel this photo slot? Affected chairs are told it is cancelled.") : true) && void toggle(s)}>{s.enabled ? "Cancel slot" : "Restore"}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <p className="muted">✓ chair acknowledged the warning · ✓✓ chair confirmed delegates were sent. Times are conference time ({CONFERENCE_TIMEZONE}).</p>
      {modal?.kind === "form" && (
        <Modal title={modal.form.slotId ? "Edit photo slot" : "Add photo slot"} onClose={() => setModal(null)}>
          <SlotForm initial={modal.form} close={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "import" && (
        <Modal title="Import photo schedule" onClose={() => setModal(null)}>
          <PhotoImport close={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}
