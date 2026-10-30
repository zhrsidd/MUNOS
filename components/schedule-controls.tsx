"use client";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { displayedResolution } from "@/lib/sessions/display";
import { DEFAULT_GRACE_MINUTES, DEFAULT_LEAD_MINUTES } from "@/lib/sessions/window";
import { zonedTime } from "@/lib/operations/time";
import { Chip, Modal, Panel } from "./ui";

type Pending = { kind: "publish" } | { kind: "automation"; enabled: boolean } | { kind: "override" };
/**
 * Executive schedule controls (docs/SESSION_MODEL.md sections 3 and 12.9): publish the central slots as each committee's schedule, switch
 * automation, and set an override. Chairs never choose a session; this is the only place sessions are changed.
 */
export function ScheduleControls() {
  const { data, act } = useConference();
  const [pending, setPending] = useState<Pending | null>(null);
  const [committee, setCommittee] = useState("");
  const [lead, setLead] = useState(String(DEFAULT_LEAD_MINUTES));
  const [grace, setGrace] = useState(String(DEFAULT_GRACE_MINUTES));
  const [slot, setSlot] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const committees = data.committees.filter((c) => !c.archived);
  const slots = (data.sessionSlots ?? []).filter((s) => !s.archived).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const schedules = data.sessionSchedules;
  const nowIso = new Date().toISOString();
  const latest = (id: string) => schedules?.find((s) => s.committeeId === id)?.versions.at(-1);
  const close = () => { if (!busy) { setPending(null); setReason(""); setError(""); } };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || busy) return;
    const why = reason.trim();
    if (pending.kind !== "override" && !why) { setError("Give a reason. It is kept with the schedule version."); return; }
    const scope = committee ? { committeeId: committee } : {};
    setBusy(true); setError("");
    try {
      const ok = pending.kind === "publish"
        ? await act({ type: "scheduleVersion", ...scope, leadMinutes: Number(lead), graceMinutes: Number(grace), automationEnabled: true, reason: why }, "admin")
        : pending.kind === "automation"
          ? await act({ type: "automationToggle", ...scope, enabled: pending.enabled, reason: why }, "admin")
          : committee
            ? await act({ type: "overrideSet", scope: "committee", committeeId: committee, sessionId: data.sessions.find((s) => s.committeeId === committee && s.slotId === slot)?.id ?? "" }, "admin")
            : await act({ type: "overrideSet", scope: "conference", slotId: slot }, "admin");
      if (ok) close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the values."); }
    finally { setBusy(false); }
  }
  if (!schedules) return <Panel title="Live schedule" subtitle="Available on the live conference database."><p className="muted">Publishing the schedule, automation and overrides are made on the live conference database.</p></Panel>;
  return <>
    <Panel title="Live schedule" subtitle="What each committee shows now. Sessions switch by the published schedule: 5 minutes before the next session starts, never before the previous one ends."
      action={<div className="actions">
        <button className="primary" onClick={() => setPending({ kind: "publish" })}>Publish schedule…</button>
        <button onClick={() => setPending({ kind: "override" })}>Set session now…</button>
        <button onClick={() => setPending({ kind: "automation", enabled: false })}>Pause automation…</button>
        <button onClick={() => setPending({ kind: "automation", enabled: true })}>Resume automation…</button>
      </div>}>
      <div className="table-scroll"><table><thead><tr><th>Committee</th><th>Now</th><th>Next change</th><th>Automation</th></tr></thead><tbody>
        {committees.map((c) => {
          const now = displayedResolution(data, c.id, nowIso);
          const session = now?.sessionId ? data.sessions.find((s) => s.id === now.sessionId) : undefined;
          const version = latest(c.id);
          return <tr key={c.id}>
            <td>{c.code}</td>
            <td>{session ? session.name : <Chip tone="neutral">{now ? "No session" : "Not published"}</Chip>}{now?.source === "override" ? " · set by Executive" : ""}</td>
            <td>{now?.nextSwitchAt ? zonedTime(now.nextSwitchAt) : "—"}</td>
            <td>{version ? (version.automationEnabled ? `On · lead ${version.leadMinutes} min · grace ${version.graceMinutes} min` : "Paused") : "—"}</td>
          </tr>;
        })}
      </tbody></table></div>
    </Panel>
    {pending && <Modal title={pending.kind === "publish" ? "Publish the schedule" : pending.kind === "override" ? "Set the session now" : pending.enabled ? "Resume automation" : "Pause automation"} onClose={close}>
      <form onSubmit={(e) => void save(e)}>
        <label>Committee<select value={committee} onChange={(e) => setCommittee(e.target.value)}>
          <option value="">Every committee</option>
          {committees.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select></label>
        {pending.kind === "publish" && <>
          <p className="muted">Publishes the central sessions as the schedule from now on. It never changes the label of anything recorded earlier.</p>
          <label>Switch this many minutes before a session starts<input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
          <label>Keep the last session of the day open for (minutes)<input inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} /></label>
        </>}
        {pending.kind === "override" && <>
          <p className="muted">Shows this session until the next scheduled switch (or, with automation paused, until midnight). Resuming automation ends it.</p>
          <label>Session<select value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="">Choose a session</option>
            {slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        </>}
        {pending.kind === "automation" && <p className="muted">{pending.enabled ? "Sessions switch by the schedule again. Any session you set by hand ends now." : "No session is shown until you set one or resume automation."}</p>}
        {pending.kind !== "override" && <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy || (pending.kind === "override" && !slot)}>{busy ? "Saving…" : "Confirm"}</button></div>
      </form>
    </Modal>}
  </>;
}
