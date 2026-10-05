import type { ConferenceData, Role } from "../domain";
// Extension commands travel through the same durable outbox as core commands, but are
// applied server-side by public.apply_operations_mutation (see the operations migrations).
export type OperationsCommand = {
  type: "submissionLink";
  action: "create" | "rotate" | "revoke";
  committeeId: string;
  token?: string;
  contact?: string;
};
export const operationsCommandTypes = ["submissionLink"] as const satisfies readonly OperationsCommand["type"][];
export const operationsRoles: Record<OperationsCommand["type"], Role[]> = {
  submissionLink: ["admin"],
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
      if (c.action !== "revoke" && !TOKEN.test(c.token ?? "")) throw Error("Invalid submission link.");
      if ((c.contact ?? "").length > 200) throw Error("Contact is too long.");
      const links = (d.submissionLinks ?? []).filter((l) => l.committeeId !== c.committeeId);
      if (c.action !== "revoke")
        links.push({ id: nextId(), committeeId: c.committeeId, token: c.token!, contact: c.contact ?? "", createdAt: now });
      d.submissionLinks = links;
      break;
    }
  }
}
