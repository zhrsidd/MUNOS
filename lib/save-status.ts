import type { Health } from "./sync/repository";
import type { StaffAccess } from "./access";

export type SaveTone = "ok" | "working" | "attention" | "problem";
export interface SaveStatusInfo {
  label: string;
  tone: SaveTone;
  /** True when the person should open System health. */
  details: boolean;
}
export interface SaveStatusInput {
  health: Pick<Health, "mode" | "state" | "pending" | "conflicts" | "awaitingConfirmation">;
  online: boolean;
  access: StaffAccess["status"];
}
const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

/**
 * One state language for every workspace (docs/BRAND.md §7). The wording claims only what the client can prove:
 * "Saved on this device" is a durable local write, never "synced"; a connectivity failure is never a permission denial.
 */
export function saveStatus({ health, online, access }: SaveStatusInput): SaveStatusInfo {
  if (health.state === "error") return { label: "This device cannot save changes · open details", tone: "problem", details: true };
  if (health.conflicts > 0) return { label: "Review needed · open details", tone: "attention", details: true };
  if (access === "unavailable") return { label: "Could not verify access · saved work retained", tone: "attention", details: true };
  if (!online) return { label: health.pending ? `Offline · ${changes(health.pending)} saved on this device` : "Offline", tone: "attention", details: false };
  if (health.mode === "local") return { label: "Demo · saved in this browser", tone: "working", details: false };
  if ((health.awaitingConfirmation ?? 0) > 0) return { label: "Sent · updating this view", tone: "working", details: false };
  if (health.pending > 0) return { label: health.state === "saved" ? "Saved on this device" : `Waiting to send · ${changes(health.pending)}`, tone: "working", details: false };
  return { label: "All changes synced", tone: "ok", details: false };
}
