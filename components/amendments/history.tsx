'use client';
import { useEffect, useRef, useState } from 'react';
import { useConference } from '@/lib/context';
import { browserClient } from '@/lib/supabase/client';
import { PASSED_HISTORY_PAGE, amendmentCopyText, groupByResolution, loadPassedPage, mergePassed, type HistoryCursor } from '@/lib/amendments/history';
import { historyCache, historyCacheKey, historyContext, usableCache, type HistoryContext } from '@/lib/amendments/history-cache';
import type { Amendment } from '@/lib/batch/types';
import { Chip, Empty, Panel } from '@/components/ui';
import { GoogleDocButton } from '@/components/operations/resolution-links';
import { ResolutionName } from '@/components/resolution-identity';
import { resolutionIdentity } from '@/lib/resolution-identity';

const time = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Copy feedback is shown only after the clipboard write resolves; a refusal says so instead of pretending. */
function CopyWording({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => { navigator.clipboard.writeText(text).then(() => setState('copied'), () => setState('failed')); };
  return <><button type="button" onClick={copy}>{state === 'copied' ? 'Copied' : 'Copy wording'}</button>{state === 'failed' && <span className="field-error" role="alert">Copy failed. Select the wording and copy it manually.</span>}</>;
}

/** Every passed amendment for the committee, grouped by its original resolution, kept after closure and session changes.
 *  Pages fetched online are also kept in a read-only device cache (lib/amendments/history-cache.ts) for offline reloads. */
export function PassedAmendmentHistory({ committeeId }: { committeeId: string }) {
  const { data, access } = useConference();
  const cloud = access.status === 'active', conf = data.conference.id;
  const cacheKey = cloud && access.actorId ? historyCacheKey(access.actorId, conf, committeeId) : null;
  const [fetched, setFetched] = useState<Amendment[]>([]);
  const [next, setNext] = useState<HistoryCursor | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>(cloud ? 'loading' : 'idle');
  const [attempt, setAttempt] = useState(0);
  const [cached, setCached] = useState<{ key: string; rows: Amendment[]; context: HistoryContext } | null>(null);
  // The committee/identity a response belongs to; a page answered after a switch is ignored.
  const latest = useRef(cacheKey);
  useEffect(() => { latest.current = cacheKey; }, [cacheKey]);
  // Device cache first, so an offline reload still shows what was fetched earlier.
  useEffect(() => {
    if (!cacheKey) return;
    let current = true;
    historyCache.read(cacheKey).then(entry => { if (current) setCached({ key: cacheKey, ...usableCache(entry) }); }, () => undefined);
    return () => { current = false; };
  }, [cacheKey]);
  // Saving is best effort: a failed cache write never hides the rows already fetched.
  const remember = (key: string | null, rows: Amendment[]) => {
    if (!key || !rows.length) return;
    historyCache.save(key, committeeId, rows, historyContext(rows, data.documents, data.delegates, data.resolutionLinks ?? []))
      .then(entry => { if (latest.current === key) setCached({ key, rows: entry.rows, context: entry.context }); }, () => undefined);
  };
  // First page on open (and on Retry); setState only in the async callbacks, ignored once superseded.
  useEffect(() => {
    if (!cloud) return;
    let current = true;
    const key = cacheKey;
    loadPassedPage(browserClient(), conf, committeeId, null).then(page => { if (current) { setFetched(page.rows); setNext(page.next); setStatus('idle'); remember(key, page.rows); } }, () => { if (current) setStatus('error'); });
    return () => { current = false; };
    // remember reads the latest data when a page arrives; refetching on every snapshot change is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, conf, committeeId, attempt]);
  const older = async (before: HistoryCursor) => {
    const key = cacheKey;
    setStatus('loading');
    try {
      const page = await loadPassedPage(browserClient(), conf, committeeId, before);
      if (latest.current !== key) return;
      setFetched(prior => [...prior, ...page.rows]); setNext(page.next); setStatus('idle'); remember(key, page.rows);
    } catch { if (latest.current === key) setStatus('error'); }
  };
  const retry = () => { setStatus('loading'); setAttempt(n => n + 1); };
  const offline = cached && cached.key === cacheKey ? cached : { rows: [], context: { resolutions: {}, delegations: {}, workingDocs: {} } as HistoryContext };
  const groups = groupByResolution(mergePassed(committeeId, offline.rows, data.amendments ?? [], fetched), data.documents);
  const links = data.resolutionLinks ?? [];
  return <Panel title="Passed amendments" action={<Chip tone="green">{groups.reduce((n, g) => n + g.amendments.length, 0)}</Chip>}>
    {status === 'error' && <p className="callout" role="alert">Older passed amendments could not be loaded. Showing those already on this device. <button type="button" onClick={retry}>Retry</button></p>}
    <div className="panel-body" style={{ display: 'grid', gap: '1.25rem' }}>
    {!groups.length ? <Empty title={status === 'loading' ? 'Loading passed amendments…' : 'No passed amendments yet'} text="Amendments that pass stay here, grouped by resolution, after debate ends." /> :
      groups.map(g => {
        const workingDoc = links.find(l => l.documentId === g.resolutionId)?.workingDocId ?? offline.context.workingDocs[g.resolutionId];
        // The live resolution reads its Main Submitter from this committee's delegates; a resolution known only from the
        // device cache uses the country cached with it. Entries cached before the country was stored read "Main submitter unavailable".
        const cachedResolution = offline.context.resolutions[g.resolutionId];
        const identity = g.resolution ? resolutionIdentity(g.resolution, data.delegates.filter(d => d.committeeId === committeeId))
          : cachedResolution ? resolutionIdentity({ code: cachedResolution.code, submitterCountry: cachedResolution.country }, []) : null;
        return <section key={g.resolutionId} style={{ display: 'grid', gap: '.75rem' }}>
          <h3>{identity ? <ResolutionName identity={identity} /> : 'Resolution not on this device'}</h3>
          {workingDoc && <div className="actions"><GoogleDocButton docId={workingDoc} label="Open working Google Doc" /></div>}
          {g.amendments.map(a => {
            const submitter = data.delegates.find(d => d.id === a.submitterId) ?? offline.context.delegations[a.submitterId];
            return <article key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
              <div className="actions"><Chip tone="green">Passed</Chip><strong>{a.type}</strong><span>{a.clause}</span><span className="muted">{submitter ? `${submitter.flag} ${submitter.country}` : 'Delegation not on this device'} · submitted {time(a.createdAt)}</span></div>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.wording}</p>
              <div className="actions"><CopyWording text={amendmentCopyText(a, submitter)} /></div>
            </article>;
          })}
        </section>;
      })}
    </div>
    {cloud && next && <div className="actions"><button type="button" disabled={status === 'loading'} onClick={() => void older(next)}>{status === 'loading' ? 'Loading…' : 'Load older passed amendments'}</button></div>}
    <p className="footnote">{cloud ? `Older history loads ${PASSED_HISTORY_PAGE} at a time.` : 'Showing amendments held on this device.'} The time shown is when the amendment was submitted; Conference OS does not record the time it passed.</p>
  </Panel>;
}
