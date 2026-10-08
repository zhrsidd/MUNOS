import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { renderSVG } from 'uqr';
import { findAmendmentLink } from '@/lib/amendments/backend';
import { PrintButton } from '@/components/operations/print-button';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Amendment QR · DCMUN', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function AmendmentSheet({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const link = await findAmendmentLink(token);
  if (!link || link === 'unavailable') return <main className="submit-page"><section className="submit-card"><h1>Amendment QR unavailable</h1><p>Ask the Executive to check this committee link.</p></section></main>;
  const h = await headers(); const url = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}/amend/${token}`;
  return <main className="room-sheet"><div className="eyebrow">DCMUN</div><h1>{link.committee.code} · Submit an amendment</h1><h2>{link.committee.name}</h2><div className="room-sheet-qr" dangerouslySetInnerHTML={{ __html: renderSVG(url, { ecc: 'M', border: 2 }) }} /><ol><li>Scan this QR when your resolution is in debate.</li><li>Choose your delegation and Add, Strike or Replace.</li><li>Enter the clause and exact wording, confirm, then submit.</li></ol><p>No account or Google Doc required. The form always shows the current resolution.</p><p className="room-sheet-url">{url}</p><PrintButton /></main>;
}
