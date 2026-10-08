import type { Health } from "../sync/repository";
import type { HealthReport } from "./health-probe";
// Turns technical signals into one GREEN / YELLOW / RED answer an operator can act on.
// Pure: every input is passed in, so it is unit-tested without a browser.
export type Level = "green" | "yellow" | "red";
export interface StatusItem { key: string; label: string; level: Level; text: string }
export interface SystemStatus { level: Level; headline: string; message: string; items: StatusItem[] }
export interface StatusInput {
  health: Health;
  online: boolean;
  /** True when this build expects the cloud database (NEXT_PUBLIC_DATA_BACKEND=supabase). */
  cloudExpected: boolean;
  /** Oldest unsynced change on this device, ISO time. */
  oldestPendingAt?: string;
  /** Latest /api/health report; null = not yet checked; "unreachable" = request failed. */
  server: HealthReport | null | "unreachable";
  clientCommit: string;
  now: number;
}
const STALE_MINUTES = 15;
const SLOW_MS = 3000;
const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 };
const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;
const reviewChanges = (n: number) => `${changes(n)} ${n === 1 ? "needs" : "need"} review`;
export function systemStatus(i: StatusInput): SystemStatus {
  const { health } = i;
  const items: StatusItem[] = [];
  const add = (key: string, label: string, level: Level, text: string) => items.push({ key, label, level, text });
  const demo = health.mode === "local";
  const report = i.server && i.server !== "unreachable" ? i.server : null;
  const staleMinutes = i.oldestPendingAt ? (i.now - Date.parse(i.oldestPendingAt)) / 60000 : 0;

  add("internet", "Internet", i.online ? "green" : "yellow", i.online ? "Connected" : "Unavailable on this device");

  if (demo && i.cloudExpected) add("database", "Conference database", "red", "Not connected. This device is not set up for the conference.");
  else if (demo) add("database", "Conference database", "yellow", "Local demo · not connected to a conference database");
  else if (health.state === "waiting" && !i.online) add("database", "Conference database", "yellow", "Waiting for internet");
  else if (health.state === "waiting") add("database", "Conference database", "yellow", "Unreachable · retrying automatically");
  else if (health.latency !== null && health.latency > SLOW_MS) add("database", "Conference database", "yellow", `Slow (${(health.latency / 1000).toFixed(1)} s)`);
  else add("database", "Conference database", "green", health.latency === null ? "Connected" : `Connected · ${health.latency} ms`);

  if (!demo) add("realtime", "Live updates", health.realtime ? "green" : "yellow", health.realtime ? "Connected" : "Unavailable · screens refresh every minute");

  const storage = report?.checks.storage.status;
  if (storage && storage !== "not_configured")
    add("storage", "Document storage", storage === "ok" ? "green" : "yellow", storage === "ok" ? "Available" : "Temporarily unavailable");

  if (health.state === "error") add("device", "This device", "red", "Recording is paused on this device. Check Technical details or renew device access.");
  else if (health.conflicts) add("device", "This device", "red", reviewChanges(health.conflicts));
  else if (health.pending && staleMinutes >= STALE_MINUTES) add("device", "This device", "red", `${changes(health.pending)} not synced for ${Math.floor(staleMinutes)} minutes`);
  else if (health.pending) add("device", "This device", "yellow", `${changes(health.pending)} saved here · will sync automatically`);
  else add("device", "This device", "green", "All changes synced");

  if (i.server === "unreachable") add("server", "Conference OS service", "yellow", i.online ? "Not responding · this screen keeps working" : "Not checked while offline");
  else if (report && report.app.commit && i.clientCommit && report.app.commit !== i.clientCommit)
    add("version", "Version", "yellow", "Server has a different version. Refresh once this device shows 0 unsynced changes.");

  const level = items.reduce<Level>((worst, item) => (rank[item.level] > rank[worst] ? item.level : worst), "green");
  return { level, items, ...summarize(i, items, level, demo) };
}
function summarize(i: StatusInput, items: StatusItem[], level: Level, demo: boolean): { headline: string; message: string } {
  const { health } = i;
  const has = (key: string, l: Level) => items.some(x => x.key === key && x.level === l);
  if (level === "green") return { headline: "All systems operational", message: "Changes are syncing and live updates are connected." };
  if (has("device", "red") && health.state === "error") return { headline: "This device cannot save changes", message: "Do not record anything on this device. Use another prepared device and tell the Executive." };
  if (has("database", "red")) return { headline: "Not connected to the conference", message: "Changes on this device are not shared with anyone. Tell the Executive; access needs to be set up for this device." };
  if (has("device", "red") && health.conflicts) return { headline: reviewChanges(health.conflicts), message: "Keep this device open and ask the Executive to review them in System health. Nothing has been lost." };
  if (has("device", "red")) return { headline: "Changes are waiting too long", message: `${changes(health.pending)} saved on this device have not synced for over 15 minutes. Keep this device open and tell the Executive.` };
  if (!i.online) return { headline: "Internet unavailable", message: health.pending ? `${changes(health.pending)} saved on this device and will sync automatically.` : "Committee operations can continue. Changes will be saved on this device and sync automatically." };
  if (demo) return { headline: "Demo mode", message: "This is an isolated demonstration. Nothing is sent to a conference database." };
  if (has("database", "yellow") && health.state === "waiting") return { headline: "Conference database unreachable", message: health.pending ? `${changes(health.pending)} saved on this device and will sync automatically.` : "Committee operations can continue on this device. Retrying automatically." };
  if (has("realtime", "yellow")) return { headline: "Live updates temporarily unavailable", message: "Committee operations can continue. Other screens refresh at least once a minute." };
  if (has("storage", "yellow")) return { headline: "Document storage is temporarily unavailable", message: "Resolution uploads and file opening may fail. Debate, attendance and voting are not affected." };
  if (has("database", "yellow")) return { headline: "Connection is slow", message: "Everything still works; saving may take a little longer." };
  if (has("device", "yellow")) return { headline: "Syncing changes", message: `${changes(health.pending)} saved on this device and will sync automatically.` };
  if (has("version", "yellow")) return { headline: "New version available", message: "Refresh this page when this device shows 0 unsynced changes." };
  return { headline: "Service check failed", message: "This screen keeps working. The check will retry automatically." };
}
