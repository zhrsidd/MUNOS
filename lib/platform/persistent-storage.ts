import type { StaffAccess } from "../access";
// Best effort only: asks the browser not to evict this device's IndexedDB (the staff outbox) under storage
// pressure. Never required for correctness, never blocks, never retried in a loop, never asked on public pages.
type StorageManagerLike = Pick<StorageManager, "persist"> & Partial<Pick<StorageManager, "persisted">>;
export function persistentStorageRequester(storage: () => StorageManagerLike | undefined) {
  let requested = false;
  return async function requestFor(access: Pick<StaffAccess, "status">): Promise<boolean | undefined> {
    if (access.status !== "active" || requested) return undefined;
    requested = true;
    try {
      const manager = storage();
      if (!manager?.persist) return undefined;
      if (await manager.persisted?.()) return true;
      return await manager.persist();
    } catch {
      return false;
    }
  };
}
/** One request per page load, once staff access is active. */
export const requestPersistentStorage = persistentStorageRequester(() => (typeof navigator === "undefined" ? undefined : navigator.storage));
