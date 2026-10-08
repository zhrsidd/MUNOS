'use client';
import { useState } from 'react';
import { useConference } from '@/lib/context';
import { QrCode } from '@/components/operations/submission-links';
import { Chip, PageHeading, Panel } from '@/components/ui';
const url = (token: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/amend/${token}`;
function newToken() { const bytes = crypto.getRandomValues(new Uint8Array(24)); return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function Copy({ token }: { token: string }) {
  const [message, setMessage] = useState('Copy link');
  return <div className="link-field"><input aria-label="Amendment submission link" readOnly value={url(token)} onFocus={event => event.target.select()} /><button onClick={() => void navigator.clipboard.writeText(url(token)).then(() => setMessage('Copied'), () => setMessage('Select and copy the link'))}>{message}</button></div>;
}
export function AmendmentQrPanel({ committeeId }: { committeeId: string }) {
  const { data } = useConference(); const committee = data.committees.find(c => c.id === committeeId); const link = data.amendmentLinks?.find(l => l.committeeId === committeeId);
  if (!committee) return null;
  return <Panel title={`${committee.code} amendment QR`} subtitle="A separate room QR for amendments to the current resolution in debate. No delegate account needed.">{link ? <div className="submission-panel"><QrCode value={url(link.token)} label={`${committee.code} amendment QR`} /><div><Copy token={link.token} /><div className="actions"><a className="button" href={`/amend/${link.token}/sheet`} target="_blank" rel="noreferrer">Print amendment sheet</a><a className="button" href={`/amend/${link.token}`} target="_blank" rel="noreferrer">Open amendment form</a></div><p className="muted">Keep this QR in your committee room. It stays the same when the resolution changes.</p></div></div> : <p className="panel-body">The Executive can create this QR in Amendment links.</p>}</Panel>;
}
export function AmendmentLinks() {
  const { data, act } = useConference(); const links = data.amendmentLinks ?? []; const committees = data.committees.filter(c => !c.archived);
  const save = (committeeId: string, action: 'create' | 'rotate' | 'revoke') => act({ type: 'amendmentLink', committeeId, action, ...(action === 'revoke' ? {} : { token: newToken() }) }, 'admin');
  const missing = committees.filter(c => !links.some(l => l.committeeId === c.id));
  return <><PageHeading eyebrow="EXECUTIVE" title="Amendment links" description="Separate static QR codes for proposed amendments. These never replace resolution-submission links." action={missing.length ? <button className="primary" onClick={() => void (async () => { for (const c of missing) if (!await save(c.id, 'create')) break; })()}>Create {missing.length} missing link{missing.length === 1 ? '' : 's'}</button> : undefined} /><Panel title="Committee amendment links" subtitle="Rotating or turning off a link invalidates the old QR. Delegates only see their committee, current resolution and delegation list."><div className="table-scroll"><table><thead><tr><th>Committee</th><th>Status</th><th>Link</th><th>Actions</th></tr></thead><tbody>{committees.map(c => { const link = links.find(l => l.committeeId === c.id); return <tr key={c.id}><td><strong>{c.code}</strong><div>{c.name}</div></td><td><Chip tone={link ? 'green' : 'neutral'}>{link ? 'Active' : 'Off'}</Chip></td><td>{link ? <Copy token={link.token} /> : '—'}</td><td><div className="actions">{link ? <><a className="button" href={`/amend/${link.token}/sheet`} target="_blank" rel="noreferrer">Print sheet</a><button onClick={() => window.confirm(`Replace ${c.code} amendment QR? The old link will stop working.`) && void save(c.id, 'rotate')}>Replace</button><button onClick={() => window.confirm(`Turn off amendment submissions for ${c.code}?`) && void save(c.id, 'revoke')}>Turn off</button></> : <button onClick={() => void save(c.id, 'create')}>Create link</button>}</div></td></tr>; })}</tbody></table></div><p className="footnote">The form opens only while a resolution is In Debate. The Chair reviews each submission; passed amendments are applied to the working Google Doc manually. Local demo QR management does not submit to a live conference.</p></Panel></>;
}
