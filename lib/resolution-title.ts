/**
 * The compatibility title.
 *
 * Resolutions are no longer named: the visible identity is `GA1/01 — France` (lib/resolution-identity.ts) and nobody
 * is asked for a title. But `public.documents.title` is `text not null` and `public.submit_resolution` rejects a title
 * outside 3 to 200 characters, and neither may change without a migration. This is the ONE rule that fills that
 * legacy column for every new resolution, whether it is submitted by a delegate (lib/submissions) or drafted by a Chair
 * (the `newDocument` command).
 *
 * It is deliberately a fixed, non-descriptive constant, never derived from anything a person typed or from a country:
 * it is not an invented name, nothing displays it (every screen, search and notice uses the resolution identity), and
 * a constant keeps retries of one submission byte-identical for the server's idempotency check.
 * Existing stored titles, Google Doc names and audit records are never touched.
 */
export const COMPAT_RESOLUTION_TITLE = "Untitled resolution";

/** The legacy `title` value for a new resolution. Always satisfies the database's 3 to 200 character check. */
export function compatResolutionTitle(): string {
  return COMPAT_RESOLUTION_TITLE;
}
