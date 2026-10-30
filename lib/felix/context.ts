import type { ConferenceData, Delegate, Resolution, Role } from "../domain";
import type { Amendment } from "../batch/types";
import type { Health } from "../sync/repository";
import { committeePhotoReminders, type PhotoStage } from "../operations/photo-reminders";
import { sentBack } from "../resolution-view";
import { resolutionIdentities, resolutionLabel } from "../resolution-identity";
import { displayedResolution } from "../sessions/display";
import { before, isLive, rollCallAt } from "../sessions/presence";

/** A group photo that needs the Chair's attention right now (already derived by the Chair's photo banner rules). */
export type FelixPhoto = { slotId: string; revision: number; stage: PhotoStage; school: string; location: string; minutesUntil: number; delegates: number };

/** What Felix knows: only state the workspace has already loaded for this role (no extra reads, polling or requests). */
export type FelixContext = {
  role: Role;
  documents: Resolution[];
  /**
   * The delegates this role's snapshot already holds, for naming a resolution by its Main Submitter (`GA1/01 — France`).
   * A Chair's list is their committee only; Approval and Logistics snapshots may hold none, which reads
   * "Main submitter unavailable". Optional so a context without it still names resolutions by code.
   */
  delegates?: Pick<Delegate, "id" | "committeeId" | "country">[];
  amendments: Amendment[];
  /** The same health store the sync strip and System health read. */
  health?: Pick<Health, "mode" | "state" | "pending" | "conflicts" | "latency">;
  chair?: {
    committeeId: string;
    committeeCode?: string;
    /** The session the published schedule gives the committee now (display only: Chairs never choose a session). */
    sessionId?: string;
    sessionName?: string;
    /** The Executive has published a schedule for this committee. */
    schedulePublished: boolean;
    /** Delegates in this committee. */
    delegates: number;
    /** Delegations in the live roll call (0: no roll call yet) and how many of them are present. */
    marked: number;
    present: number;
    /** No roll call is live, or the live one was taken before the current session began. */
    rollCallDue: boolean;
    /** A speech (or its POIs) currently holds the floor. */
    speaking: boolean;
    queued: number;
    /** Identity of the resolution in debate, `GA1/01 — France`. */
    inDebate?: string;
    /** Delegate QR submissions (Draft with a submitted Google Doc) waiting for the Chair. `label` is the resolution identity. */
    submissions: { id: string; label: string; accessProblem: boolean }[];
    /** Drafts the Approval Panel sent back with "Changes requested". */
    changesRequested: { id: string; label: string }[];
    /** Passed amendments for the resolution in debate: the working Google Doc must be edited by hand. */
    passedToApply: { id: string; label: string }[];
    photos: FelixPhoto[];
  };
};

/** A resolution named for Felix's reminders and answers: its identity from the delegates in this context. */
export const felixResolutionLabel = (ctx: Pick<FelixContext, "delegates">, resolution: Pick<Resolution, "code" | "submitterId" | "committeeId" | "submitterCountry">) => resolutionLabel(resolution, ctx.delegates ?? []);

/**
 * Builds Felix's context from the conference data already in memory. Chairs only see their own committee; other
 * roles see conference documents exactly as their workspace already does. `now` drives the photo reminder stages.
 */
export function felixContext(data: ConferenceData, role: Role, committeeId?: string, now = Date.now()): FelixContext {
  if (role !== "chair") return { role, documents: data.documents, delegates: data.delegates, amendments: data.amendments ?? [] };
  const id = committeeId ?? "";
  const committee = data.committees.find(c => c.id === id);
  // Sessions follow the published schedule (docs/SESSION_MODEL.md section 7); presence is the live roll call (section 6).
  const schedule = id ? displayedResolution(data, id, new Date(now).toISOString()) : null;
  const session = schedule?.sessionId ? data.sessions.find(s => s.id === schedule.sessionId) : undefined;
  const delegates = data.delegates.filter(d => d.committeeId === id);
  const live = rollCallAt(data, id);
  const marks = live ? live.rows.filter(r => delegates.some(d => d.id === r.delegateId)) : [];
  const documents = data.documents.filter(d => d.committeeId === id);
  const amendments = (data.amendments ?? []).filter(a => a.committeeId === id);
  const links = data.resolutionLinks ?? [];
  const inDebate = documents.find(d => d.status === "In Debate");
  const labelOf = resolutionIdentities(delegates);
  const submissions = documents
    .filter(d => d.status === "Draft" && !sentBack(d) && !!links.find(l => l.documentId === d.id)?.submittedAt)
    .map(d => ({ id: d.id, label: labelOf(d).text, accessProblem: links.find(l => l.documentId === d.id)?.access === "problem" }));
  return {
    role,
    documents,
    delegates,
    amendments,
    chair: {
      committeeId: id,
      committeeCode: committee?.code,
      sessionId: session?.id,
      sessionName: session?.name,
      schedulePublished: !!schedule,
      delegates: delegates.length,
      marked: marks.length,
      present: marks.filter(a => a.status !== "Absent").length,
      rollCallDue: !live || (!!session && !!schedule?.windowStart && before(live.effectiveAt, schedule.windowStart)),
      speaking: (data.speeches ?? []).some(s => isLive(s, id) && s.state !== "finished"),
      queued: data.queue.filter(q => isLive(q, id)).length,
      inDebate: inDebate && labelOf(inDebate).text,
      submissions,
      changesRequested: documents.filter(d => sentBack(d)).map(d => ({ id: d.id, label: labelOf(d).text })),
      passedToApply: inDebate ? amendments.filter(a => a.resolutionId === inDebate.id && a.outcome === "Passed").map(a => ({ id: a.id, label: `${a.type} ${a.clause}` })) : [],
      photos: id ? committeePhotoReminders(data, id, now).filter(r => r.attention).map(r => ({
        slotId: r.slot.id, revision: r.slot.revision, stage: r.stage, school: r.school?.name ?? "A school", location: r.slot.location, minutesUntil: r.minutesUntil, delegates: r.delegates.length,
      })) : [],
    },
  };
}
