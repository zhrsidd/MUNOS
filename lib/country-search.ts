import { countryKey, countrySearchNames } from "./countries";
import type { Delegate, ParticipationEvent } from "./domain";
import { atOrAfter } from "./sessions/presence";

export type OpportunityCounts = Record<string, { speeches: number; pois: number }>;
export type OpportunityKind = "speeches" | "pois";

/**
 * Only delivered, non-voided contributions of this committee since `since` (the start of the current schedule window; absent: all);
 * never queued placards or point adjustments. Sessions are labels now, so "this session" is the window the schedule gives.
 */
export function sessionOpportunities(events: ParticipationEvent[], committeeId: string, since?: string | null): OpportunityCounts {
  const counts: OpportunityCounts = {};
  for (const event of events) {
    if (event.committeeId !== committeeId || (since && !atOrAfter(event.createdAt, since)) || event.voidedAt || !["speech", "poi"].includes(event.categoryId)) continue;
    const row = counts[event.delegateId] ??= { speeches: 0, pois: 0 };
    row[event.categoryId === "speech" ? "speeches" : "pois"]++;
  }
  return counts;
}

/** Edit distance with adjacent transpositions, for small misspellings (not broad identity guessing). */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}

function relevance(country: string, query: string) {
  let best = Infinity;
  for (const name of countrySearchNames(country)) {
    const key = countryKey(name);
    if (key === query) return 0;
    if (key.split(" ").some(word => word.startsWith(query)) || key.startsWith(query)) best = Math.min(best, 1);
    else if (key.includes(query)) best = Math.min(best, 2);
    else if (query.length >= 3) {
      const limit = query.length >= 6 ? 2 : 1;
      for (const candidate of [key, ...key.split(" ")]) {
        if (Math.abs(candidate.length - query.length) > limit) continue;
        const edits = distance(candidate, query);
        if (edits <= limit) best = Math.min(best, 3 + edits);
      }
    }
  }
  return best;
}

/** Callers supply eligible delegates. Search relevance always wins over opportunity ordering. */
export function searchDelegates(delegates: Delegate[], query: string, counts: OpportunityCounts, kind: OpportunityKind, mostFirst = false): Delegate[] {
  const key = countryKey(query);
  return delegates.map(delegate => ({ delegate, rank: key ? relevance(delegate.country, key) : 0 }))
    .filter(row => Number.isFinite(row.rank))
    .sort((a, b) => a.rank - b.rank
      || ((counts[a.delegate.id]?.[kind] ?? 0) - (counts[b.delegate.id]?.[kind] ?? 0)) * (mostFirst ? -1 : 1)
      || a.delegate.country.localeCompare(b.delegate.country, "en")
      || a.delegate.id.localeCompare(b.delegate.id, "en"))
    .map(row => row.delegate);
}
