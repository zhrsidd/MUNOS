"use client";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { participationSummary } from "@/lib/commands";
import { deductionProblem, MAX_DEDUCTION, REASON_MAX } from "@/lib/operations/commands";
import type { Delegate } from "@/lib/domain";
import { Chip, Modal, Panel } from "./ui";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Qatar", dateStyle: "medium", timeStyle: "short" });
const QUICK = [1, 2, 3, 5, 10];

/** Deduct a chosen number of points. Recorded as an adjustment; the delegate's original scores are not changed. */
export function DeductPoints({ delegate, sessionId, onClose }: { delegate: Delegate; sessionId: string; onClose: () => void }) {
  const { data, act } = useConference();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const total = participationSummary(data, delegate.id).points;
  const parsed = /^\d+$/.test(amount) ? Number(amount) : NaN;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = deductionProblem(parsed, reason);
    if (problem) return setError(problem);
    setBusy(true);
    const ok = await act({ type: "pointAdjustment", action: "deduct", delegateId: delegate.id, sessionId, amount: parsed, reason: reason.trim() }, "chair");
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal title={`Deduct points · ${delegate.country}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="deduct-form">
        <p className="muted">
          Current total {total} pts. The deduction is recorded with your name, the reason and the time. Original scores stay in the log.
        </p>
        <label>
          Points to deduct (1 to {MAX_DEDUCTION})
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DEDUCTION}
            step={1}
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
          />
        </label>
        <div className="quick-amounts" role="group" aria-label="Common amounts">
          {QUICK.map((n) => (
            <button type="button" key={n} onClick={() => { setAmount(String(n)); setError(""); }}>
              {n}
            </button>
          ))}
        </div>
        <label>
          Reason
          <textarea
            required
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
            placeholder="What happened, in a sentence"
          />
        </label>
        {Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_DEDUCTION && (
          <p aria-live="polite">
            Total after: <strong>{total - parsed} pts</strong>
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Deduct points
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Every adjustment for this committee, newest first. A restore is its own row; the deduction is never removed. */
export function AdjustmentHistory({ committeeId }: { committeeId: string }) {
  const { data, act } = useConference();
  const delegates = new Map(data.delegates.filter((d) => d.committeeId === committeeId).map((d) => [d.id, d]));
  const list = (data.pointAdjustments ?? []).filter((a) => delegates.has(a.delegateId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const restored = new Set(list.filter((a) => a.reverses).map((a) => a.reverses));
  return (
    <Panel title="Point adjustments" subtitle="Deductions are recorded separately. Original scores are never changed.">
      {list.length ? (
        <ul className="adjustments" aria-label="Point adjustments, newest first">
          {list.map((a) => {
            const d = delegates.get(a.delegateId)!;
            const deduction = a.points < 0;
            return (
              <li key={a.id} className="adjustment">
                <div className="adjustment-line">
                  <Chip tone={deduction ? "red" : "green"}>
                    {deduction ? "Deducted" : "Restored"} {Math.abs(a.points)}
                  </Chip>
                  <strong>{d.country}</strong>
                  <span className="muted">
                    by {a.chairName || "Chair"} · <time dateTime={a.createdAt}>{when(a.createdAt)}</time>
                  </span>
                  {deduction && restored.has(a.id) && <Chip tone="neutral">Restored later</Chip>}
                  {deduction && !restored.has(a.id) && (
                    <button onClick={() => void act({ type: "pointAdjustment", action: "restore", delegateId: a.delegateId, adjustmentId: a.id }, "chair")}>
                      Restore {Math.abs(a.points)} pts
                    </button>
                  )}
                </div>
                <p className="adjustment-reason">{a.reason}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No adjustments. Deductions appear here with their reason.</p>
      )}
    </Panel>
  );
}
