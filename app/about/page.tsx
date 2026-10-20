import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND, PLATFORM } from "@/lib/brand";
export const metadata: Metadata = { title: `About · ${BRAND.conference} ${BRAND.product}` };
/** Public: no staff session or device storage (components/conference-shell.tsx). Reached from every workspace footer. */
export default function AboutPage() {
  return (
    <main className="about-page">
      <section className="panel about-card" aria-labelledby="about-title">
        <Image src={BRAND.logo} alt={BRAND.logoAlt} width={96} height={96} className="about-logo" />
        <p className="eyebrow">About</p>
        <h1 id="about-title">
          {BRAND.conference} {BRAND.product}
        </h1>
        <p>
          The conference operations system for {BRAND.conferenceName} ({BRAND.conference}): roll call, debate and
          participation, resolutions submitted as Google Docs, Approval review and printing, amendments, voting, group
          photo reminders and system health in one place. Work is saved on each device first, so it keeps working through
          connection problems.
        </p>
        <h2>Platform</h2>
        <p>
          Powered by <strong>{PLATFORM.name}</strong>, created by{" "}
          <a href={PLATFORM.creatorUrl} target="_blank" rel="noopener noreferrer">
            {PLATFORM.creator}
          </a>{" "}
          (LinkedIn).
        </p>
        <h2>Credits</h2>
        <ul className="about-credits">
          <li>
            <a href={PLATFORM.creatorUrl} target="_blank" rel="noopener noreferrer">
              {PLATFORM.creator}
            </a>{" "}
            — Creator
          </li>
          {PLATFORM.contributors.map((c) => (
            <li key={c.name}>
              <a href={c.url} target="_blank" rel="noopener noreferrer">
                {c.name}
              </a>{" "}
              — {c.role}
            </li>
          ))}
        </ul>
        <p className="small">
          {PLATFORM.copyright} {PLATFORM.name} is proprietary software, provided to {BRAND.conference} for this conference.
        </p>
        <p className="small muted">
          The {BRAND.conference} name and seal belong to {BRAND.conferenceName} and are used to identify the conference; they
          are not part of {PLATFORM.name}. {PLATFORM.name} includes open-source components that remain under their own
          licences (including Next.js, React, Supabase client libraries and the DM Sans and Manrope fonts under the SIL Open
          Font License).
        </p>
        <p>
          <Link href="/">Back to {BRAND.product}</Link>
        </p>
      </section>
    </main>
  );
}
