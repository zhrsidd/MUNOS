"use client";
import { useConference } from "@/lib/context";
import type { Delegate } from "@/lib/domain";
import { pointsLeaderboard } from "@/lib/participation-view";
import { Panel } from "./ui";

export function PointsLeaderboard({ delegates }: { delegates: Delegate[] }) {
  const { data } = useConference();
  const rows = pointsLeaderboard(data, delegates);
  return <Panel title="Points leaderboard" subtitle="Conference totals · every delegation">
    {rows.length ? <ol className="points-leaderboard" aria-label="Delegation points, highest first · conference totals" tabIndex={0}>
      {rows.map(({ delegate, points }) => <li key={delegate.id}>
        <span aria-hidden="true">{delegate.flag}</span><span>{delegate.country}</span>
        <strong>{points}<span className="sr-only"> points</span></strong>
      </li>)}
    </ol> : <p className="muted">No delegations in this committee yet.</p>}
  </Panel>;
}
