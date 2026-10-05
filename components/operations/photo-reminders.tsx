"use client";
import { useEffect, useState } from "react";
import { useConference } from "@/lib/context";
import { committeePhotoReminders, type PhotoReminder } from "@/lib/operations/photo-reminders";
import { zonedDay, zonedTime } from "@/lib/operations/time";
import { Chip, Empty, PageHeading, Panel } from "../ui";

/** Local clock only: re-evaluates reminders without any network request. */
export function useClock(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
  return now;
}
const when = (r: PhotoReminder) => `${zonedTime(r.slot.startsAt)}${r.slot.endsAt ? `–${zonedTime(r.slot.endsAt)}` : ""}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function DelegateList({ reminder, sessionId }: { reminder: PhotoReminder; sessionId: string }) {
  const { data } = useConference();
  return (
    <ul className="photo-delegates">
      {reminder.delegates.map((d) => {
        const absent = data.attendance.some((a) => a.delegateId === d.id && a.sessionId === sessionId && a.status === "Absent");
        return (
          <li key={d.id}>
            {d.flag} <b>{d.country}</b> — {d.name}
            {absent && <span className="muted"> (marked absent this session)</span>}
          </li>
        );
      })}
    </ul>
  );
}
function ReminderCard({ reminder, committeeId, sessionId }: { reminder: PhotoReminder; committeeId: string; sessionId: string }) {
  const { act } = useConference();
  const [open, setOpen] = useState(reminder.stage === "due");
  const { slot, school, delegates, stage } = reminder;
  const acknowledge = (s: "warning" | "due") => act({ type: "photoAck", committeeId, slotId: slot.id, stage: s, revision: slot.revision }, "chair");
  if (stage === "cancelled")
    return (
      <div className="photo-card cancelled" role="status">
        <div>
          <small>GROUP PHOTO CANCELLED</small>
          <strong>{school?.name}</strong>
          <p>
            {when(reminder)} · {slot.location}. Delegates do not need to leave.
          </p>
        </div>
        <button onClick={() => void acknowledge("warning")}>Dismiss</button>
      </div>
    );
  const due = stage === "due";
  return (
    <div className={`photo-card ${due ? "due" : "warning"}`} role="alert">
      <div>
        <small>{due ? "GROUP PHOTO NOW" : `GROUP PHOTO IN ${plural(Math.max(1, reminder.minutesUntil), "MINUTE").toUpperCase()}`}</small>
        <strong>{school?.name}</strong>
        <p>
          {when(reminder)} · {slot.location}
          {slot.note && <> · {slot.note}</>}
        </p>
        {due ? (
          <p>
            Please send {delegates.length === 1 ? "this delegate" : `these ${delegates.length} delegates`} to <b>{slot.location}</b>:
          </p>
        ) : (
          <p>{plural(delegates.length, "delegate")} from this committee should attend.</p>
        )}
        {open && <DelegateList reminder={reminder} sessionId={sessionId} />}
      </div>
      <div className="photo-actions">
        {!due && <button onClick={() => setOpen(!open)}>{open ? "Hide delegates" : "View delegates"}</button>}
        <button className="primary" onClick={() => void acknowledge(due ? "due" : "warning")}>
          {due ? "Delegates sent" : "Acknowledge"}
        </button>
      </div>
    </div>
  );
}
/** Shown on every Chair Console screen. Derived from slot times on this device; works offline and after refresh. */
export function PhotoReminderBanner({ committeeId, sessionId }: { committeeId: string; sessionId: string }) {
  const { data } = useConference();
  const now = useClock();
  const active = committeePhotoReminders(data, committeeId, now).filter((r) => r.attention);
  if (!active.length) return null;
  return (
    <div className="photo-banner">
      {active.map((r) => (
        <ReminderCard key={`${r.slot.id}-${r.slot.revision}-${r.stage}`} reminder={r} committeeId={committeeId} sessionId={sessionId} />
      ))}
    </div>
  );
}
const stageChip: Record<PhotoReminder["stage"], [string, string]> = {
  upcoming: ["Upcoming", "neutral"],
  warning: ["Starting soon", "review"],
  due: ["Now", "blue"],
  past: ["Done", "closed"],
  cancelled: ["Cancelled", "neutral"],
};
/** Chair Console → Group photos: this committee's photo slots across the conference. */
export function ChairPhotos({ committeeId }: { committeeId: string }) {
  const { data } = useConference();
  const now = useClock(30_000);
  const reminders = committeePhotoReminders(data, committeeId, now);
  const committee = data.committees.find((c) => c.id === committeeId);
  const days = [...new Set(reminders.map((r) => zonedDay(r.slot.startsAt)))];
  return (
    <>
      <PageHeading
        eyebrow={committee?.code ?? ""}
        title="Group photos"
        description="When delegates from this room must leave for their school's photo. A reminder appears here 10 minutes before, even after a refresh or a lost connection."
      />
      {!reminders.length ? (
        <Empty title="No group photos for this committee" text="None of this committee's schools has a photo slot yet." />
      ) : (
        days.map((day) => (
          <Panel key={day} title={day}>
            {reminders
              .filter((r) => zonedDay(r.slot.startsAt) === day)
              .map((r) => (
                <div className={`summary-row photo-row ${r.stage}`} key={r.slot.id}>
                  <div>
                    <strong>
                      {when(r)} · {r.school?.name}
                    </strong>
                    <p>
                      {r.slot.location}
                      {r.slot.note && ` · ${r.slot.note}`} · {r.delegates.map((d) => `${d.flag} ${d.country}`).join(", ")}
                    </p>
                  </div>
                  <span>
                    <Chip tone={stageChip[r.stage][1]}>{stageChip[r.stage][0]}</Chip>
                    {r.stage !== "cancelled" && r.acknowledged.due && <Chip tone="green">Sent</Chip>}
                  </span>
                </div>
              ))}
          </Panel>
        ))
      )}
      <p className="muted">Times are conference time.</p>
    </>
  );
}
