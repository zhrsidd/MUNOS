import { BRAND, PLATFORM } from "@/lib/brand";
import { MunosMark } from "./munos-mark";

/** The About text, shared by the public /about page and the loading screen's About panel. */
export function AboutContent({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as const;
  return (
    <>
      <p>
        The conference operations system for {BRAND.conferenceName} ({BRAND.conference}): roll call, debate and
        participation, resolutions submitted as Google Docs, Approval review and printing, amendments, voting, group
        photo reminders and system health in one place. Work is saved on each device first, so it keeps working through
        connection problems.
      </p>
      <H>Platform</H>
      <p className="about-powered">
        Powered by <MunosMark size={32} /> <strong>{PLATFORM.name}</strong>
      </p>
      <p>
        {PLATFORM.fullName}, created by{" "}
        <a href={PLATFORM.creatorUrl} target="_blank" rel="noopener noreferrer">
          {PLATFORM.creator}
        </a>{" "}
        (LinkedIn).
      </p>
      <H>Credits</H>
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
    </>
  );
}
