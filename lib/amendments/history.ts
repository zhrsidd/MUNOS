import type { SupabaseClient } from '@supabase/supabase-js';
import type { Amendment } from '../batch/types';
import type { Delegate, Resolution } from '../domain';
// Passed amendment history. The staff snapshot carries amendments only for the resolution currently In Debate,
// so closed history is read on demand, newest first, in bounded pages under the amendments table RLS
// (Chair of that committee, or Executive). Nothing here writes.
export const PASSED_HISTORY_PAGE = 50;
export interface HistoryCursor { createdAt: string; id: string }
export interface PassedGroup { resolutionId: string; resolution: Resolution | null; amendments: Amendment[] }
interface Row { id: string; committee_id: string; resolutionId: string; sessionId: string; submitterId: string; type: Amendment['type']; clause: string; wording: string; status: Amendment['status']; outcome: Amendment['outcome']; createdAt: string; revision: number }
const toAmendment = (r: Row): Amendment => ({ id: r.id, committeeId: r.committee_id, resolutionId: r.resolutionId, sessionId: r.sessionId, submitterId: r.submitterId, type: r.type, clause: r.clause, wording: r.wording, status: r.status, outcome: r.outcome, createdAt: r.createdAt, revision: r.revision });
const passed = (a: Amendment) => a.status === 'Closed' && a.outcome === 'Passed';
const newestFirst = (a: Amendment, b: Amendment) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** One page of a committee's passed amendments, older than the cursor. `next` is null when no older page exists. */
export async function loadPassedPage(client: SupabaseClient, conf: string, committeeId: string, before: HistoryCursor | null): Promise<{ rows: Amendment[]; next: HistoryCursor | null }> {
  let query = client.from('amendments').select('id,committee_id,resolutionId,sessionId,submitterId,type,clause,wording,status,outcome,createdAt,revision')
    .eq('conference_id', conf).eq('committee_id', committeeId).eq('status', 'Closed').eq('outcome', 'Passed')
    .order('createdAt', { ascending: false }).order('id', { ascending: false }).limit(PASSED_HISTORY_PAGE);
  // Keyset paging; values are quoted because timestamps contain ':' and '+'.
  if (before) query = query.or(`createdAt.lt."${before.createdAt}",and(createdAt.eq."${before.createdAt}",id.lt.${before.id})`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data ?? []) as Row[]).map(toAmendment);
  const last = rows.at(-1);
  return { rows, next: rows.length === PASSED_HISTORY_PAGE && last ? { createdAt: last.createdAt, id: last.id } : null };
}

/** Passed amendments for one committee from every source, without duplicates; the newest copy of a row wins. */
export function mergePassed(committeeId: string, ...sources: Amendment[][]): Amendment[] {
  const byId = new Map<string, Amendment>();
  for (const source of sources) for (const a of source) {
    if (a.committeeId !== committeeId || !passed(a)) continue;
    const prior = byId.get(a.id);
    if (!prior || a.revision >= prior.revision) byId.set(a.id, a);
  }
  return [...byId.values()].sort(newestFirst);
}

/** Grouped by original resolution: most recently amended resolution first, amendments in the order submitted. */
export function groupByResolution(amendments: Amendment[], documents: Resolution[]): PassedGroup[] {
  const groups = new Map<string, Amendment[]>();
  for (const a of [...amendments].sort(newestFirst)) groups.set(a.resolutionId, [...(groups.get(a.resolutionId) ?? []), a]);
  return [...groups].map(([resolutionId, list]) => ({ resolutionId, resolution: documents.find(d => d.id === resolutionId) ?? null, amendments: list.reverse() }));
}

/** Exact text a Chair pastes into the working Google Doc. The wording is copied unchanged. */
export function amendmentCopyText(a: Amendment, submitter: Pick<Delegate, 'country'> | undefined) {
  return `${a.type} · ${a.clause}${submitter ? ` · ${submitter.country}` : ''}\n${a.wording}`;
}
