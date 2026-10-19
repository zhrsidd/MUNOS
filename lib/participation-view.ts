import type { ConferenceData, Delegate, ParticipationEvent } from "./domain";

export const isContribution = (event: Pick<ParticipationEvent, "categoryId" | "voidedAt">) =>
  !event.voidedAt && event.categoryId !== "submitter";

export function contributionCount(events: ParticipationEvent[]) {
  return new Set(events.filter(isContribution).map(event => event.id)).size;
}

export const delegationOrder = (a: Delegate, b: Delegate) =>
  a.country.localeCompare(b.country, "en") || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");

/** Conference-wide net points, including deductions/restores and absent delegations. */
export function pointsLeaderboard(data: Pick<ConferenceData, "events" | "pointAdjustments">, delegates: Delegate[]) {
  const points = new Map(delegates.map(d => [d.id, 0]));
  for (const e of data.events) if (!e.voidedAt && points.has(e.delegateId)) points.set(e.delegateId, points.get(e.delegateId)! + e.points);
  for (const a of data.pointAdjustments ?? []) if (points.has(a.delegateId)) points.set(a.delegateId, points.get(a.delegateId)! + a.points);
  return delegates.map(delegate => ({ delegate, points: points.get(delegate.id)! }))
    .sort((a, b) => b.points - a.points || delegationOrder(a.delegate, b.delegate));
}
