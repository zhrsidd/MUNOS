import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Amendment } from '../batch/types';
import type { Delegate, Resolution } from '../domain';
import { GOOGLE_DOC_ID } from '../submissions/google-doc';
import { mergePassed } from './history';
// Read-only device cache of passed amendment history (audit F2), so wording fetched online stays readable offline
// after its resolution leaves the snapshot. Kept apart from the mutation outbox: its own database, no writes to the
// server, keyed by actor + conference + committee so another staff identity on the same device never reads it.
export const HISTORY_CACHE_LIMIT = 500;
export const HISTORY_CACHE_MAX_AGE_MS = 14 * 86_400_000;
/** Enough to show a row offline: resolution identity, the submitting delegation and the working Doc id. */
export interface HistoryContext {
  resolutions: Record<string, { code: string; title: string }>;
  delegations: Record<string, { flag: string; country: string }>;
  workingDocs: Record<string, string>;
}
export interface CachedHistory { key: string; rows: Amendment[]; context: HistoryContext; savedAt: string }

export const historyCacheKey = (actorId: string, conferenceId: string, committeeId: string) => `${actorId}|${conferenceId}|${committeeId}`;
const emptyContext = (): HistoryContext => ({ resolutions: {}, delegations: {}, workingDocs: {} });

/** Context for the given rows from the data on hand; working Doc ids are kept only if they are valid ids. */
export function historyContext(rows: Amendment[], documents: Resolution[], delegates: Delegate[], links: { documentId: string; workingDocId?: string | null }[]): HistoryContext {
  const context = emptyContext();
  for (const a of rows) {
    const r = documents.find(d => d.id === a.resolutionId);
    if (r) context.resolutions[r.id] = { code: r.code, title: r.title };
    const d = delegates.find(x => x.id === a.submitterId);
    if (d) context.delegations[d.id] = { flag: d.flag, country: d.country };
    const doc = links.find(l => l.documentId === a.resolutionId)?.workingDocId;
    if (doc && GOOGLE_DOC_ID.test(doc)) context.workingDocs[a.resolutionId] = doc;
  }
  return context;
}

/** The next cache entry: rows merged by id (newest revision wins), this committee's passed rows only, newest first,
 *  bounded; context merged so newer facts win and entries for dropped rows are discarded. */
export function mergeCache(prior: CachedHistory | undefined, key: string, committeeId: string, rows: Amendment[], context: HistoryContext, now = new Date()): CachedHistory {
  const fresh = prior && Date.parse(prior.savedAt) > now.getTime() - HISTORY_CACHE_MAX_AGE_MS ? prior : undefined;
  const kept = mergePassed(committeeId, fresh?.rows ?? [], rows).slice(0, HISTORY_CACHE_LIMIT);
  const all = { resolutions: { ...fresh?.context.resolutions, ...context.resolutions }, delegations: { ...fresh?.context.delegations, ...context.delegations }, workingDocs: { ...fresh?.context.workingDocs, ...context.workingDocs } };
  const pick = <T,>(record: Record<string, T>, ids: Set<string>) => Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
  const resolutionIds = new Set(kept.map(a => a.resolutionId)), submitterIds = new Set(kept.map(a => a.submitterId));
  return { key, rows: kept, context: { resolutions: pick(all.resolutions, resolutionIds), delegations: pick(all.delegations, submitterIds), workingDocs: pick(all.workingDocs, resolutionIds) }, savedAt: now.toISOString() };
}

/** Rows and context still usable from a stored entry (empty when absent or older than the maximum age). */
export function usableCache(entry: CachedHistory | undefined, now = new Date()): { rows: Amendment[]; context: HistoryContext } {
  if (!entry || !(Date.parse(entry.savedAt) > now.getTime() - HISTORY_CACHE_MAX_AGE_MS)) return { rows: [], context: emptyContext() };
  return { rows: entry.rows, context: entry.context };
}

interface Schema extends DBSchema { passed: { key: string; value: CachedHistory } }
export class HistoryCache {
  private db?: Promise<IDBPDatabase<Schema>>;
  constructor(private name = 'conference-os-read-cache') {}
  private open() { return this.db ??= openDB<Schema>(this.name, 1, { upgrade(db) { db.createObjectStore('passed', { keyPath: 'key' }); }, blocking: () => { void this.db?.then(db => db.close()); } }); }
  async read(key: string) { return (await this.open()).get('passed', key); }
  /** Read-merge-write in one transaction, so two pages saved at once cannot drop each other's rows. */
  async save(key: string, committeeId: string, rows: Amendment[], context: HistoryContext, now = new Date()) {
    const tx = (await this.open()).transaction('passed', 'readwrite');
    const next = mergeCache(await tx.store.get(key), key, committeeId, rows, context, now);
    await tx.store.put(next);
    await tx.done;
    return next;
  }
  async close() { if (this.db) (await this.db).close(); this.db = undefined; }
}
export const historyCache = new HistoryCache();
