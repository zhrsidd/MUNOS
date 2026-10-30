"use client";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { clockItems, clockOffsetMs, describeHeld, heldByDevice, reasonText } from "@/lib/sessions/held";
import type { HeldAction } from "@/lib/operations/types";
import { Chip, Empty, Modal, PageHeading, Panel } from "./ui";

/** Chair: how many of this committee's actions are waiting for the Executive. They were received and are safe; they have not been applied. */
export function HeldNotice({ committeeId }: { committeeId: string }) {
  const { data } = useConference();
  const open = (data.heldActions ?? []).filter((h) => h.committeeId === committeeId && h.state === "held");
  if (!open.length) return null;
  const reasons = [...new Set(open.map((h) => reasonText(h.reason)))];
  return (
    <div className="callout small" role="status">
      <div>
        <strong>{open.length === 1 ? "1 action is" : `${open.length} actions are`} waiting for Executive review</strong>
        <p>Received and safe, but not applied yet. {reasons.join("; ")}.</p>
      </div>
    </div>
  );
}

type Decision = { held: HeldAction; decision: "approve" | "discard" } | { deviceId: string; decision: "bulk" } | { decision: "close" };
/** Executive: review held actions one by one or per device, the hold switch and tolerances, and closing the day. */
export function HeldReview() {
  const { data, act } = useConference();
  const [pending, setPending] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const held = data.heldActions ?? [];
  const groups = heldByDevice(held);
  const recent = held.filter((h) => h.state !== "held").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, 8);
  const settings = data.holdSettings;
  const committee = (id: string) => data.committees.find((c) => c.id === id)?.code ?? "Committee";
  const todayClosed = (data.dayCloses ?? []).length;
  function close() { if (!busy) { setPending(null); setReason(""); setMinutes(""); setError(""); } }
  async function run(commands: Parameters<typeof act>[0][]) {
    setBusy(true); setError("");
    try {
      for (const command of commands) if (!(await act(command, "admin"))) { if (pending === null) setError("That could not be saved. Check the status message and try again after reviewing the current list."); return false; }
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That could not be saved."); return false; }
    finally { setBusy(false); }
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || busy) return;
    const why = reason.trim();
    if (!why) { setError("Give a reason. It is kept with the decision."); return; }
    let ok = false;
    if (pending.decision === "close") ok = await run([{ type: "closeDay", reason: why }]);
    else if (pending.decision === "bulk") {
      const offset = clockOffsetMs(Number(minutes));
      if (offset === null) { setError("Enter how many minutes the device clock is ahead (positive) or behind (negative)."); return; }
      ok = await run([{ type: "clockConfirm", deviceId: pending.deviceId, offsetMs: offset, reason: why }, { type: "heldBulkApprove", deviceId: pending.deviceId, reason: why }]);
    } else ok = await run([{ type: "heldDecide", heldId: pending.held.id, decision: pending.decision, reason: why }]);
    if (ok) close();
  }
  return <>
    <PageHeading eyebrow="EXECUTIVE" title="Held for review" description="Chair actions the server received but did not apply. Approving applies the original action once, as the Chair who made it." />
    <Panel title="Rules" subtitle={settings ? `Time is trusted within ${settings.trustMinutes} min of the server; a live control action must arrive within ${settings.staleMinutes} min.` : "Settings are not available on this database yet."}
      action={<div className="actions">
        {settings && <button disabled={busy} onClick={() => void run([{ type: "holdSettings", enforce: !settings.enforce }])}>{settings.enforce ? "Turn holding off" : "Turn holding on"}</button>}
        <button disabled={busy} onClick={() => setPending({ decision: "close" })}>Close today…</button>
      </div>}>
      <p className="muted">{settings?.enforce ? "Holding is ON: unverified or out-of-schedule Chair actions are held." : "Holding is OFF: every action is applied and only labelled. Turn it on once schedules are published and devices are reporting their clocks."}</p>
      {todayClosed > 0 && <p className="muted">{todayClosed} conference {todayClosed === 1 ? "day is" : "days are"} closed: anything arriving for a closed day is held.</p>}
    </Panel>
    {groups.length === 0
      ? <Empty title="Nothing is waiting" text="Held Chair actions appear here with the reason and the device that made them." />
      : groups.map((g) => <Panel key={g.deviceId ?? "unknown"} title={g.deviceId ? `Device ${g.deviceId.slice(0, 8)}` : "Device not reported"} subtitle={`${g.items.length} waiting`}
          action={g.deviceId && clockItems(g.items).length > 0 ? <button disabled={busy} onClick={() => setPending({ deviceId: g.deviceId!, decision: "bulk" })}>Confirm clock and approve {clockItems(g.items).length}…</button> : undefined}>
          <div className="table-scroll"><table><thead><tr><th>Committee</th><th>Action</th><th>Why held</th><th>Made</th><th>Actions</th></tr></thead><tbody>
            {g.items.map((h) => <tr key={h.id}>
              <td>{committee(h.committeeId)}</td>
              <td>{describeHeld(h, data)}</td>
              <td>{reasonText(h.reason)}{h.lastError && <small className="muted"> · {h.lastError}</small>}</td>
              <td>{h.clientTime ? new Date(h.clientTime).toLocaleString("en-GB", { timeZone: "Asia/Qatar", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "—"}</td>
              <td><div className="actions"><button disabled={busy} onClick={() => setPending({ held: h, decision: "approve" })}>Approve…</button><button disabled={busy} onClick={() => setPending({ held: h, decision: "discard" })}>Discard…</button></div></td>
            </tr>)}
          </tbody></table></div>
        </Panel>)}
    {recent.length > 0 && <Panel title="Recently decided" subtitle="Kept for the record.">
      <div className="table-scroll"><table><thead><tr><th>Committee</th><th>Action</th><th>Decision</th><th>Reason</th></tr></thead><tbody>
        {recent.map((h) => <tr key={h.id}><td>{committee(h.committeeId)}</td><td>{describeHeld(h, data)}</td><td><Chip tone={h.state === "applied" ? "approved" : "draft"}>{h.state === "applied" ? "Approved" : "Discarded"}</Chip></td><td>{h.decisionReason}</td></tr>)}
      </tbody></table></div>
    </Panel>}
    {pending && <Modal title={pending.decision === "close" ? "Close today?" : pending.decision === "bulk" ? "Confirm this device&apos;s clock" : pending.decision === "approve" ? "Approve this action?" : "Discard this action?"} onClose={close}>
      <form onSubmit={(e) => void confirm(e)}>
        {pending.decision === "close" && <p>After this, anything that arrives for today is held for review. It cannot be undone.</p>}
        {pending.decision === "bulk" && <>
          <p>You are confirming how far this device&apos;s clock was off, then approving its waiting actions in order. They are recorded at their corrected times.</p>
          <label>Minutes the clock is ahead of real time (negative: behind)<input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="-180" /></label>
        </>}
        {(pending.decision === "approve" || pending.decision === "discard") && <p>{describeHeld(pending.held, data)} · {reasonText(pending.held.reason)}.{pending.decision === "approve" ? " It will be applied once, as the Chair who made it, if their access and the record still allow." : " It will not be applied. It stays in the record."}</p>}
        <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Confirm"}</button></div>
      </form>
    </Modal>}
    {error && !pending && <p className="form-error" role="alert">{error}</p>}
  </>;
}
