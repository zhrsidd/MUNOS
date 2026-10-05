import { submissionBackend } from "./backend";
import { SUBMISSION_TOKEN, type LinkInfo } from "./rules";
// A room of delegates often scans the same QR code at once: page views reuse a lookup for 30 s
// per server instance. Submissions themselves always re-validate the link in the database.
const cache = new Map<string, { at: number; value: LinkInfo | null }>();
const TTL = 30_000;
/** Server-side lookup for the public pages. Unknown, revoked and malformed links look identical. */
export async function findLink(token: string): Promise<LinkInfo | null | "unavailable"> {
  if (!SUBMISSION_TOKEN.test(token)) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const backend = submissionBackend();
  if (!backend) return "unavailable";
  try {
    const value = await backend.linkInfo(token);
    if (cache.size > 500) cache.clear();
    cache.set(token, { at: Date.now(), value });
    return value;
  } catch {
    return "unavailable";
  }
}
