import {batchFingerprint} from '../batch/commands';
import {isBatchCommand} from '../batch/types';
import {operationsFingerprint} from "../operations/fingerprint";
import {isOperationsCommand} from "../operations/commands";
import type { ConferenceData, Role } from "../domain";
import { applyCommand, type Command, type ConferenceRepository } from "../commands";
import { DurableStore, type Checkpoint, type Mutation } from "./store";
export interface Transport {
  actorId: string;
  read(): Promise<ConferenceData>;
  send(mutation: Mutation): Promise<void>;
  subscribe?(refresh: () => void, state: (connected: boolean) => void): () => void;
}
export class ConflictError extends Error {}
export interface Health {
  mode: "local" | "supabase"; state: "saved" | "syncing" | "waiting" | "conflict" | "error";
  pending: number; conflicts: number; realtime: boolean; latency: number | null;
  message: string; detail: string; actorId?: string; lastSynced?: string;
}
export function fingerprint(data: ConferenceData, c: Command): string | null {
  if(isBatchCommand(c))return batchFingerprint(data,c);
  switch (c.type) {
    case "staffContact": return String(data.staff.find(s=>s.id===c.id)?.contactRevision ?? 1);
    case "currentSession": return String(data.committees.find(x=>x.id===c.committeeId)?.sessionRevision??0);
    case "debateMode": return String(data.debateStates?.find(x=>x.sessionId===c.sessionId)?.revision??0);
    case "queueOrder": return data.queue.filter(q=>q.sessionId===c.sessionId&&(q.lane??"open")===c.lane).sort((a,b)=>a.position-b.position).map(q=>q.id).join(",");
    case "poiOrder": return (data.poiQueue??[]).filter(q=>q.speechId===c.speechId).sort((a,b)=>a.position-b.position).map(q=>q.id).join(",");
    case "speechStart": return data.speeches?.find(s=>s.sessionId===c.sessionId&&s.state!=="finished")?.id??"empty";
    case "speechYield": case "speechFinish": case "poiAllowance": case "poiRecognize": case "poiScore": case "poiRemove": return String(data.speeches?.find(s=>s.id===c.speechId)?.revision??0);
    case "voteMode": return String(data.documents.find(r=>r.id===c.resolutionId)?.revision??0);
    case "attendance": return String(data.attendance.find(a => a.delegateId === c.delegateId && a.sessionId === c.sessionId)?.revision ?? 0);
    case "queue": return c.advance ? data.queue.filter(q => q.sessionId === c.sessionId).sort((a,b) => a.position-b.position)[0]?.id ?? "empty" : null;
    case "event": return String(data.events.find(e=>e.id===c.id)?.revision ?? 0);
    case "timer": return String(data.timers[c.sessionId]?.revision ?? 0);
    case "document": case "version": return String(data.documents.find(d=>d.id===c.id)?.revision ?? 0);
    case "vote": return String(data.votes.find(v=>v.delegateId===c.delegateId && v.sessionId===c.sessionId && v.resolutionId===c.resolutionId)?.revision ?? 0);
    default: return isOperationsCommand(c)?operationsFingerprint(data,c):null;
  }
}
export function project(checkpoint: Checkpoint): ConferenceData {
  return checkpoint.pending.reduce((data,m) => {
    if (m.state === "conflict") return data;
    try { return applyCommand(data, m.command, m.role, m); } catch { return data; }
  }, checkpoint.base);
}
export class DurableRepository implements ConferenceRepository {
  private data: ConferenceData | null = null;
  private checkpoint?: Checkpoint;
  private listeners = new Set<() => void>();
  private initialized = false;
  private flushing = false;
  private channel?: BroadcastChannel;
  private stopLive?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  health: Health;
  constructor(public readonly key: string, private seed: () => ConferenceData, private store = new DurableStore(), private transport?: Transport, detail = "") {
    this.health = { mode: transport ? "supabase" : "local", state: "saved", pending: 0, conflicts: 0, realtime: false, latency: null, message: "Preparing durable storage…", detail, actorId: transport?.actorId };
  }
  getSnapshot = () => this.data;
  getHealth = () => this.health;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(l=>l()); }
  private publish(checkpoint: Checkpoint) {
    this.checkpoint = checkpoint; this.data = project(checkpoint);
    const conflicts = checkpoint.pending.filter(m=>m.state==="conflict").length;
    this.health = { ...this.health, pending: checkpoint.pending.length, conflicts,
      state: conflicts ? "conflict" : checkpoint.pending.length ? "waiting" : "saved",
      message: conflicts ? `${conflicts} ${conflicts === 1 ? "change needs" : "changes need"} review in System health. Your changes are retained.` : checkpoint.pending.length ? "Saved on this device — waiting for connection" : this.transport ? "Synced" : "Saved on this device · local demo" };
    this.emit();
  }
  initialize = () => { void this.ready().catch(e=>{ this.health={...this.health,state:"error",message:"Device storage is unavailable. Changes cannot be saved.",detail:String(e)}; this.emit(); }); };
  async ready() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.publish(await this.store.update(this.key, old=> old ?? {key:this.key,base:this.seed(),pending:[],savedAt:new Date().toISOString()}));
    } catch (error) { this.initialized=false; throw error; }
    if (typeof window !== "undefined") {
      this.channel = new BroadcastChannel(`conference:${this.key}`);
      this.channel.onmessage = () => { void this.reload().then(()=>{ if(this.checkpoint?.pending.length) this.retry(); }); };
      window.addEventListener("online", this.retry);
      window.addEventListener("focus", this.retry);
      this.stopLive = this.transport?.subscribe?.(this.retry, connected=>{
        this.health={...this.health,realtime:connected}; this.emit();
        if(connected) this.retry();
      });
    }
    if (this.transport) void this.flush();
  }
  private async reload() { const latest=await this.store.read(this.key); if(latest) this.publish(latest); }
  execute = async (command: Command, role: Role) => {
    if (!this.data) throw Error("Workspace is still loading.");
    // A transaction commits before any optimistic state or successful-save message is visible.
    const mutation: Mutation={id:crypto.randomUUID(),createdAt:new Date().toISOString(),actorId:this.transport?.actorId ?? `${role}-demo`,role,command,expected:fingerprint(this.data,command),state:"pending"};
    this.publish(await this.store.update(this.key, old=>{
      if(!old) throw Error("Workspace unavailable. Reload before continuing.");
      const current=project(old);
      if(fingerprint(current,command)!==mutation.expected) throw Error("Another tab updated this item. Review the current value and try again.");
      const next=applyCommand(current,command,role,mutation);
      return this.transport ? {...old,pending:[...old.pending,mutation],savedAt:mutation.createdAt} : {...old,base:next,savedAt:mutation.createdAt};
    }));
    this.channel?.postMessage("saved");
    void this.flush();
  };
  private schedule() {
    clearTimeout(this.retryTimer);
    if(!this.transport) return;
    const delay=this.attempts ? Math.min(60000,1000*2**Math.min(this.attempts,6)) : 60000;
    this.retryTimer=setTimeout(this.retry,delay+Math.random()*1000);
  }
  retry = () => { void this.flush(); };
  async flush() {
    if (!this.transport || this.flushing) return;
    this.flushing=true;
    const sync = async () => {
      await this.reload();
      this.health={...this.health,state:"syncing",message:"Syncing…"}; this.emit();
      // Stop at a conflict, preserving subsequent intent until an operator resolves it.
      let item=this.checkpoint?.pending[0];
      let readBackCompleted=false;
      while(item && item.state!=="conflict") {
        try { await this.transport!.send(item); }
        catch(error) {
          if(error instanceof ConflictError) {
            this.publish(await this.store.update(this.key,old=>({...old!,pending:old!.pending.map(m=>m.id===item!.id?{...m,state:"conflict",message:error.message}:m)})));
          }
          throw error;
        }
        // A lost response or refresh before this transaction retries the SAME UUID at the server.
        const start=performance.now(); const base=await this.transport!.read();
        this.health={...this.health,latency:Math.round(performance.now()-start),lastSynced:new Date().toISOString()};
        this.publish(await this.store.update(this.key,old=>({...old!,base,pending:old!.pending.filter(m=>m.id!==item!.id),savedAt:new Date().toISOString()})));
        readBackCompleted=true;
        item=this.checkpoint?.pending[0];
      }
      // The last acknowledged mutation already read back and persisted the server snapshot.
      // Empty-outbox polling and an existing conflict still reconcile as before.
      if(!readBackCompleted || item) {
        const start=performance.now(); const base=await this.transport!.read();
        this.health={...this.health,latency:Math.round(performance.now()-start),lastSynced:new Date().toISOString()};
        this.publish(await this.store.update(this.key,old=>({...old!,base})));
      }
      this.attempts=0; this.channel?.postMessage("synced");
    };
    try {
      if(typeof navigator!=="undefined" && navigator.locks) await navigator.locks.request(`sync:${this.key}`,sync);
      else await sync(); // Server idempotency still protects duplicate sends across tabs.
    } catch(error) {
      this.attempts++;
      this.health={...this.health,state:this.health.conflicts?"conflict":"waiting",message:this.health.conflicts?"Changes need review in System health.":this.health.pending?"Saved on this device — waiting for connection":"Connection unavailable. Showing the last saved conference.",detail:error instanceof ConflictError?error.message:"Connection interrupted. Automatic retry is enabled."}; this.emit();
    } finally {this.flushing=false;this.schedule();}
  }
  async exportRecovery() { return JSON.stringify(await this.store.read(this.key),null,2); }
  getPending() {return this.checkpoint?.pending ?? [];}
  async resolveConflict(id: string) {
    // Explicitly dismiss only after organizer exports/reviews it. Never auto-rebase conflicting attendance.
    this.publish(await this.store.update(this.key,old=>({...old!,pending:old!.pending.filter(m=>m.id!==id || m.state!=="conflict")})));
    this.channel?.postMessage("saved"); this.retry();
  }
  reset = () => { if(this.transport) throw Error("Cloud conference reset is disabled."); void this.store.update(this.key,()=>({key:this.key,base:this.seed(),pending:[],savedAt:new Date().toISOString()})).then(c=>{this.publish(c);this.channel?.postMessage("saved");}); };
  dispose() {clearTimeout(this.retryTimer);this.channel?.close();this.stopLive?.(); if(typeof window!=="undefined"){window.removeEventListener("online",this.retry);window.removeEventListener("focus",this.retry);} }
}
