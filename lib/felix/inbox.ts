import type { Role } from "../domain";
import { safeLink } from "./answer";
import type { Reminder, ReminderPriority } from "./reminders";

/**
 * Felix's Inbox: the reminders Felix has raised for this role (and committee), with honest read state. Pure
 * functions over a small list kept in this browser's localStorage. "Read" means the entry was shown to the person in
 * the open Inbox; nothing claims server delivery, and browser notification permissions are never involved.
 */
export type InboxEntry = {
  key: string;
  kind: string;
  priority: Exclude<ReminderPriority, "info">;
  text: string;
  short: string;
  href?: string;
  linkLabel?: string;
  /** When this browser first raised it (ISO). */
  at: string;
  read: boolean;
  /** When it was shown in the open Inbox (ISO); used to label it New only during that visit. */
  readAt?: string;
  /** A popup above the Felix button has already shown it (or it arrived while the Inbox was open). */
  popped: boolean;
  /** Still true in what the page has loaded now; false once the situation has passed. */
  active: boolean;
};

/** Older entries that no longer apply are kept for reference, up to this many. */
export const MAX_INACTIVE = 20;

const isEntry = (item: unknown): item is InboxEntry => {
  if (!item || typeof item !== "object") return false;
  const e = item as Record<string, unknown>;
  return typeof e.key === "string" && typeof e.kind === "string" && (e.priority === "urgent" || e.priority === "action") && typeof e.text === "string" && typeof e.short === "string" && typeof e.at === "string" && typeof e.read === "boolean" && typeof e.popped === "boolean" && typeof e.active === "boolean";
};

/** Restores a stored inbox; corrupt JSON, wrong shapes, duplicates and links outside the role's routes are dropped. */
export function parseInbox(saved: string | null, role: Role): InboxEntry[] {
  try {
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter(isEntry).filter(e => !seen.has(e.key) && !!seen.add(e.key)).map(e => {
      const href = safeLink(role, e.href);
      return { key: e.key, kind: e.kind, priority: e.priority, text: e.text, short: e.short, at: e.at, read: e.read, ...(e.read && typeof e.readAt === "string" ? { readAt: e.readAt } : {}), popped: e.popped, active: e.active, ...(href ? { href, linkLabel: typeof e.linkLabel === "string" ? e.linkLabel : "Open" } : {}) };
    });
  } catch {
    return [];
  }
}

/**
 * Brings the stored inbox up to date with the current reminders. Only reminders that need action reach the inbox
 * (information stays in "What should I do next?"). Dedupe rules:
 * - the same key is one entry: its read state is kept and its wording refreshed (if it had passed and returns,
 *   it is a new occurrence and unread again);
 * - a new key replaces an older, still-unread entry of the same kind (it was never seen, and the new one covers it);
 * - entries whose situation has passed stay listed as inactive (newest {@link MAX_INACTIVE}).
 */
export function mergeInbox(stored: InboxEntry[], reminders: Reminder[], now: string): InboxEntry[] {
  const current = reminders.filter((r): r is Reminder & { priority: InboxEntry["priority"] } => r.priority !== "info");
  const keys = new Set(current.map(r => r.key));
  const freshKinds = new Set(current.filter(r => !stored.some(e => e.key === r.key)).map(r => r.kind));
  const kept = stored
    .filter(e => keys.has(e.key) || e.read || !freshKinds.has(e.kind))
    .map(e => {
      const r = current.find(item => item.key === e.key);
      if (!r) return { ...e, active: false };
      const update = { priority: r.priority, text: r.text, short: r.short, href: r.href, linkLabel: r.linkLabel, active: true };
      // A situation that had passed and has come back is a new occurrence: announce it again.
      if (e.active) return { ...e, ...update };
      return { ...e, ...update, at: now, read: false, readAt: undefined, popped: false };
    });
  const added: InboxEntry[] = current
    .filter(r => !stored.some(e => e.key === r.key))
    .map(r => ({ key: r.key, kind: r.kind, priority: r.priority, text: r.text, short: r.short, href: r.href, linkLabel: r.linkLabel, at: now, read: false, popped: false, active: true }));
  const all = [...added, ...kept];
  const inactive = all.filter(e => !e.active).sort(newestFirst).slice(0, MAX_INACTIVE);
  return [...all.filter(e => e.active), ...inactive].sort(newestFirst);
}

const ORDER = { urgent: 0, action: 1 } as const;
function newestFirst(a: InboxEntry, b: InboxEntry) {
  return Number(b.active) - Number(a.active) || b.at.localeCompare(a.at) || ORDER[a.priority] - ORDER[b.priority] || a.key.localeCompare(b.key);
}

export const unreadCount = (entries: InboxEntry[]) => entries.filter(e => !e.read).length;

/** Marks the given entries (or all) read at `at`: they have been shown to the person in the open Inbox. */
export function markRead(entries: InboxEntry[], at: string, keys?: readonly string[]): InboxEntry[] {
  return entries.map(e => (!keys || keys.includes(e.key)) && !e.read ? { ...e, read: true, readAt: at, popped: true } : e);
}

/** Labelled New in the Inbox during the visit that first showed it (the visit opened at `openedAt`). */
export const isNewSince = (entry: InboxEntry, openedAt: string | null) => !!openedAt && !!entry.readAt && entry.readAt >= openedAt;

/** Marks entries as already announced, so a popup never repeats. */
export function markPopped(entries: InboxEntry[], keys: readonly string[]): InboxEntry[] {
  return entries.map(e => keys.includes(e.key) && !e.popped ? { ...e, popped: true } : e);
}

/** The popup to show above the Felix button: the most pressing unread, un-announced, current entry, and how many more. */
export function nextPopup(entries: InboxEntry[]): { entry: InboxEntry; more: number; keys: string[] } | null {
  const waiting = entries.filter(e => e.active && !e.read && !e.popped).sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return waiting.length ? { entry: waiting[0], more: waiting.length - 1, keys: waiting.map(e => e.key) } : null;
}

/** True when two inbox lists would store the same thing (lets the component skip needless writes and renders). */
export const sameInbox = (a: InboxEntry[], b: InboxEntry[]) => JSON.stringify(a) === JSON.stringify(b);

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;
/**
 * The inbox for one role/committee scope as a tiny external store: React subscribes to it, effects update it, and
 * every change is written to localStorage. A missing or failing storage keeps the inbox for this page only.
 */
export class InboxStore {
  private entries: InboxEntry[];
  private listeners = new Set<() => void>();
  constructor(private key: string, role: Role, private storage: KeyValueStorage | null) {
    let saved: string | null = null;
    try { saved = storage?.getItem(key) ?? null; } catch { saved = null; }
    this.entries = parseInbox(saved, role);
  }
  getSnapshot = () => this.entries;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update(change: (entries: InboxEntry[]) => InboxEntry[]) {
    const next = change(this.entries);
    if (sameInbox(next, this.entries)) return;
    this.entries = next;
    try { this.storage?.setItem(this.key, JSON.stringify(next)); } catch { /* still correct for this page */ }
    for (const listener of this.listeners) listener();
  }
}
