// Google Docs links. Conference OS stores ONLY the document id and always rebuilds the URL itself,
// so no user-supplied URL is ever rendered or followed. The text of the document is never read.
export const GOOGLE_DOC_ID = /^[A-Za-z0-9_-]{25,100}$/;
export type GoogleDocProblem = "empty" | "not_google_doc" | "published_link" | "malformed";
export const googleDocMessages: Record<GoogleDocProblem, string> = {
  empty: "Paste the link to your Google Doc.",
  not_google_doc: "That is not a Google Docs link. Open your resolution in Google Docs, press Share → Copy link, and paste it here.",
  published_link: "That is a “Publish to the web” link. Use Share → Copy link instead, so your Chair can edit the document.",
  malformed: "That Google Docs link is incomplete. Copy it again from Share → Copy link.",
};
/** Canonical, safe URL for a document id. */
export function googleDocUrl(id: string) {
  if (!GOOGLE_DOC_ID.test(id)) throw Error("Invalid Google Doc id");
  return `https://docs.google.com/document/d/${id}/edit`;
}
/**
 * Accepts the links people actually paste: .../document/d/<id>/edit?usp=sharing, /u/1/d/<id>,
 * with or without "https://". Rejects other hosts (including look-alikes and user-info tricks),
 * other protocols, Drive file links and "Publish to the web" links.
 */
export function parseGoogleDocLink(input: string): { ok: true; id: string; url: string } | { ok: false; problem: GoogleDocProblem } {
  const text = input.trim();
  if (!text) return { ok: false, problem: "empty" };
  if (text.length > 2048 || /\s/.test(text)) return { ok: false, problem: "not_google_doc" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, problem: "not_google_doc" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, problem: "not_google_doc" };
  if (url.username || url.password || url.port || url.hostname !== "docs.google.com") return { ok: false, problem: "not_google_doc" };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "document") return { ok: false, problem: "not_google_doc" };
  // Optional account selector: /document/u/1/d/<id>
  const rest = parts[1] === "u" && /^\d+$/.test(parts[2] ?? "") ? parts.slice(3) : parts.slice(1);
  if (rest[0] !== "d") return { ok: false, problem: "malformed" };
  if (rest[1] === "e") return { ok: false, problem: "published_link" };
  const id = rest[1] ?? "";
  if (!GOOGLE_DOC_ID.test(id)) return { ok: false, problem: "malformed" };
  return { ok: true, id, url: googleDocUrl(id) };
}
