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
    };
export const operationsCommandTypes = ["submissionLink", "resolutionLink"] as const satisfies readonly OperationsCommand["type"][];
export const operationsRoles: Record<OperationsCommand["type"], Role[]> = {
  submissionLink: ["admin"],
  resolutionLink: ["chair", "admin"],
};
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
  }
}
