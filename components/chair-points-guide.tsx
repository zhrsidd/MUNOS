"use client";

import type { ConferenceData } from "@/lib/domain";
import { scoringValues } from "@/lib/scoring";

/** A read-only reference; the same committee settings drive the scoring buttons. */
export function ChairPointsGuide({ data, committeeId }: {
  data: Pick<ConferenceData, "scoring" | "committees">;
  committeeId: string;
}) {
  const points = (id: string) => scoringValues(data, committeeId, id).join(" / ");
  return (
    <aside className="chair-points-guide" aria-label="Committee points reference">
      <details>
        <summary>Points guide</summary>
        <dl>
          <div><dt>Speech</dt><dd>{points("speech")}</dd></div>
          <div><dt>POI</dt><dd>{points("poi")}</dd></div>
          <div><dt>Main Submitter</dt><dd>{points("submitter")}</dd></div>
          <div><dt>Debated amendment</dt><dd>{points("amendment")}</dd></div>
        </dl>
        <p>Main Submitter credit is automatic once per resolution, on their first scored speech.</p>
        <p>Amendment credit: award in Participation.</p>
      </details>
    </aside>
  );
}
