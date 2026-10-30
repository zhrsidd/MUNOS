import type { Committee } from "./domain";
import type { StaffAccess } from "./access";
import type { DurableStore } from "./sync/store";

export const loadingScreenFeatureKey = (committeeId: string) => `committeeLoadingScreen:${committeeId}`;

export async function readLoadingCommittee(
  store: Pick<DurableStore, "read" | "readPreferences">,
  conferenceId: string | undefined,
  access: StaffAccess,
): Promise<Committee | null> {
  if (!conferenceId || access.status !== "active" || !access.actorId || !access.roles.includes("chair") ||
      !Number.isFinite(access.validUntil) || (access.validUntil ?? 0) <= Date.now()) return null;
  try {
    const [checkpoint, context] = await Promise.all([
      store.read(`supabase:${conferenceId}:${access.actorId}`),
      store.readPreferences(`context:${conferenceId}`),
    ]);
    const data = checkpoint?.base;
    if (!data || data.conference.id !== conferenceId) return null;
    const id = access.committeeIds.length === 1 ? access.committeeIds[0] : context?.committeeId;
    if (!id || !access.committeeIds.includes(id) || data.conference.features[loadingScreenFeatureKey(id)] !== true) return null;
    return data.committees.find(c => c.id === id && !c.archived) ?? null;
  } catch {
    // Optional decoration must never interrupt the real startup or recovery flow.
    return null;
  }
}
