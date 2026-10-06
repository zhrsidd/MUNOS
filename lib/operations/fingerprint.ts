import type { ConferenceData } from "../domain";
import type { OperationsCommand } from "./commands";

/** Must match the locked comparison in private.apply_operations_mutation. */
export function operationsFingerprint(data: ConferenceData, command: OperationsCommand): string | null {
  switch (command.type) {
    case "resolutionLink":
      return String(data.resolutionLinks?.find(link => link.documentId === command.documentId)?.revision ?? 0);
    case "photoSlot":
      return command.action === "update" ? String(data.photoSlots?.find(slot => slot.id === command.slotId)?.revision ?? 0) : null;
    case "submissionLink": {
      const link = data.submissionLinks?.find(item => item.committeeId === command.committeeId);
      return link ? `${link.id}|${link.shareWith}` : "none";
    }
    default:
      return null;
  }
}
