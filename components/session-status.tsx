"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConference } from "@/lib/context";
import { displayedResolution } from "@/lib/sessions/display";
import { rollCallAt } from "@/lib/sessions/presence";
import { zonedTime } from "@/lib/operations/time";

/** The session the schedule gives this committee now (docs/SESSION_MODEL.md section 7), re-read every 30 seconds. Display only. */
export function useCommitteeSession(committeeId: string) {
  const { data } = useConference();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const resolution = committeeId ? displayedResolution(data, committeeId, new Date(now).toISOString()) : null;
  const session = resolution?.sessionId ? data.sessions.find((s) => s.id === resolution.sessionId) : undefined;
  return { resolution, session, now };
}

/** Read-only: Chairs never choose a session. "GA1 · Session 6 · until 14:40", "No session", or "Schedule not published". */
export function SessionLabel({ committeeId }: { committeeId: string }) {
  const { resolution, session } = useCommitteeSession(committeeId);
  if (!resolution) return <span>Schedule not published</span>;
  const next = resolution.nextSwitchAt ? zonedTime(resolution.nextSwitchAt) : null;
  if (session) return <span>{session.name}{next ? ` · until ${next}` : ""}</span>;
  return <span>No session{next ? ` · next at ${next}` : ""}</span>;
}

/** Prompt a roll call when the schedule has moved this committee into a session that has none yet (section 6, owner decision 8). */
export function RollCallPrompt({ committeeId }: { committeeId: string }) {
  const { data } = useConference();
  const { resolution, session } = useCommitteeSession(committeeId);
  if (!session || !resolution?.windowStart) return null;
  const live = rollCallAt(data, committeeId);
  if (live && live.effectiveAt >= resolution.windowStart) return null;
  return (
    <div className="callout small" role="status">
      <div>
        <strong>{session.name} has started</strong>
        <p>Take a roll call for this session. You can copy the last one and change only what differs. <Link href="/chair/roll-call">Open roll call</Link></p>
      </div>
    </div>
  );
}
