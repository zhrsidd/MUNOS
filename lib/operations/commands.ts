import type { ConferenceData, Role } from "../domain";
import { GOOGLE_DOC_ID } from "../submissions/google-doc";
import { advancePhotoEpochs, photoEpoch, syncPhotoChairs } from "./photo-reminders";
// Extension commands travel through the same durable outbox as core commands, but are
// applied server-side by public.apply_operations_mutation (see the operations migrations).
export type OperationsCommand =
  | {
      type: "submissionLink";
      action: "create" | "rotate" | "revoke" | "shareWith";
      committeeId: string;
      token?: string;
      shareWith?: string;
    }
  | {
      type: "resolutionLink";
      documentId: string;
      action: "access" | "approvalCopy" | "workingDoc";
      access?: "unchecked" | "ok" | "problem";
      /** Google Doc id (never a raw URL); null clears the approval copy. */
      docId?: string | null;
    }
  | {
      type: "sessionImport";
      rows: { committeeId: string; name: string; startsAt: string; endsAt: string | null }[];
    }
  | ({ type: "photoSlot"; action: "create" | "update"; slotId?: string } & PhotoSlotFields)
  | { type: "photoImport"; rows: PhotoSlotFields[] }
  /** `epoch` and `chairs` are the participant-list epoch and Chair list the Chair saw; absent means 0 and none. */
  | { type: "photoAck"; committeeId: string; slotId: string; stage: "warning" | "due"; revision: number; epoch?: number; chairs?: string }
  /** A Chair's school for group photos; null clears it. */
  | { type: "staffSchool"; staffId: string; schoolId: string | null }
  | { type: "pointAdjustment"; action: "deduct"; delegateId: string; sessionId: string; amount: number; reason: string }
  | { type: "pointAdjustment"; action: "restore"; delegateId: string; adjustmentId: string; reason?: string };
export interface PhotoSlotFields {
  schoolId: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  note: string;
  enabled?: boolean;
  warnMinutes?: number;
}
export const operationsCommandTypes = ["submissionLink", "resolutionLink", "sessionImport", "photoSlot", "photoImport", "photoAck", "pointAdjustment", "staffSchool"] as const satisfies readonly OperationsCommand["type"][];
export const operationsRoles: Record<OperationsCommand["type"], Role[]> = {
  submissionLink: ["admin"],
  resolutionLink: ["chair", "admin"],
  sessionImport: ["admin"],
  photoSlot: ["admin"],
  photoImport: ["admin"],
  photoAck: ["chair"],
  pointAdjustment: ["chair"],
  staffSchool: ["admin"],
};
export const MAX_DEDUCTION = 20;
export const REASON_MIN = 3;
export const REASON_MAX = 300;
/** Mirrors private.ops_point_adjustment. */
export function deductionProblem(amount: unknown, reason: unknown): string | null {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_DEDUCTION) return `Enter a whole number of points from 1 to ${MAX_DEDUCTION}.`;
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < REASON_MIN || text.length > REASON_MAX) return `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`;
  return null;
}
function checkSlot(d: ConferenceData, f: PhotoSlotFields) {
  if (!d.schools.some((s) => s.id === f.schoolId)) throw Error("Choose a valid school.");
  if (Number.isNaN(Date.parse(f.startsAt))) throw Error("Enter a valid photo time.");
  if (f.endsAt && Date.parse(f.endsAt) <= Date.parse(f.startsAt)) throw Error("The photo ends before it starts.");
  const location = f.location.trim();
  if (!location || location.length > 120) throw Error("Enter a location.");
  if (f.note.length > 300) throw Error("The note is too long.");
  const warn = f.warnMinutes ?? 10;
  if (!Number.isInteger(warn) || warn < 1 || warn > 60) throw Error("Warning time must be 1 to 60 minutes.");
  return { schoolId: f.schoolId, startsAt: new Date(f.startsAt).toISOString(), endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null, location, note: f.note, enabled: f.enabled ?? true, warnMinutes: warn };
}
export function isOperationsCommand(c: { type: string }): c is OperationsCommand {
  return (operationsCommandTypes as readonly string[]).includes(c.type);
}
const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
/** 128-bit random, URL-safe. Local demo tokens (demo_<committeeId>_<hex>) let the demo server resolve the committee. */
export function newSubmissionToken(committeeId: string, demo = false) {
  if (demo) {
    const hex = [...crypto.getRandomValues(new Uint8Array(11))].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `demo_${committeeId.replaceAll("_", "")}_${hex}`.slice(0, 64);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function applyOperationsCommand(
  d: ConferenceData,
  c: OperationsCommand,
  nextId: () => string,
  now: string,
  actorId = "chair-demo",
) {
  switch (c.type) {
    case "submissionLink": {
      if (!d.committees.some((x) => x.id === c.committeeId)) throw Error("Choose a valid committee.");
      if ((c.shareWith ?? "").length > 200) throw Error("The sharing address is too long.");
      if (c.action === "shareWith") {
        const active = d.submissionLinks?.find((l) => l.committeeId === c.committeeId);
        if (!active) throw Error("Create the submission link first.");
        active.shareWith = c.shareWith ?? "";
        break;
      }
      if (c.action !== "revoke" && !TOKEN.test(c.token ?? "")) throw Error("Invalid submission link.");
      const links = (d.submissionLinks ?? []).filter((l) => l.committeeId !== c.committeeId);
      if (c.action !== "revoke")
        links.push({ id: nextId(), committeeId: c.committeeId, token: c.token!, shareWith: c.shareWith ?? "", createdAt: now });
      d.submissionLinks = links;
      break;
    }
    case "resolutionLink": {
      if (!d.documents.some((r) => r.id === c.documentId)) throw Error("Resolution not found.");
      const links = (d.resolutionLinks ??= []);
      let link = links.find((l) => l.documentId === c.documentId);
      if (!link) {
        link = { documentId: c.documentId, workingDocId: null, approvalCopyDocId: null, access: "unchecked", submittedAt: null, revision: 0 };
        links.push(link);
      }
      if (c.action === "access") {
        if (!["unchecked", "ok", "problem"].includes(c.access ?? "")) throw Error("Unknown access state.");
        link.access = c.access!;
      } else {
        const id = c.docId ?? null;
        if (id !== null && !GOOGLE_DOC_ID.test(id)) throw Error("Invalid Google Doc.");
        if (c.action === "approvalCopy") link.approvalCopyDocId = id;
        else {
          if (!id) throw Error("A Google Doc is required.");
          link.workingDocId = id;
          link.access = "unchecked";
        }
      }
      link.revision++;
      break;
    }
    case "sessionImport": {
      if (!c.rows.length || c.rows.length > 500) throw Error("Import between 1 and 500 sessions at a time.");
      for (const row of c.rows) {
        // Every row consumes an id, created or not, so ids match the database's derivation.
        const id = nextId();
        if (!d.committees.some((x) => x.id === row.committeeId)) throw Error("Choose a valid committee.");
        const name = row.name.trim();
        if (!name || name.length > 120 || Number.isNaN(Date.parse(row.startsAt))) throw Error("Each session needs a name and start time.");
        if (row.endsAt && Date.parse(row.endsAt) <= Date.parse(row.startsAt)) throw Error("A session ends before it starts.");
        if (d.sessions.some((s) => s.committeeId === row.committeeId && Date.parse(s.startsAt) === Date.parse(row.startsAt))) continue;
        d.sessions.push({ id, committeeId: row.committeeId, name, startsAt: new Date(row.startsAt).toISOString(), endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null, state: "scheduled" });
      }
      break;
    }
    case "photoSlot": {
      const fields = checkSlot(d, c);
      const slots = (d.photoSlots ??= []);
      if (c.action === "create") slots.push({ id: nextId(), ...fields, revision: 1 });
      else {
        const slot = slots.find((s) => s.id === c.slotId);
        if (!slot) throw Error("Photo slot not found.");
        Object.assign(slot, fields, { revision: slot.revision + 1 });
      }
      slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      break;
    }
    case "photoImport": {
      if (!c.rows.length || c.rows.length > 300) throw Error("Import between 1 and 300 photo slots at a time.");
      const slots = (d.photoSlots ??= []);
      for (const row of c.rows) {
        const id = nextId();
        const fields = checkSlot(d, row);
        if (slots.some((s) => s.schoolId === fields.schoolId && Date.parse(s.startsAt) === Date.parse(fields.startsAt))) continue;
        slots.push({ id, ...fields, enabled: true, revision: 1 });
      }
      slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      break;
    }
    case "pointAdjustment": {
      // One id, drawn first, like the server's derived id.
      const id = nextId();
      const delegate = d.delegates.find((x) => x.id === c.delegateId);
      if (!delegate) throw Error("Delegate unavailable.");
      const list = (d.pointAdjustments ??= []);
      if (c.action === "deduct") {
        const problem = deductionProblem(c.amount, c.reason);
        if (problem) throw Error(problem);
        const session = d.sessions.find((s) => s.id === c.sessionId);
        if (!session || session.committeeId !== delegate.committeeId) throw Error("Session unavailable.");
        list.push({ id, delegateId: delegate.id, sessionId: session.id, points: -c.amount, reason: c.reason.trim(), chairId: actorId, chairName: null, reverses: null, createdAt: now });
      } else {
        const original = list.find((a) => a.id === c.adjustmentId);
        if (!original) throw Error("Adjustment unavailable.");
        if (original.points >= 0 || original.delegateId !== delegate.id) throw Error("Only a deduction for this delegate can be restored.");
        if (list.some((a) => a.reverses === original.id)) throw Error("This deduction was already restored.");
        const reason = (c.reason ?? "").trim() || "Deduction restored";
        if (reason.length < REASON_MIN || reason.length > REASON_MAX) throw Error(`Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
        list.push({ id, delegateId: delegate.id, sessionId: original.sessionId, points: -original.points, reason, chairId: actorId, chairName: null, reverses: original.id, createdAt: now });
      }
      break;
    }
    case "staffSchool": {
      const staff = d.staff.find((s) => s.id === c.staffId);
      if (!staff || staff.role !== "chair") throw Error("Choose a Chair.");
      if (c.schoolId !== null && !d.schools.some((s) => s.id === c.schoolId)) throw Error("Choose a valid school.");
      // The Chair list of the old and new school changes in each of the Chair's committees: advance their epochs, as
      // the PostgreSQL trigger does, so no earlier acknowledgement can silence them again.
      if ((staff.schoolId ?? null) !== c.schoolId) advancePhotoEpochs(d, staff.committeeIds, [staff.schoolId, c.schoolId]);
      staff.schoolId = c.schoolId;
      // A hosted snapshot's photoChairs is preferred over staff, so keep its rows in step until the confirming read.
      syncPhotoChairs(d, staff);
      break;
    }
    case "photoAck": {
      const slot = d.photoSlots?.find((s) => s.id === c.slotId);
      if (!slot) throw Error("Photo slot not found.");
      const epoch = c.epoch ?? 0;
      const chairs = c.chairs ?? "";
      // Mirrors private.ops_photo_ack. An epoch the list has not reached yet cannot be genuine, so it is refused; an
      // older one is recorded as history and silences nothing (a stale acknowledgement queued before a list change).
      if (!Number.isInteger(epoch) || epoch < 0 || (c.revision === slot.revision && epoch > photoEpoch(d, c.committeeId, slot.schoolId))) throw Error("Unknown list version.");
      const acks = (d.photoAcks ??= []);
      if (!acks.some((a) => a.slotId === c.slotId && a.committeeId === c.committeeId && a.stage === c.stage && a.revision === c.revision && (a.epoch ?? 0) === epoch && (a.chairs ?? "") === chairs))
        acks.push({ slotId: c.slotId, committeeId: c.committeeId, stage: c.stage, revision: c.revision, epoch, chairs, at: now });
      break;
    }
  }
}
