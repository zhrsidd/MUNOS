import {batchFingerprint} from '../batch/commands';
import {isBatchCommand} from '../batch/types';
import {operationsFingerprint} from "../operations/fingerprint";
import {isOperationsCommand,serverOnlyCommandTypes} from "../operations/commands";
import type { ConferenceData, Role } from "../domain";
import { applyCommand, normalizeCommand, type Command, type ConferenceRepository } from "../commands";
import { DurableStore, type Checkpoint, type Mutation } from "./store";
import { committeeOfCommand, displayedLabel } from "../sessions/display";
import { isLive } from "../sessions/presence";
import { BLOCKED_REFRESH_GAP_MS, MAX_BATCH, MIN_REFRESH_GAP_MS, classifyError, errorCode, pollDelay, retryDelay, type ErrorKind } from "./backoff";
export interface Transport {
  actorId: string;
  read(): Promise<ConferenceData>;
  send(mutation: Mutation): Promise<void>;
  /** Report this device's clock to the server (offset = device time - server time). Best effort; never blocks sending. */
  syncClock?(deviceId: string): Promise<void>;
  subscribe?(refresh: () => void, state: (connected: boolean) => void): () => void;
}
export class ConflictError extends Error {}
/** At most one clock report per page session per minute (the server also limits one stored row per device per minute). */
const CLOCK_SYNC_GAP_MS = 60_000;
/** How long sending waits for a clock report before it carries on without it. */
export const CLOCK_SYNC_DEADLINE_MS = 3_000;
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Clock report timed out")), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
export interface Health {
  mode: "local" | "supabase"; state: "saved" | "syncing" | "waiting" | "conflict" | "error";
  pending: number; conflicts: number; realtime: boolean; latency: number | null;
  message: string; detail: string; actorId?: string; lastSynced?: string;
  /** Diagnostics only (System health → Technical details): never changes what is saved or sent. */
  errorKind?: ErrorKind; errorCode?: string;
  /** Automatic-retry attempt number and when the next attempt is due, while a sync is failing. */
  retryAttempt?: number; retryAt?: string;
  /** Actions the server has accepted that this device has not yet confirmed with a snapshot read. */
  awaitingConfirmation?: number;
}
export function fingerprint(data: ConferenceData, c: Command): string | null {
  if(isBatchCommand(c))return batchFingerprint(data,c);
  // Live state is keyed by committee (an older saved action names a session, which identifies the committee).
  const cid=committeeOfCommand(data,c)??"";
  switch (c.type) {
    case "staffContact": return String(data.staff.find(s=>s.id===c.id)?.contactRevision ?? 1);
    case "debateMode": return String(data.debateStates?.find(x=>isLive(x,cid))?.revision??0);
    case "queueOrder": return data.queue.filter(q=>isLive(q,cid)&&(q.lane??"open")===c.lane).sort((a,b)=>a.position-b.position).map(q=>q.id).join(",");
    case "poiOrder": return (data.poiQueue??[]).filter(q=>q.speechId===c.speechId).sort((a,b)=>a.position-b.position).map(q=>q.id).join(",");
    case "speechStart": return data.speeches?.find(s=>isLive(s,cid)&&s.state!=="finished")?.id??"empty";
    case "speechYield": case "speechFinish": case "poiAllowance": case "poiRecognize": case "poiScore": case "poiRemove": return String(data.speeches?.find(s=>s.id===c.speechId)?.revision??0);
    case "voteMode": return String(data.documents.find(r=>r.id===c.resolutionId)?.revision??0);
    case "queue": return c.advance ? data.queue.filter(q => isLive(q,cid)).sort((a,b) => a.position-b.position)[0]?.id ?? "empty" : null;
    case "event": return String(data.events.find(e=>e.id===c.id)?.revision ?? 0);
    // A clear-majority close is bound to the revision the Chair opened it on, not the one current at confirm time.
    case "document": case "version":
      if(c.type==="document"&&c.method==="observed"&&c.status==="Closed"&&c.outcome!=="Withdrawn")return String(c.ballotRevision??"missing");
      return String(data.documents.find(d=>d.id===c.id)?.revision ?? 0);
    case "vote": return String(data.votes.find(v=>v.delegateId===c.delegateId && !v.sessionId && v.resolutionId===c.resolutionId)?.revision ?? 0);
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
  private lastKind: ErrorKind = "other";
  // Actions the server acknowledged in this page session. They stay in the durable outbox until a snapshot confirms them,
  // but are not sent again, so a failed read-back no longer replays the whole queue. Lost on reload: replay is then idempotent.
  private acked = new Set<string>();
  private disposed = false;
  // Coalescing only applies after THIS page session has completed a sync: the first read after opening is never skipped.
  private hasSynced = false;
  private lastReadAt = 0;
  private lastClockSync = 0;
  private deferTimer?: ReturnType<typeof setTimeout>;
  private onlineTimer?: ReturnType<typeof setTimeout>;
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
    const awaiting = checkpoint.pending.filter(m=>this.acked.has(m.id)).length;
    this.health = { ...this.health, pending: checkpoint.pending.length, conflicts, awaitingConfirmation: awaiting || undefined,
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
      this.channel.onmessage = () => { void this.reload().then(()=>{ if(this.checkpoint?.pending.length) this.refresh(); }); };
      window.addEventListener("online", this.onOnline);
      window.addEventListener("focus", this.refresh);
      this.stopLive = this.transport?.subscribe?.(this.refresh, connected=>{
        this.health={...this.health,realtime:connected}; this.emit();
        if(connected) this.refresh();
      });
    }
    if (this.transport) void this.flush();
  }
  private async reload() { const latest=await this.store.read(this.key); if(latest) this.publish(latest); }
  execute = async (raw: Command, role: Role) => {
    if (!this.data) throw Error("Workspace is still loading.");
    // The single queue/apply boundary: normalise BEFORE the fingerprint, the local apply and the persisted outbox entry,
    // so the queued JSON, its replay and the server's idempotent retry are identical (a title-less create never reaches SQL).
    const command = normalizeCommand(raw);
    if(!this.transport && serverOnlyCommandTypes.has(command.type)) throw Error("Schedule and review changes are made on the live conference database.");
    // A transaction commits before any optimistic state or successful-save message is visible.
    const mutation: Mutation={id:crypto.randomUUID(),createdAt:new Date().toISOString(),actorId:this.transport?.actorId ?? `${role}-demo`,role,command,expected:fingerprint(this.data,command),state:"pending"};
    // Hosted only: the device protocol block. The sequence is allocated before the transaction, so a refused save leaves a gap, never a repeat.
    if(this.transport) {
      Object.assign(mutation,await this.store.nextDeviceSeq());
      const shown=displayedLabel(this.data,committeeOfCommand(this.data,command),mutation.createdAt);
      if(shown!==undefined) mutation.displayedLabel=shown;
    }
    this.publish(await this.store.update(this.key, old=>{
      if(!old) throw Error("Workspace unavailable. Reload before continuing.");
      const current=project(old);
      if(fingerprint(current,command)!==mutation.expected) throw Error("Another tab updated this item. Review the current value and try again.");
      const next=applyCommand(current,command,role,mutation);
      return this.transport ? {...old,pending:[...old.pending,mutation],savedAt:mutation.createdAt} : {...old,base:next,savedAt:mutation.createdAt};
    }));
    this.channel?.postMessage("saved");
    // While the SERVER is timing out, the durable outbox is sent by the retry timer: a new action must not add another
    // request against a database that is already saturated. Other failures (e.g. no network) cost the server nothing.
    // Behind a conflict nothing can be sent, so a new action must not cost a snapshot read: treat it as a passive refresh.
    if(this.attempts===0 || this.lastKind!=="overload") void this.flush(this.pendingBlocked());
  };
  private schedule() {
    clearTimeout(this.retryTimer);
    if(!this.transport || this.disposed) return;
    const failing=this.attempts>0;
    const delay=failing ? retryDelay(this.attempts,this.lastKind) : pollDelay(this.health.realtime);
    this.retryTimer=setTimeout(failing ? this.retry : this.poll,delay);
    if(failing) { this.health={...this.health,retryAttempt:this.attempts,retryAt:new Date(Date.now()+delay).toISOString()}; this.emit(); }
  }
  /** Explicit attempt: Retry button, conflict dismissal, backoff timer. Always runs. */
  retry = () => { void this.flush(); };
  /** Safety-net timer when healthy. Sends anything waiting; otherwise skips the read if a peer tab just refreshed. */
  private poll = () => { void this.flush(true); };
  /**
   * Passive triggers (focus, Realtime, peer tabs). They never override failure backoff — the retry timer owns recovery
   * — and never re-read within MIN_REFRESH_GAP_MS of a refresh when nothing is waiting to send.
   */
  refresh = () => { if(!this.transport || this.attempts>0) return; void this.flush(true); };
  /** Network returned: retry soon, spread over a few seconds so every device on the Wi-Fi does not reconnect in the same instant. */
  private onOnline = () => {
    if(!this.transport || this.disposed) return;
    this.attempts=0; clearTimeout(this.onlineTimer);
    this.onlineTimer=setTimeout(this.retry,Math.random()*3000);
  };
  /** The oldest queued action is a conflict: every action behind it waits for an operator, so nothing can be sent. */
  private pendingBlocked() { return this.checkpoint?.pending[0]?.state==="conflict"; }
  /**
   * Milliseconds a PASSIVE refresh should still wait (<= 0: go). Never coalesces while there is sendable work. With an empty
   * outbox any tab's refresh counts (persisted time); behind a conflict only this tab's last read counts, over a longer gap,
   * because new local actions also touch the persisted time.
   */
  private refreshWait() {
    const c=this.checkpoint;
    if(!this.hasSynced || !c) return 0;
    if(c.pending.length) return this.pendingBlocked() ? BLOCKED_REFRESH_GAP_MS-(Date.now()-this.lastReadAt) : 0;
    const age=Date.now()-Date.parse(c.savedAt);
    return Number.isFinite(age) ? MIN_REFRESH_GAP_MS-age : 0;
  }
  private deferRefresh() {
    if(this.deferTimer || this.disposed) return;
    // Re-enters through refresh(): a timer set while healthy must not bypass backoff that began after it was armed.
    this.deferTimer=setTimeout(()=>{this.deferTimer=undefined;this.refresh();},Math.max(250,this.refreshWait())+Math.random()*500);
  }
  /** One snapshot read confirms every action in the batch; only those exact actions leave the outbox. */
  private async confirm(batch: Mutation[]) {
    const start=performance.now(); const base=await this.transport!.read();
    this.lastReadAt=Date.now();
    this.health={...this.health,latency:Math.round(performance.now()-start),lastSynced:new Date().toISOString()};
    const ids=new Set(batch.map(m=>m.id));
    this.publish(await this.store.update(this.key,old=>({...old!,base,pending:old!.pending.filter(m=>!ids.has(m.id)),savedAt:new Date().toISOString()})));
    ids.forEach(id=>this.acked.delete(id));
  }
  async flush(passive=false) {
    if (!this.transport || this.flushing) return;
    this.flushing=true;
    let failed=false;
    const sync = async () => {
      await this.reload();
      if(passive && this.refreshWait()>0) { this.deferRefresh(); return; }
      this.health={...this.health,state:"syncing",message:"Syncing…"}; this.emit();
      // Tell the server this device's clock before anything is sent, so what was saved offline can be trusted or held on evidence.
      if(this.transport!.syncClock && Date.now()-this.lastClockSync>CLOCK_SYNC_GAP_MS) {
        this.lastClockSync=Date.now();
        const deviceId=await this.store.deviceId().catch(()=>undefined);
        // Best effort with a deadline: a report that never answers must not hold the sync lock and stop the outbox.
        if(deviceId) await withDeadline(this.transport!.syncClock(deviceId),CLOCK_SYNC_DEADLINE_MS).catch(()=>undefined);
      }
      // Stop at a conflict, preserving subsequent intent until an operator resolves it.
      let settled=false;
      for(;;) {
        // Send up to MAX_BATCH actions in order, then confirm them all with ONE snapshot read. An action the server already
        // acknowledged (this page session) is not sent again, but stays in the outbox until that read succeeds.
        const batch: Mutation[]=[];
        for(const item of this.checkpoint?.pending ?? []) {
          if(item.state==="conflict") break;
          // The cap covers the WHOLE confirmation batch, including actions acknowledged by an earlier failed attempt. Those
          // are an in-order prefix, so they are confirmed before any further action is sent.
          if(batch.length>=MAX_BATCH) break;
          if(!this.acked.has(item.id)) {
            try { await this.transport!.send(item); }
            catch(error) {
              if(error instanceof ConflictError) {
                this.publish(await this.store.update(this.key,old=>({...old!,pending:old!.pending.map(m=>m.id===item.id?{...m,state:"conflict",message:error.message}:m)})));
                // Earlier actions in this batch were accepted; settle them best-effort. The conflict is what is reported.
                if(batch.length) await this.confirm(batch).catch(()=>undefined);
              }
              throw error;
            }
            // A lost response or refresh before the read-back retries the SAME UUID at the server (idempotent).
            this.acked.add(item.id);
            this.health={...this.health,awaitingConfirmation:this.checkpoint!.pending.filter(m=>this.acked.has(m.id)).length||undefined}; this.emit();
          }
          batch.push(item);
        }
        if(batch.length) { await this.confirm(batch); settled=true; }
        const head=this.checkpoint?.pending[0];
        if(!batch.length || !head || head.state==="conflict") break;
      }
      // The last confirmation already persisted the server snapshot. Empty-outbox polling and an existing conflict still reconcile.
      if(!settled || this.checkpoint?.pending[0]) {
        const start=performance.now(); const base=await this.transport!.read();
        this.lastReadAt=Date.now();
        this.health={...this.health,latency:Math.round(performance.now()-start),lastSynced:new Date().toISOString()};
        this.publish(await this.store.update(this.key,old=>({...old!,base,savedAt:new Date().toISOString()})));
      }
      this.hasSynced=true; this.attempts=0; this.lastKind="other";
      this.health={...this.health,errorKind:undefined,errorCode:undefined,retryAttempt:undefined,retryAt:undefined};
      this.channel?.postMessage("synced");
    };
    try {
      if(typeof navigator!=="undefined" && navigator.locks) await navigator.locks.request(`sync:${this.key}`,sync);
      else await sync(); // Server idempotency still protects duplicate sends across tabs.
    } catch(error) {
      failed=true;
      this.attempts++;
      clearTimeout(this.deferTimer); this.deferTimer=undefined;
      const kind: ErrorKind=error instanceof ConflictError ? "conflict" : classifyError(error);
      this.lastKind=kind;
      this.health={...this.health,state:this.health.conflicts?"conflict":"waiting",message:this.health.conflicts?"Changes need review in System health.":this.health.pending?"Saved on this device — waiting for connection":"Connection unavailable. Showing the last saved conference.",
        detail:error instanceof ConflictError?error.message:kind==="overload"?"The conference database is busy. Your changes are safe on this device. Automatic retry is enabled.":"Connection interrupted. Automatic retry is enabled.",
        errorKind:kind,errorCode:errorCode(error)}; this.emit();
    } finally {this.flushing=false;this.schedule();}
    // An action recorded while this flush was already past its batch step (opening/idle/confirmation read) saw `flushing` and
    // returned. After a SUCCESSFUL run only, send it now instead of at the next poll. A failure follows the backoff path above.
    if(!failed && this.hasSendableWork()) void this.flush();
  }
  /** Unsent or unconfirmed work at the head of the outbox. Behind a conflict (head blocked) nothing is sendable. */
  private hasSendableWork() {
    if(!this.transport || this.disposed) return false;
    const head=this.checkpoint?.pending[0];
    return !!head && head.state!=="conflict";
  }
  async exportRecovery() { return JSON.stringify(await this.store.read(this.key),null,2); }
  getPending() {return this.checkpoint?.pending ?? [];}
  async resolveConflict(id: string) {
    // Explicitly dismiss only after organizer exports/reviews it. Never auto-rebase conflicting attendance.
    this.publish(await this.store.update(this.key,old=>({...old!,pending:old!.pending.filter(m=>m.id!==id || m.state!=="conflict")})));
    this.channel?.postMessage("saved"); this.retry();
  }
  reset = () => { if(this.transport) throw Error("Cloud conference reset is disabled."); void this.store.update(this.key,()=>({key:this.key,base:this.seed(),pending:[],savedAt:new Date().toISOString()})).then(c=>{this.publish(c);this.channel?.postMessage("saved");}); };
  dispose() {this.disposed=true;clearTimeout(this.retryTimer);clearTimeout(this.deferTimer);clearTimeout(this.onlineTimer);this.channel?.close();this.stopLive?.(); if(typeof window!=="undefined"){window.removeEventListener("online",this.onOnline);window.removeEventListener("focus",this.refresh);} }
}
