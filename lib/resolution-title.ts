/**
 * The compatibility title.
 *
 * Resolutions are no longer named: the visible identity is `GA1/01 — France` (lib/resolution-identity.ts) and nobody
 * is asked for a title. But `public.documents.title` is `text not null` and `public.submit_resolution` rejects a title
 * outside 3 to 200 characters, and neither may change without a migration. This is the ONE rule that fills that
 * legacy column for every new resolution, whether it is submitted by a delegate (lib/submissions) or drafted by a Chair
 * (the `newDocument` command).
 *
 * It is deliberately a fixed, non-descriptive constant, never derived from a country or invented: nothing displays it
 * (every screen, search and notice uses the resolution identity), and a constant keeps retries of one submission
 * byte-identical for the server's idempotency check. The one exception is `legacySubmissionTitle` below, which lets a
 * retry from an OLD cached form (see there) keep sending the title it already sent before the deploy.
 * Existing stored titles, Google Doc names and audit records are never touched.
 */
export const COMPAT_RESOLUTION_TITLE = "Untitled resolution";

/** The legacy `title` value for a new resolution. Always satisfies the database's 3 to 200 character check. */
export function compatResolutionTitle(): string {
  return COMPAT_RESOLUTION_TITLE;
}

/** The database's own bounds for a title (`submit_resolution` raises invalid_title outside them). */
export const LEGACY_TITLE_MIN = 3;
export const LEGACY_TITLE_MAX = 200;

/**
 * A title posted by an OLD cached submission form, reduced exactly as the pre-title-free code did (`cleanTitle` in
 * lib/submissions/rules.ts: every whitespace run becomes one space, then trim) and bounded the same way (3 to 200
 * characters after reduction). Returns `undefined` for anything else, and the caller then uses `compatResolutionTitle()`.
 *
 * Why this exists: `submit_resolution` stores `trim(title)` in the idempotency receipt and compares it on every retry of
 * a submission id. A delegate whose old form was accepted before the deploy has the real title in that receipt; a retry
 * of the same id must send the same value or the RPC answers 409 idempotency_conflict. The value is only ever forwarded
 * for that purpose: no screen shows it and the new form never sends one.
 *
 * Invalid values (not a string, e.g. an uploaded file part; empty; under 3 or over 200 characters after reduction) are
 * not an error. The old code refused such a request with 400 invalid_title, so no receipt can exist for it; falling back
 * to the compatibility title is safe and lets the delegate's submission through instead of blocking on a hidden field.
 * The request body is already bounded (64 KB) before this runs.
 */
export function legacySubmissionTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length >= LEGACY_TITLE_MIN && clean.length <= LEGACY_TITLE_MAX ? clean : undefined;
}
