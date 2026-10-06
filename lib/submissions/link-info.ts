import { submissionBackend } from "./backend";
import { SUBMISSION_TOKEN, type LinkInfo } from "./rules";
/** Server-side lookup for the public pages. Unknown, revoked and malformed links look identical. */
export async function findLink(token: string): Promise<LinkInfo | null | "unavailable"> {
  if (!SUBMISSION_TOKEN.test(token)) return null;
  const backend = submissionBackend();
  if (!backend) return "unavailable";
  try { return await backend.linkInfo(token); } catch { return "unavailable"; }
}
