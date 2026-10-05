import type { Metadata } from "next";
import { headers } from "next/headers";
import { renderSVG } from "uqr";
import { findLink } from "@/lib/submissions/link-info";
import { PrintButton } from "@/components/operations/print-button";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Committee submission sheet · DCMUN", robots: { index: false, follow: false }, referrer: "no-referrer" };
// Printable A4 room sheet: committee name, QR code, link and three-step instructions.
export default async function SubmissionSheet({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await findLink(token);
  if (!link || link === "unavailable") return <main className="submit-page"><section className="submit-card"><h1>This submission link is not valid</h1></section></main>;
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}/submit/${token}`;
  return (
    <main className="room-sheet">
      <div className="eyebrow">{link.conferenceName}</div>
      <h1>{link.committeeCode} resolution submission</h1>
      <h2>{link.committeeName}</h2>
      <div className="room-sheet-qr" dangerouslySetInnerHTML={{ __html: renderSVG(url, { ecc: "M", border: 2 }) }} />
      <ol>
        <li>Scan the QR code with your phone camera.</li>
        <li>Choose your country, enter the title, attach the PDF or Word file.</li>
        <li>Tap <b>Submit</b>. Keep the reference number you receive.</li>
      </ol>
      <p className="room-sheet-url">{url}</p>
      <p>Only the main submitter submits. No email to the Chair is needed — the Approval Panel receives it automatically.{link.contact && <> Problems? Contact {link.contact}.</>}</p>
      <PrintButton />
    </main>
  );
}
