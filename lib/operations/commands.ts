import type { ConferenceData, Role } from "../domain";
import { GOOGLE_DOC_ID } from "../submissions/google-doc";
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
  | { type: "photoAck"; committeeId: string; slotId: string; stage: "warning" | "due"; revision: number };
export interface PhotoSlotFields {
  schoolId: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  note: string;
  enabled?: boolean;
  warnMinutes?: number;
}
export const operationsCommandTypes = ["submissionLink", "resolutionLink", "sessionImport", "photoSlot", "photoImport", "photoAck"] as const satisfies readonly OperationsCommand["type"][];
export const operationsRoles: Record<OperationsCommand["type"], Role[]> = {
  submissionLink: ["admin"],
  resolutionLink: ["chair", "admin"],
  sessionImport: ["admin"],
  photoSlot: ["admin"],
  photoImport: ["admin"],
  photoAck: ["chair"],
};
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
    case "photoAck": {
      if (!d.photoSlots?.some((s) => s.id === c.slotId)) throw Error("Photo slot not found.");
      const acks = (d.photoAcks ??= []);
      if (!acks.some((a) => a.slotId === c.slotId && a.committeeId === c.committeeId && a.stage === c.stage && a.revision === c.revision))
        acks.push({ slotId: c.slotId, committeeId: c.committeeId, stage: c.stage, revision: c.revision, at: now });
      break;
    }
  }
}
