'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { AMENDMENT_TYPES, MAX_CLAUSE, MAX_WORDING, amendmentMessages, type AmendmentLinkInfo, type AmendmentResponse } from '@/lib/amendments/rules';
const subscribeNever = () => () => {};
/** False in server HTML and until React hydrates; true once submit() is attached. */
const useHydrated = () => useSyncExternalStore(subscribeNever, () => true, () => false);
export function AmendmentForm({ token, link }: { token: string; link: AmendmentLinkInfo }) {
  const hydrated = useHydrated();
  const [submissionId, setSubmissionId] = useState('');
  const pendingBody = useRef<Record<string, unknown> | null>(null);
  const [sending, setSending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<AmendmentResponse | null>(null);
  if (!link.resolution) return <section className="submit-card"><h1>Amendments are not currently open in this committee.</h1><p>{link.committee.code} · {link.committee.name}</p><p>Wait for your Chair to open a resolution for debate, then reload this page.</p><button onClick={() => window.location.reload()}>Check again</button></section>;
  if (result?.ok) return <section className="submit-card success" role="status"><div className="eyebrow">{link.committee.code}</div><h1>Amendment received</h1><p>Your Chair will review it for {link.resolution.code}.</p><p>Reference: <strong>{result.id}</strong></p><p>Keep this reference. Your amendment does not change the working Google Doc automatically.</p><button onClick={() => window.location.reload()}>Submit another amendment</button></section>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reference = submissionId || crypto.randomUUID();
    setSubmissionId(reference);
    const body = pendingBody.current ?? { token, submissionId: reference, resolutionId: link.resolution!.id, submitterId: form.get('submitterId'), type: form.get('type'), clause: form.get('clause'), wording: form.get('wording'), confirmed: form.get('confirmed') === 'on' };
    pendingBody.current = body;
    setSending(true); setAttempted(true); setResult(null);
    try {
      const response = await fetch('/api/amendments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      const received = await response.json() as AmendmentResponse;
      setResult(received);
      // Definitive pre-commit validation failures permit correction; ambiguous failures keep intent frozen.
      if (!received.ok && ['invalid_amendment', 'invalid_submitter', 'rate_limited'].includes(received.error)) { setAttempted(false); pendingBody.current = null; }
    } catch { setResult({ ok: false, error: 'server_error', message: amendmentMessages.server_error }); }
    finally { setSending(false); }
  }
  return <section className="submit-card"><div className="eyebrow">{link.committee.code} · Submit an amendment</div><h1>{link.resolution.code}</h1><p>{link.resolution.title}</p><form method="post" onSubmit={submit}>
    {/* Until hydration a native submit would reload the page and (as GET) put the wording in the URL; method="post" is a backstop. */}
    <fieldset disabled={attempted || !hydrated} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1rem' }}>
      <label>Delegation / country<select name="submitterId" required defaultValue=""><option value="" disabled>Choose your delegation</option>{link.delegates.map(d => <option key={d.id} value={d.id}>{d.country}</option>)}</select></label>
      <label>Amendment type<select name="type" defaultValue="Add">{AMENDMENT_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <label>Clause / reference<input name="clause" required maxLength={MAX_CLAUSE} placeholder="e.g. Operative clause 4" /></label>
      <label>Exact proposed wording<textarea name="wording" required maxLength={MAX_WORDING} rows={7} placeholder="For Strike, quote the exact wording to remove." /></label>
      <label className="submit-check"><input type="checkbox" name="confirmed" required />I confirm this is the exact wording I want submitted.</label>
    </fieldset>
    {result && !result.ok && <p className="error" role="alert">{result.message}</p>}
    {attempted && <p className="muted">Your details are held unchanged for safe retry. If debate has moved on or you need to change them, check this reference with your Chair first: {submissionId}</p>}
    <button className="primary" type="submit" disabled={sending || !hydrated}>{!hydrated ? 'Loading form…' : sending ? 'Submitting…' : attempted ? 'Retry same amendment' : 'Submit amendment'}</button>
    {!hydrated && <p className="muted" role="status">If this form does not load, ask your Chair how to submit your amendment.</p>}
    <noscript><p className="error" role="alert">This form needs JavaScript to submit. Ask your Chair how to submit your amendment.</p></noscript>
  </form><p className="muted">No account or Google Doc required. Only your committee and current resolution are shown here.</p></section>;
}
