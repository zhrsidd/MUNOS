import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ConferenceData, Role } from "../domain";
import type { Command } from "../commands";
export interface Mutation {
  id: string; createdAt: string; actorId: string; role: Role; command: Command;
  expected: string | null; state: "pending" | "conflict"; message?: string;
  /**
   * Device protocol (docs/SESSION_MODEL.md sections 4 and 5), assigned when the action is saved: a stable id for this browser profile,
   * a number that only grows on this device (it orders actions without trusting the clock), and the session this device was
   * displaying (null = "no session"; absent = unknown). Sent with the action as command._device. Absent on actions saved by older builds.
   */
  deviceId?: string; deviceSeq?: number; displayedLabel?: string | null;
}
export interface Checkpoint { key: string; base: ConferenceData; pending: Mutation[]; savedAt: string; }
interface Database extends DBSchema { workspaces: { key: string; value: Checkpoint }; preferences: { key: string; value: Record<string,string> }; }
export class DurableStore {
  private db?: Promise<IDBPDatabase<Database>>;
  constructor(private name = "conference-os-v3") {}
  private open() {
    return this.db ??= openDB<Database>(this.name, 2, { upgrade(db) { if(!db.objectStoreNames.contains("workspaces"))db.createObjectStore("workspaces", { keyPath: "key" }); if(!db.objectStoreNames.contains("preferences"))db.createObjectStore("preferences"); }, blocking: () => {void this.db?.then(db=>db.close());} });
  }
  async read(key: string) { return (await this.open()).get("workspaces", key); }
  async update(key: string, change: (old?: Checkpoint) => Checkpoint) {
    const db = await this.open();
    const tx = db.transaction("workspaces", "readwrite");
    try {
      const next = change(await tx.store.get(key));
      await tx.store.put(next);
      await tx.done;
      return next;
    } catch (error) {
      try { tx.abort(); } catch {}
      // A rejected save has two promises: its request and the transaction. Consume the abort too, while preserving the
      // original save error for the caller; otherwise a handled stale-tab refusal emits an unhandled AbortError.
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
  /** This browser profile's device id and the next sequence number, allocated atomically across tabs. */
  async nextDeviceSeq(): Promise<{ deviceId: string; deviceSeq: number }> {
    const tx = (await this.open()).transaction("preferences", "readwrite");
    const current = (await tx.store.get("device")) ?? {};
    const deviceId = current.deviceId || crypto.randomUUID();
    const deviceSeq = (Number(current.deviceSeq) || 0) + 1;
    await tx.store.put({ ...current, deviceId, deviceSeq: String(deviceSeq) }, "device");
    await tx.done;
    return { deviceId, deviceSeq };
  }
  /** The device id alone (created if this profile has none), without consuming a sequence number. */
  async deviceId(): Promise<string> {
    const tx = (await this.open()).transaction("preferences", "readwrite");
    const current = (await tx.store.get("device")) ?? {};
    const deviceId = current.deviceId || crypto.randomUUID();
    if (!current.deviceId) await tx.store.put({ ...current, deviceId }, "device");
    await tx.done;
    return deviceId;
  }
  async readPreferences(key: string) { return (await this.open()).get("preferences", key); }
  async savePreferences(key: string, values: Record<string,string>) {
    const tx=(await this.open()).transaction("preferences","readwrite");
    await tx.store.put({...await tx.store.get(key),...values},key);await tx.done;
  }
  async pruneConfirmedCaches() {
    const tx=(await this.open()).transaction("workspaces","readwrite");
    let cursor=await tx.store.openCursor();
    while(cursor){
      if(cursor.key.startsWith('supabase:') && !cursor.value.pending.length && Date.now()-Date.parse(cursor.value.savedAt)>7*86400000)await cursor.delete();
      cursor=await cursor.continue();
    }
    await tx.done;
  }
  async close() { if (this.db) (await this.db).close(); this.db = undefined; }
}
