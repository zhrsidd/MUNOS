'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useConference } from '@/lib/context';
import { Chip, Empty, PageHeading, Panel } from '@/components/ui';
import { AmendmentQrPanel } from './links';
import { amendmentFloorTaken, FLOOR_NOT_WITH_CHAIR } from '@/lib/procedure/view';
export function AmendmentInbox({ committeeId }: { committeeId: string }) {
  const { data, act } = useConference();
  const [busy, setBusy] = useState<string | null>(null);
  const resolution = data.documents.find(r => r.committeeId === committeeId && r.status === 'In Debate');
  const amendments = (data.amendments ?? []).filter(a => a.committeeId === committeeId && a.resolutionId === resolution?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const active = amendments.find(a => a.status === 'In Debate');
  const change = async (id: string, status: 'Accepted for Debate' | 'In Debate' | 'Closed', outcome?: 'Passed' | 'Failed' | 'Withdrawn' | 'Ruled Out') => {
    setBusy(id); try { await act({ type: 'amendmentStatus', id, status, ...(outcome ? { outcome } : {}) }, 'chair'); } finally { setBusy(null); }
  };
  return <><PageHeading eyebrow="CHAIR · AMENDMENTS" title={resolution ? `${resolution.code} amendments` : 'Amendments'} description={resolution?.title ?? 'Open a resolution for debate to receive amendments.'} /><AmendmentQrPanel committeeId={committeeId} />
    {!resolution ? <Empty title="No resolution in debate" text="Amendment submissions are closed until the committee starts debating a resolution." /> : !amendments.length ? <Empty title="No amendments yet" text="Delegates can scan the amendment QR and submit their exact wording." /> : <Panel title="Amendment inbox" subtitle="Review submissions before bringing them to debate. Only one amendment can be In Debate at a time."><div className="panel-body" style={{ display: 'grid', gap: '1rem' }}>{amendments.map(a => <article key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}><div className="actions"><strong>{data.delegates.find(d => d.id === a.submitterId)?.country ?? 'Delegation'}</strong><Chip tone={a.status === 'In Debate' ? 'blue' : a.outcome === 'Passed' ? 'green' : 'neutral'}>{a.outcome ?? a.status}</Chip><span>{a.type} · {a.clause}</span></div><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.wording}</p><small className="muted">Submitted {new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      {a.outcome === 'Passed' && <p className="callout">Apply the passed amendment to the working Google Doc.</p>}
      {a.status !== 'Closed' && <div className="actions">{a.status === 'Submitted' && <button className="primary" disabled={!!busy} onClick={() => void change(a.id, 'Accepted for Debate')}>Accept for debate</button>}{a.status === 'Accepted for Debate' && <button className="primary" disabled={!!busy || !!active || amendmentFloorTaken(data, a)} title={active ? 'Finish the current amendment debate first.' : amendmentFloorTaken(data, a) ? FLOOR_NOT_WITH_CHAIR : undefined} onClick={() => void change(a.id, 'In Debate')}>Start amendment debate</button>}{a.status === 'In Debate' && <Link className="button primary" href="/chair">Live on the Debate Console · Pass / Fail there →</Link>}<button disabled={!!busy || (a.status === 'In Debate' && amendmentFloorTaken(data, a))} onClick={() => window.confirm('Rule out this amendment? Its wording and outcome remain in the record.') && void change(a.id, 'Closed', 'Ruled Out')}>Rule out</button><button disabled={!!busy || (a.status === 'In Debate' && amendmentFloorTaken(data, a))} onClick={() => window.confirm('Record this amendment as withdrawn?') && void change(a.id, 'Closed', 'Withdrawn')}>Withdraw</button></div>}
      {a.status !== 'Closed' && (a.status === 'Accepted for Debate' || a.status === 'In Debate') && amendmentFloorTaken(data, a) && <p className="footnote" role="note">{FLOOR_NOT_WITH_CHAIR}</p>}
    </article>)}</div><p className="footnote">Showing up to 200 recent amendments for the current resolution. Earlier history stays preserved. Conference OS records the procedure and outcome; it does not edit Google Docs.</p></Panel>}
  </>;
}
