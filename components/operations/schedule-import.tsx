"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useConference } from "@/lib/context";
import { MAX_IMPORT_SESSIONS, parseSchedule, reviewSchedule, type DateOrder, type DraftRow } from "@/lib/operations/schedule-import";
import { CONFERENCE_TIMEZONE, zonedDay } from "@/lib/operations/time";
import { Chip, PageHeading, Panel } from "../ui";

const EXAMPLE = `Date,Session,Start,End,Committees
Day 1,Opening Ceremony,08:30,09:30,All
Day 1,Committee Session 1,09:45,11:15,All
Day 1,Lunch,12:00,13:00,
Day 1,Committee Session 2,13:00,14:30,All
Day 2,Committee Session 3,09:00,10:30,"GA1, SC"`;

export function ScheduleImport() {
  const { data, act } = useConference();
  const [step, setStep] = useState<"input" | "review" | "done">("input");
  const [text, setText] = useState("");
  const [order, setOrder] = useState<DateOrder>("DMY");
  const [defaultAll, setDefaultAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(0);
  const defaults = useMemo(() => (defaultAll ? data.committees.map((c) => c.id) : chosen), [defaultAll, data.committees, chosen]);
  const review = useMemo(() => reviewSchedule(rows, data, defaults), [rows, data, defaults]);
  const code = (id: string) => data.committees.find((c) => c.id === id)?.code ?? "?";
  const blocked = review.summary.invalid > 0 || review.summary.create === 0 || review.summary.tooMany;

  function preview() {
    setError("");
    try {
      const parsed = parseSchedule(text, data.conference.date, order);
      if (!parsed.length) return setError("Nothing to import. Paste the schedule with one row per session.");
      setRows(parsed);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The schedule could not be read.");
    }
  }
  const edit = (key: string, change: Partial<DraftRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change, parseErrors: "date" in change || "start" in change || "end" in change ? [] : r.parseErrors } : r)));
  async function confirm() {
    if (blocked) return;
    if (await act({ type: "sessionImport", rows: review.sessions }, "admin")) {
      setCreated(review.sessions.length);
      setStep("done");
    }
  }
  function cancel() {
    setRows([]);
    setStep("input");
    setError("");
  }

  return (
    <>
      <PageHeading
        eyebrow="EXECUTIVE"
        title="Import conference schedule"
        description={`Paste the schedule, check the preview, then confirm. Times are conference time (${CONFERENCE_TIMEZONE}).`}
      />
      <div className="import-steps">
        {[
          ["input", "1. Paste or upload"],
          ["review", "2. Review & fix"],
          ["done", "3. Created"],
        ].map(([id, label]) => (
          <span key={id} className={step === id ? "active" : ""}>
            {label}
          </span>
        ))}
      </div>
      {step === "input" && (
        <Panel title="Schedule" subtitle="CSV, or copy the rows straight from Excel / Google Sheets. One row per session. A header row is recommended.">
          <div className="panel-body schedule-input">
            <label>
              Upload a CSV or text file
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
            </label>
            <label>
              Or paste here
              <textarea rows={10} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} aria-label="Schedule text" />
            </label>
            <p className="muted">
              Columns: <b>Date</b> (13/11/2026, Day 2 or Friday), <b>Session</b>, <b>Start</b>, <b>End</b> (or one <b>Time</b> column like 09:00–10:30),{" "}
              <b>Committees</b> (All, or codes such as GA1, SC). Blank dates repeat the date above. Lunch, breaks and ceremonies are listed but not imported unless you tick them.
            </p>
            <div className="schedule-options">
              <label>
                Dates written as
                <select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
                  <option value="DMY">Day/Month/Year (13/11/2026)</option>
                  <option value="MDY">Month/Day/Year (11/13/2026)</option>
                </select>
              </label>
              <fieldset>
                <legend>Rows without committees apply to</legend>
                <label className="inline">
                  <input type="radio" checked={defaultAll} onChange={() => setDefaultAll(true)} /> All committees
                </label>
                <label className="inline">
                  <input type="radio" checked={!defaultAll} onChange={() => setDefaultAll(false)} /> Only:
                </label>
                {!defaultAll &&
                  data.committees.map((c) => (
                    <label className="inline" key={c.id}>
                      <input type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} /> {c.code}
                    </label>
                  ))}
              </fieldset>
            </div>
            {error && <p className="submit-error" role="alert">{error}</p>}
            <div className="actions">
              <button className="primary" disabled={!text.trim()} onClick={preview}>
                Preview
              </button>
              <button onClick={() => setText(EXAMPLE)}>Load example</button>
            </div>
          </div>
        </Panel>
      )}
      {step === "review" && (
        <Panel
          title="Review before creating"
          subtitle="Untick rows you do not want. Edit any cell to fix it. Nothing is created until you confirm."
          action={<Chip tone={blocked ? "neutral" : "green"}>{review.summary.create} to create</Chip>}
        >
          <div className="panel-body">
            <p className="schedule-summary" role="status">
              <b>{review.summary.create}</b> session{review.summary.create === 1 ? "" : "s"} across <b>{review.summary.committees}</b> committee
              {review.summary.committees === 1 ? "" : "s"} · {review.summary.duplicates} duplicate{review.summary.duplicates === 1 ? "" : "s"} skipped ·{" "}
              {review.summary.skipped} row{review.summary.skipped === 1 ? "" : "s"} not imported
              {review.summary.invalid > 0 && <> · <b className="danger-text">{review.summary.invalid} need fixing or unticking</b></>}
              {review.summary.tooMany && <> · <b className="danger-text">more than {MAX_IMPORT_SESSIONS} sessions — import in parts</b></>}
            </p>
          </div>
          <div className="table-scroll">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Import</th>
                  <th>Date</th>
                  <th>Session</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Committees</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((r) => (
                  <tr key={r.key} className={!r.include ? "skipped" : r.errors.length ? "invalid" : ""}>
                    <td>
                      <input type="checkbox" aria-label={`Import line ${r.line}`} checked={r.include} onChange={(e) => edit(r.key, { include: e.target.checked })} />
                      <small className="muted"> {r.line}</small>
                    </td>
                    <td>
                      <input type="date" aria-label={`Date line ${r.line}`} value={r.date} onChange={(e) => edit(r.key, { date: e.target.value })} />
                      {r.startsAt && <small className="muted">{zonedDay(r.startsAt)}</small>}
                    </td>
                    <td>
                      <input aria-label={`Session line ${r.line}`} value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} />
                    </td>
                    <td>
                      <input type="time" aria-label={`Start line ${r.line}`} value={r.start} onChange={(e) => edit(r.key, { start: e.target.value })} />
                    </td>
                    <td>
                      <input type="time" aria-label={`End line ${r.line}`} value={r.end} onChange={(e) => edit(r.key, { end: e.target.value })} />
                    </td>
                    <td>
                      <input aria-label={`Committees line ${r.line}`} value={r.committees} placeholder={defaultAll ? "All (default)" : "Default selection"} onChange={(e) => edit(r.key, { committees: e.target.value })} />
                      <small className="muted">{r.committeeIds.map(code).join(", ")}</small>
                    </td>
                    <td className="schedule-result">
                      {!r.include ? (
                        <Chip tone="neutral">{r.nonCommittee ? "Not a committee session" : "Skipped"}</Chip>
                      ) : r.errors.length ? (
                        r.errors.map((e) => <span key={e} className="danger-text">{e}</span>)
                      ) : (
                        <>
                          {r.creates > 0 && <Chip tone="green">Creates {r.creates}</Chip>}
                          {r.duplicateCommitteeIds.length > 0 && <span className="muted">Already exists: {r.duplicateCommitteeIds.map(code).join(", ")}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-body actions">
            <button className="primary" disabled={blocked} onClick={() => void confirm()}>
              Create {review.summary.create} session{review.summary.create === 1 ? "" : "s"}
            </button>
            <button onClick={() => setStep("input")}>Back</button>
            <button onClick={cancel}>Cancel</button>
          </div>
        </Panel>
      )}
      {step === "done" && (
        <Panel title={`Created ${created} session${created === 1 ? "" : "s"}`} subtitle="Chairs see them in their session selector.">
          <div className="panel-body actions">
            <Link className="button primary" href="/admin/sessions">
              View sessions
            </Link>
            <button onClick={() => { setText(""); cancel(); }}>Import more</button>
          </div>
        </Panel>
      )}
    </>
  );
}
