/**
 * The one visible identity of a resolution: `GA1/01 — France`.
 *
 * Existing resolution code (stored as `GA1 / 01`, shown without the spaces round the slash), an em dash, then the
 * Main Submitter's country. Never a delegate's personal name and never the old title. Every screen, notice,
 * reminder and search goes through this module so they all agree.
 *
 * The lookup is pure and uses only the delegates the caller already holds (the role's own snapshot): no fetch, no
 * polling. A delegate from another committee is never used, a missing or archived one is never guessed at, and the
 * stored code and title are never changed.
 */

/** Shown in place of the country when the Main Submitter cannot be read from the data on hand. */
export const SUBMITTER_UNAVAILABLE = "Main submitter unavailable";
/** Shown in a pre-submission preview, before a real code exists. */
export const NUMBER_ASSIGNED_ON_SUBMISSION = "Resolution number assigned on submission";
/** Only for a stored resolution whose code is blank (should not occur: the code is required). */
export const NUMBER_UNAVAILABLE = "Resolution number unavailable";
export const IDENTITY_SEPARATOR = " — ";

/** The part of a Delegate the identity needs. `committeeId` is optional because the public amendment page omits it. */
export interface IdentityDelegate {
  id: string;
  country: string;
  committeeId?: string | null;
  /** Not part of today's Delegate; an archived delegate is treated as unavailable if a snapshot ever marks one. */
  archived?: boolean;
}
export interface IdentityResolution {
  code?: string | null;
  submitterId?: string | null;
  committeeId?: string | null;
  /**
   * Country published by the server for readers whose snapshot excludes delegates (Approval, Logistics). Used only
   * when the delegate itself cannot be found. Published by migration 20261021130000 (documents and decision history).
   */
  submitterCountry?: string | null;
}
export interface ResolutionIdentity {
  /** `GA1/01`, or the preview text when there is no code yet. */
  code: string;
  /** The Main Submitter's country, or null when it cannot be read. */
  country: string | null;
  /** What follows the dash: the country, or "Main submitter unavailable". Null for a preview without a submitter. */
  submitter: string | null;
  /** True when `country` is a real country. */
  available: boolean;
  /** True for a pre-submission preview (no code yet). */
  preview: boolean;
  /** The whole identity as one string: `GA1/01 — France`. */
  text: string;
}
export type DelegateSource = Iterable<IdentityDelegate> | ReadonlyMap<string, IdentityDelegate>;

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
/** `GA1 / 01` → `GA1/01`. Only the display changes; the stored code is never rewritten. */
export function displayResolutionCode(code: string | null | undefined): string {
  return squash(code ?? "").replace(/ ?\/ ?/g, "/");
}

const asMap = (delegates: DelegateSource): ReadonlyMap<string, IdentityDelegate> => {
  if (delegates instanceof Map) return delegates;
  const map = new Map<string, IdentityDelegate>();
  for (const delegate of delegates as Iterable<IdentityDelegate>) map.set(delegate.id, delegate);
  return map;
};

/** The submitter's country from the delegates on hand, or null. Stays inside the resolution's own committee. */
export function submitterCountry(resolution: IdentityResolution | null | undefined, delegates: DelegateSource): string | null {
  if (!resolution) return null;
  const delegate = resolution.submitterId ? asMap(delegates).get(resolution.submitterId) : undefined;
  const sameCommittee = !delegate || !delegate.committeeId || !resolution.committeeId || delegate.committeeId === resolution.committeeId;
  const own = delegate && !delegate.archived && sameCommittee ? squash(delegate.country ?? "") : "";
  if (own) return own;
  return squash(resolution.submitterCountry ?? "") || null;
}

function build(code: string, country: string | null, preview: boolean, withFallback: boolean): ResolutionIdentity {
  const submitter = country ?? (withFallback ? SUBMITTER_UNAVAILABLE : null);
  return { code, country, submitter, available: country !== null, preview, text: submitter ? `${code}${IDENTITY_SEPARATOR}${submitter}` : code };
}

/** `GA1/01 — France`, or `GA1/01 — Main submitter unavailable`. Pass a delegate list or a prebuilt id map. */
export function resolutionIdentity(resolution: IdentityResolution | null | undefined, delegates: DelegateSource): ResolutionIdentity {
  const code = displayResolutionCode(resolution?.code) || NUMBER_UNAVAILABLE;
  return build(code, submitterCountry(resolution, delegates), false, true);
}
/** The identity as plain text, for notices, reminders and accessible names. */
export const resolutionLabel = (resolution: IdentityResolution | null | undefined, delegates: DelegateSource) => resolutionIdentity(resolution, delegates).text;
/** A resolver over one delegate list, so a screen with many rows indexes the delegates once. */
export function resolutionIdentities(delegates: DelegateSource): (resolution: IdentityResolution | null | undefined) => ResolutionIdentity {
  const map = asMap(delegates);
  return resolution => resolutionIdentity(resolution, map);
}
/**
 * A form with no code yet: `Resolution number assigned on submission`, followed by the chosen country once there
 * is one. The country is read like any other submitter (same committee, never archived).
 */
export function previewIdentity(submitterId: string | null | undefined, delegates: DelegateSource, committeeId?: string | null): ResolutionIdentity {
  return build(NUMBER_ASSIGNED_ON_SUBMISSION, submitterCountry({ submitterId, committeeId }, delegates), true, false);
}

// ---------------------------------------------------------------- search

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
/** `ga1 / 01`, `GA1 01` and `ga1/01` all become `ga1/01`. */
const codeKey = (value: string) => fold(squash(value)).replace(/ ?\/ ?/g, "/").replace(/ /g, "/");

export interface ResolutionSearchFields {
  code: string | null | undefined;
  /** The Main Submitter's country (null when unavailable). */
  country: string | null | undefined;
  /** Further words that should match, such as status, outcome and the committee. Never the title. */
  extra?: (string | null | undefined)[];
}
/**
 * Case-insensitive search by code (`ga1/01`, `ga1 / 01`, `ga1 01`, a prefix such as `ga1/0`) and by Main Submitter
 * country, plus the status/outcome/committee words in `extra`. Several words must all match, so `ga1 france` finds
 * France's GA1 resolutions. An empty query matches everything.
 */
export function matchesResolutionSearch(query: string, fields: ResolutionSearchFields): boolean {
  const q = squash(query);
  if (!q) return true;
  const code = codeKey(fields.code ?? "");
  if (code && code.includes(codeKey(q))) return true;
  const words = [fields.country ?? "", ...(fields.extra ?? []).map(word => word ?? "")].map(fold);
  const codeWords = code.split("/");
  return fold(q).split(" ").filter(term => /[\p{L}\p{N}]/u.test(term)).every(term =>
    term.includes("/") ? code.includes(term) : words.some(word => word.includes(term)) || codeWords.some(part => part.startsWith(term)));
}
