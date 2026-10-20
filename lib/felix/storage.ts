import type { Role } from "../domain";
import { safeLink } from "./answer";

/**
 * Felix keeps everything in this browser's localStorage (per role, and per committee for Chairs). Nothing is sent
 * to the server, so other devices and other staff never see it. Every parser tolerates missing or corrupt values.
 */
export type StoredMessage = { id: number; from: "felix" | "you"; text: string; href?: string; linkLabel?: string };
export const MAX_MESSAGES = 60;

/** localStorage keys. Bump the version suffix if a stored shape changes incompatibly. */
export function felixStorageKeys(role: Role, committeeId?: string) {
  const scope = role === "chair" ? `${role}:${committeeId || "unassigned"}` : role;
  return { chat: `felix-chat-v1:${scope}`, inbox: `felix-inbox-v1:${scope}` };
}
/** Device-wide preference: the person's own "Animate Felix" switch. */
export const MOTION_KEY = "felix-motion-v1";

/** Restores saved chat: keeps only well-formed messages, the last 60, and drops links that are not this role's routes. */
export function parseStoredChat(saved: string | null, role: Role): StoredMessage[] {
  try {
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredMessage => !!item && typeof item === "object" && (item.from === "felix" || item.from === "you") && typeof item.text === "string" && typeof item.id === "number" && Number.isFinite(item.id))
      .slice(-MAX_MESSAGES)
      .map(item => {
        const href = safeLink(role, typeof item.href === "string" ? item.href : undefined);
        return { id: item.id, from: item.from, text: item.text, ...(href ? { href, linkLabel: typeof item.linkLabel === "string" ? item.linkLabel : "Open" } : {}) };
      });
  } catch {
    return [];
  }
}

/** The motion preference: on unless this device stored "off". Anything unreadable means the default. */
export function parseMotionPreference(saved: string | null): boolean {
  return saved !== "off";
}
