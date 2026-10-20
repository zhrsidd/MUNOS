'use client';
import { useEffect, useState } from 'react';
import { useConference } from '@/lib/context';
import { browserClient } from '@/lib/supabase/client';
import { PASSED_HISTORY_PAGE, amendmentCopyText, groupByResolution, loadPassedPage, mergePassed, type HistoryCursor } from '@/lib/amendments/history';
import type { Amendment } from '@/lib/batch/types';
import { Chip, Empty, Panel } from '@/components/ui';
import { GoogleDocButton } from '@/components/operations/resolution-links';

const time = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Copy feedback is shown only after the clipboard write resolves; a refusal says so instead of pretending. */
function CopyWording({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => { navigator.clipboard.writeText(text).then(() => setState('copied'), () => setState('failed')); };
  return <><button type="button" onClick={copy}>{state === 'copied' ? 'Copied' : 'Copy wording'}</button>{state === 'failed' && <span className="field-error" role="alert">Copy failed. Select the wording and copy it manually.</span>}</>;
}

/** Every passed amendment for the committee, grouped by its original resolution, kept after closure and session changes. */
export function PassedAmendmentHistory({ committeeId }: { committeeId: string }) {
  const { data, access } = useConference();
  const cloud = access.status === 'active', conf = data.conference.id;
  const [fetched, setFetched] = useState<Amendment[]>([]);
  const [next, setNext] = useState<HistoryCursor | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>(cloud ? 'loading' : 'idle');
  const [attempt, setAttempt] = useState(0);
  // First page on open (and on Retry); setState only in the async callbacks, ignored once superseded.
  useEffect(() => {
    if (!cloud) return;
    let current = true;
    loadPassedPage(browserClient(), conf, committeeId, null).then(page => { if (current) { setFetched(page.rows); setNext(page.next); setStatus('idle'); } }, () => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [cloud, conf, committeeId, attempt]);
  const older = async (before: HistoryCursor) => {
    setStatus('loading');
    try { const page = await loadPassedPage(browserClient(), conf, committeeId, before); setFetched(prior => [...prior, ...page.rows]); setNext(page.next); setStatus('idle'); }
    catch { setStatus('error'); }
  };
  const retry = () => { setStatus('loading'); setAttempt(n => n + 1); };
  const groups = groupByResolution(mergePassed(committeeId, data.amendments ?? [], fetched), data.documents);
  const links = data.resolutionLinks ?? [];
  return <Panel title="Passed amendments" action={<Chip tone="green">{groups.reduce((n, g) => n + g.amendments.length, 0)}</Chip>}>
    {status === 'error' && <p className="callout" role="alert">Older passed amendments could not be loaded. Showing those already on this device. <button type="button" onClick={retry}>Retry</button></p>}
    <div className="panel-body" style={{ display: 'grid', gap: '1.25rem' }}>
    {!groups.length ? <Empty title={status === 'loading' ? 'Loading passed amendments…' : 'No passed amendments yet'} text="Amendments that pass stay here, grouped by resolution, after debate ends." /> :
      groups.map(g => {
        const workingDoc = links.find(l => l.documentId === g.resolutionId)?.workingDocId;
        return <section key={g.resolutionId} style={{ display: 'grid', gap: '.75rem' }}>
          <h3>{g.resolution ? `${g.resolution.code} · ${g.resolution.title}` : 'Resolution not on this device'}</h3>
          {workingDoc && <div className="actions"><GoogleDocButton docId={workingDoc} label="Open working Google Doc" /></div>}
          {g.amendments.map(a => {
            const submitter = data.delegates.find(d => d.id === a.submitterId);
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
