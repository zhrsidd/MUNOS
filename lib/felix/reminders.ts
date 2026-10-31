import type { Role } from "../domain";
import { felixResolutionLabel, type FelixContext } from "./context";

export type ReminderPriority = "urgent" | "action" | "info";
export type Reminder = {
  /** Stable identity: the same situation always produces the same key, so it is announced only once. */
  key: string;
  /** The situation family ("approval:submitted"). A newer reminder of the same kind supersedes an unread older one. */
  kind: string;
  priority: ReminderPriority;
  text: string;
  /** Popup wording: at most 12 words (docs/BRAND.md, toasts and notices). */
  short: string;
  href: string;
  linkLabel: string;
};

const ORDER: Record<ReminderPriority, number> = { urgent: 0, action: 1, info: 2 };
/** Above this many items of one kind, Felix summarises instead of listing each one. */
export const LIST_LIMIT = 3;
/** Longest popup message, in words. */
export const SHORT_WORDS = 12;

const listed = (labels: string[]) => {
  const shown = labels.slice(0, LIST_LIMIT);
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0] ?? "";
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One reminder per situation, grouping same-kind items and summarising large backlogs. */
function group(kind: string, priority: ReminderPriority, items: { id: string; label: string }[], text: (count: number, labels: string) => string, short: (count: number) => string, href: string, linkLabel: string): Reminder[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return [{ key: `${kind}:${sorted.map(item => item.id).join(",")}`, kind, priority, text: text(items.length, listed(sorted.map(item => item.label))), short: short(items.length), href, linkLabel }];
}

/**
 * Workflow reminders from state the workspace has already loaded. Only the current role's own work appears, and for
 * Chairs only their committee (the workspace passes committee-scoped context). Sorted urgent → action → info.
 * Every href is a workspace route of that role; answer.ts checks it again before showing a link.
 */
export function buildReminders(ctx: FelixContext): Reminder[] {
  const out: Reminder[] = [];
  const health = ctx.health;
  const healthHref = `/${ctx.role}/health`;
  if (health?.conflicts) out.push({ key: `sync:conflict:${health.conflicts}`, kind: "sync:conflict", priority: "urgent", text: `${plural(health.conflicts, "saved change needs", "saved changes need")} review: another device changed the same item first. Open System health and review it before continuing. Felix never retries or discards anything for you.`, short: "A saved change needs review. Open System health.", href: healthHref, linkLabel: "Open System health" });
  else if (health?.state === "error") out.push({ key: "sync:error", kind: "sync:error", priority: "urgent", text: "This device cannot save changes right now. Open System health to see why before recording anything else.", short: "This device cannot save changes. Open System health.", href: healthHref, linkLabel: "Open System health" });
  if (health?.pending && health.state !== "error" && !health.conflicts && health.mode !== "local") out.push({ key: "sync:pending", kind: "sync:pending", priority: "info", text: `${plural(health.pending, "change is", "changes are")} saved on this device and not yet synced. Keep this device and browser open; they send automatically, in order, when the connection allows.`, short: "Changes saved on this device, waiting to sync.", href: healthHref, linkLabel: "Open System health" });

  // Resolutions are named by their identity (`GA1/01 — France`), never by title.
  const docs = ctx.documents.map(d => ({ id: d.id, label: felixResolutionLabel(ctx, d), status: d.status }));
  const byStatus = (...statuses: string[]) => docs.filter(d => statuses.includes(d.status));
  const amendments = ctx.amendments;
  const labelOf = (resolutionId: string) => docs.find(d => d.id === resolutionId)?.label ?? "a resolution";

  if (ctx.role === "chair" && ctx.chair) {
    const c = ctx.chair;
    for (const photo of c.photos) {
      const due = photo.stage === "due", cancelled = photo.stage === "cancelled";
      out.push({
        key: `photo:${photo.slotId}:${photo.revision}:${photo.stage}`, kind: `photo:${photo.slotId}`, priority: cancelled ? "info" : due ? "urgent" : "action",
        text: cancelled ? `The ${photo.school} group photo at ${photo.location} is cancelled. Delegates do not need to leave.`
          : due ? `${photo.school} group photo is now at ${photo.location}: send ${plural(photo.delegates, "delegate", "delegates")} from this committee, then press “Delegates sent” on the banner.`
          : `${photo.school} group photo in ${plural(Math.max(1, photo.minutesUntil), "minute", "minutes")} at ${photo.location} (${plural(photo.delegates, "delegate", "delegates")} from this committee). Use “Acknowledge” on the banner.`,
        short: cancelled ? `${photo.school} group photo cancelled.` : due ? `${photo.school} group photo now: send delegates.` : `${photo.school} group photo in ${plural(Math.max(1, photo.minutesUntil), "minute", "minutes")}.`,
        href: "/chair/photos", linkLabel: "Open Group photos",
      });
    }
    // Chairs never choose a session: the Executive's published schedule decides (docs/SESSION_MODEL.md). Presence is the live roll call.
    if (c.delegates > 0 && c.rollCallDue) out.push(c.sessionName
      ? { key: `chair:rollcall:${c.sessionId}`, kind: "chair:rollcall", priority: "action", text: `${c.sessionName} has started. Take a roll call so the speaker queue and voting know who is present: copy the last one and change only what differs, then commit it.`, short: `Take a roll call for ${c.sessionName}.`, href: "/chair/roll-call", linkLabel: "Open Roll call" }
      : { key: `chair:rollcall:${c.committeeId}`, kind: "chair:rollcall", priority: "action", text: c.marked === 0 ? "No roll call has been committed yet, so nobody counts as present. Take one before debate." : "Take a roll call before debate so the speaker queue and voting know who is present.", short: "Take a roll call.", href: "/chair/roll-call", linkLabel: "Open Roll call" });
    if (!c.schedulePublished && c.committeeId) out.push({ key: `chair:no-schedule:${c.committeeId}`, kind: "chair:no-schedule", priority: "info", text: "The Executive has not published your committee’s schedule yet, so no session name shows. Roll call, debate and voting work as normal; records are labelled once a schedule exists.", short: "Schedule not published yet.", href: "/chair", linkLabel: "Open Debate" });
    out.push(...group("chair:changes", "action", c.changesRequested, (n, t) => `The Approval Panel requested changes on ${t}. Read the feedback on Resolutions, edit the Google Doc, then use “Resubmit after editing →”.`, n => `Changes requested on ${plural(n, "resolution", "resolutions")}.`, "/chair/documents", "Open Resolutions"));
    out.push(...group("chair:access", "action", c.submissions.filter(s => s.accessProblem), (n, t) => `${plural(n, "submission is", "submissions are")} marked “Can’t access”: ${t}. Ask the delegation to set Share → General access → Anyone with the link → Editor (or share with a Chair as Editor), then press “Access fixed”.`, n => `${plural(n, "submitted Google Doc", "submitted Google Docs")} can’t be opened.`, "/chair/documents", "Open Resolutions"));
    out.push(...group("chair:submissions", "action", c.submissions.filter(s => !s.accessProblem), (n, t) => `${plural(n, "delegate submission is", "delegate submissions are")} waiting for you: ${t}. Open the Google Doc, review it, then “Submit to Approval”.`, n => `${plural(n, "delegate submission", "delegate submissions")} waiting for you.`, "/chair/documents", "Open Resolutions"));
    out.push(...group("chair:amend-submitted", "action", amendments.filter(a => a.status === "Submitted").map(a => ({ id: a.id, label: `${a.type} ${a.clause} on ${labelOf(a.resolutionId)}` })), (n, t) => `${plural(n, "amendment is", "amendments are")} waiting for your review: ${t}.`, n => `${plural(n, "amendment", "amendments")} waiting for your review.`, "/chair/amendments", "Open Amendments"));
    out.push(...group("chair:amend-apply", "action", c.passedToApply, (n, t) => `${plural(n, "passed amendment", "passed amendments")} (${t}) must be applied to the working Google Doc by hand: MUNOS records the outcome only.`, () => "Apply passed amendments to the working Google Doc.", "/chair/amendments", "Open Amendments"));
    const drafts = byStatus("Draft").filter(d => !c.submissions.some(s => s.id === d.id) && !c.changesRequested.some(s => s.id === d.id));
    out.push(...group("chair:draft", "action", drafts, (n, t) => `${plural(n, "resolution is", "resolutions are")} still in Draft: ${t}. Use “Submit for review” on Resolutions when ready.`, n => `${plural(n, "draft resolution", "draft resolutions")} not yet submitted.`, "/chair/documents", "Open Resolutions"));
    out.push(...group("chair:printed", "action", byStatus("Printed"), (n, t) => `${plural(n, "resolution is", "resolutions are")} printed and ready to open for debate: ${t}.`, n => `${plural(n, "printed resolution", "printed resolutions")} ready for debate.`, "/chair/documents", "Open Resolutions"));
    out.push(...group("chair:amend-debate", "info", amendments.filter(a => a.status === "In Debate").map(a => ({ id: a.id, label: `${a.type} ${a.clause}` })), (_n, t) => `Amendment debate is open (${t}). Record its outcome on the Debate page when the floor is with the Chair.`, () => "Amendment debate is open.", "/chair", "Open Debate"));
    out.push(...group("chair:debate", "info", byStatus("In Debate"), (_n, t) => `${t} is in debate. When debate ends, use “Go to voting”.`, () => "A resolution is in debate.", "/chair", "Open Debate"));
    out.push(...group("chair:accepted", "info", amendments.filter(a => a.status === "Accepted for Debate").map(a => ({ id: a.id, label: `${a.type} ${a.clause}` })), (n, t) => `${plural(n, "amendment is", "amendments are")} accepted and waiting for debate: ${t}.`, n => `${plural(n, "amendment", "amendments")} accepted for debate.`, "/chair/amendments", "Open Amendments"));
    out.push(...group("chair:with-approval", "info", byStatus("Submitted", "Review"), (n, t) => `${plural(n, "resolution is", "resolutions are")} with the Approval Panel: ${t}.`, n => `${plural(n, "resolution", "resolutions")} with the Approval Panel.`, "/chair/documents", "Open Resolutions"));
    out.push(...group("chair:approved", "info", byStatus("Approved"), (n, t) => `${plural(n, "resolution is", "resolutions are")} approved and waiting for printing: ${t}.`, n => `${plural(n, "resolution", "resolutions")} waiting for printing.`, "/chair/documents", "Open Resolutions"));
  } else if (ctx.role === "approval") {
    out.push(...group("approval:submitted", "action", byStatus("Submitted"), (n, t) => `${plural(n, "resolution is", "resolutions are")} waiting for you to start review: ${t}.`, n => `${plural(n, "new submission", "new submissions")} in your Review inbox.`, "/approval", "Open Review inbox"));
    out.push(...group("approval:review", "action", byStatus("Review"), (n, t) => `${plural(n, "resolution is", "resolutions are")} in review and need a decision: ${t}. Approve, or request changes with a comment for the Chair.`, n => `${plural(n, "resolution needs", "resolutions need")} your decision.`, "/approval", "Open Review inbox"));
    out.push(...group("approval:approved", "info", byStatus("Approved"), (n, t) => `${plural(n, "approved resolution is", "approved resolutions are")} now in the print queue: ${t}.`, n => `${plural(n, "approved resolution", "approved resolutions")} in the print queue.`, "/approval/history", "Open History"));
  } else if (ctx.role === "logistics") {
    const queue = ctx.documents.filter(d => d.status === "Approved");
    const copies = queue.reduce((n, d) => n + d.copies, 0);
    out.push(...group("logistics:print", "action", byStatus("Approved"), (n, t) => `${plural(n, "approved resolution is", "approved resolutions are")} waiting in the print queue (${plural(copies, "copy", "copies")} in total): ${t}. Print the copies shown on each job, then press “✓ Mark printed”.`, n => `${plural(n, "print job", "print jobs")} waiting in the print queue.`, "/logistics", "Open Print queue"));
  } else if (ctx.role === "admin") {
    const review = byStatus("Submitted", "Review"), printing = byStatus("Approved"), submittedAmendments = amendments.filter(a => a.status === "Submitted");
    if (review.length) out.push({ key: `admin:review:${review.map(d => d.id).sort().join(",")}`, kind: "admin:review", priority: "info", text: `${plural(review.length, "resolution is", "resolutions are")} with the Approval Panel.`, short: `${plural(review.length, "resolution", "resolutions")} with the Approval Panel.`, href: "/admin/resolution-status", linkLabel: "Open Resolution status" });
    if (printing.length) out.push({ key: `admin:print:${printing.map(d => d.id).sort().join(",")}`, kind: "admin:print", priority: "info", text: `${plural(printing.length, "approved resolution is", "approved resolutions are")} waiting for Admins to print.`, short: `${plural(printing.length, "resolution", "resolutions")} waiting to print.`, href: "/admin/resolution-status", linkLabel: "Open Resolution status" });
    if (submittedAmendments.length) out.push({ key: `admin:amend:${submittedAmendments.map(a => a.id).sort().join(",")}`, kind: "admin:amend", priority: "info", text: `${plural(submittedAmendments.length, "submitted amendment is", "submitted amendments are")} waiting for a Chair to review.`, short: `${plural(submittedAmendments.length, "amendment", "amendments")} waiting for Chairs.`, href: "/admin/resolution-status", linkLabel: "Open Resolution status" });
  }
  const seen = new Set<string>();
  return out.filter(item => !seen.has(item.key) && seen.add(item.key)).sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
}

/** A reminder message: urgent and action items first, information after, never more than `max` items. */
export function formatReminders(role: Role, reminders: Reminder[], max = 5): string {
  const urgent = reminders.filter(r => r.priority !== "info"), info = reminders.filter(r => r.priority === "info");
  const lines: string[] = [];
  if (urgent.length) lines.push(`Needs action: ${urgent.slice(0, max).map((r, i) => `${i + 1}. ${r.text}`).join(" ")}`);
  const room = Math.max(0, max - Math.min(urgent.length, max));
  if (info.length && room) lines.push(`${urgent.length ? "For information" : "Nothing needs action right now. For information"}: ${info.slice(0, room).map(r => r.text).join(" ")}`);
  const hidden = reminders.length - Math.min(urgent.length, max) - Math.min(info.length, room);
  if (hidden > 0) lines.push(`(+${hidden} more on your ${role === "admin" ? "Resolution status" : "workspace"} page.)`);
  return lines.join(" ");
}
