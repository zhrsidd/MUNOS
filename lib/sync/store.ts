import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ConferenceData, Role } from "../domain";
import type { Command } from "../commands";
export interface Mutation {
  id: string; createdAt: string; actorId: string; role: Role; command: Command;
  expected: string | null; state: "pending" | "conflict"; message?: string;
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
    } catch (error) { try { tx.abort(); } catch {} throw error; }
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
