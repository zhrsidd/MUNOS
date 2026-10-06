// A faithful model of the production client's sync loop (lib/sync/repository.ts → DurableRepository), used by the
// live rehearsal harness and by the deterministic estimator. It deliberately mirrors production, including its
// limitations; it is not a smarter client.
//
// Mirrored behaviour (production reference in brackets):
//  * One flush in flight per device. Any trigger while `flushing` is true returns immediately and is NOT queued
//    or replayed — no dirty flag, no follow-up refresh. [flush(): `if (!this.transport || this.flushing) return;`]
//  * Triggers: initial open [ready() → flush()], a write [execute() → flush()], a Realtime notification
//    [transport.subscribe(this.retry) debounced 350 ms, reset on every event], window focus [addEventListener("focus",
//    this.retry)], and the recovery timer [schedule() after every flush].
//  * Flush body (PR #9): for each pending item in order — send, then one full read-back, then the item is removed.
//    The final full read runs only when no read-back happened in this flush (empty-outbox recovery/poll) or a
//    conflict still blocks the head of the outbox. [sync(): while(item) { send; read; readBackCompleted=true } ;
//    if(!readBackCompleted || item) read]. Under this model's conflict-dismissal assumption (below) the head is never
//    left blocked, so the final read reduces to "only if nothing was read back".
//  * A write recorded while a flush is running is NOT sent by a new flush (the trigger is dropped). It is sent only if
//    the running flush is still inside its send loop when it re-reads the outbox; otherwise it waits for the next
//    trigger (Realtime, focus or the recovery timer). [item=this.checkpoint?.pending[0] after each read]
//  * Recovery timer: re-armed after every flush ends: 60 s (+0–1 s jitter) when healthy, exponential backoff
//    min(60 s, 2^attempts s) after a failure. [schedule()]
//  * A failed send or read keeps the item at the head of the outbox; the next flush re-sends the SAME mutation id.
//
// Not modelled: the Realtime (re)connect retry and the browser "online" event. Both call retry() as the app opens or
// reconnects, which coincides with the opening flush (and would be dropped by the one-in-flight guard); no network
// loss is simulated during a rehearsal stage.
//
// One modelling assumption (human, not client): production marks a conflicting item and stops sending later items
// until a person reviews it in System health. The model assumes the Chair dismisses the conflict before their next
// action (the item is dropped and counted), so one conflict does not silently stall a simulated device for the rest
// of the run.
export type RefreshSource = "open" | "postWrite" | "realtime" | "periodic" | "refocus";
export const REFRESH_SOURCES: RefreshSource[] = ["open", "postWrite", "realtime", "periodic", "refocus"];
export const REALTIME_DEBOUNCE_MS = 350;
export const RECOVERY_MS = 60_000;
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}
export interface ClientIO<W> {
  /** Send one outbox item (may resolve a retried/lost-response double send internally). Throws on failure. */
  send(item: W): Promise<void>;
  /** One full refresh (production: conference_snapshot + operations_snapshot). Throws on failure. */
  read(source: RefreshSource): Promise<void>;
  isConflict(error: unknown): boolean;
}
const zero = () => Object.fromEntries(REFRESH_SOURCES.map((s) => [s, 0])) as Record<RefreshSource, number>;
export interface ClientStats {
  attempted: Record<RefreshSource, number>;
  dropped: Record<RefreshSource, number>;
  reads: Record<RefreshSource, number>;
  failedReads: number;
  sendFailures: number;
  conflicts: number;
  maxConcurrentReads: number;
}
export class SimClient<W> {
  private flushing = false;
  private outbox: W[] = [];
  private attempts = 0;
  private timer?: unknown;
  private debounce?: unknown;
  private closed = false;
  private readsInFlight = 0;
  readonly stats: ClientStats = { attempted: zero(), dropped: zero(), reads: zero(), failedReads: 0, sendFailures: 0, conflicts: 0, maxConcurrentReads: 0 };
  /** Resolves whenever the current flush (if any) finishes. */
  private idle: Promise<void> = Promise.resolve();
  constructor(private io: ClientIO<W>, private clock: Clock) {}
  get busy() { return this.flushing; }
  get pending() { return this.outbox.length; }
  open() { this.trigger("open"); }
  /** execute(): the write is stored in the outbox first, then flush() is attempted. */
  execute(item: W) { if (this.closed) return; this.outbox.push(item); this.trigger("postWrite"); }
  /** Realtime INSERT on operational_changes: trailing 350 ms debounce, reset by every event. */
  notify() {
    if (this.closed) return;
    this.clock.clearTimeout(this.debounce);
    this.debounce = this.clock.setTimeout(() => this.trigger("realtime"), REALTIME_DEBOUNCE_MS);
  }
  focus() { this.trigger("refocus"); }
  trigger(source: RefreshSource) {
    if (this.closed) return;
    this.stats.attempted[source]++;
    if (this.flushing) { this.stats.dropped[source]++; return; }
    this.idle = this.flush(source);
  }
  /** Stop timers and ignore further triggers; resolves after any in-flight flush. */
  async close() { this.closed = true; this.clock.clearTimeout(this.timer); this.clock.clearTimeout(this.debounce); await this.idle; }
  async settled() { await this.idle; }
  private async read(source: RefreshSource) {
    this.stats.reads[source]++;
    this.readsInFlight++;
    this.stats.maxConcurrentReads = Math.max(this.stats.maxConcurrentReads, this.readsInFlight);
    try { await this.io.read(source); } catch (e) { this.stats.failedReads++; throw e; } finally { this.readsInFlight--; }
  }
  private async flush(source: RefreshSource) {
    this.flushing = true;
    let readBack = false;
    try {
      while (this.outbox.length) {
        const item = this.outbox[0];
        try { await this.io.send(item); }
        catch (e) {
          if (this.io.isConflict(e)) { this.stats.conflicts++; this.outbox.shift(); } else this.stats.sendFailures++;
          throw e;
        }
        await this.read("postWrite");
        this.outbox.shift();
        readBack = true;
      }
      // The last acknowledged item already read back the server snapshot: no extra final read.
      if (!readBack) await this.read(source);
      this.attempts = 0;
    } catch { this.attempts++; }
    finally { this.flushing = false; this.schedule(); }
  }
  private schedule() {
    this.clock.clearTimeout(this.timer);
    if (this.closed) return;
    const delay = this.attempts ? Math.min(RECOVERY_MS, 1000 * 2 ** Math.min(this.attempts, 6)) : RECOVERY_MS;
    this.timer = this.clock.setTimeout(() => this.trigger("periodic"), delay + this.clock.random() * 1000);
  }
}
export function sumStats(list: ClientStats[]) {
  const total = { attempted: zero(), dropped: zero(), reads: zero(), failedReads: 0, sendFailures: 0, conflicts: 0, maxConcurrentReads: 0 };
  for (const s of list) {
    for (const k of REFRESH_SOURCES) { total.attempted[k] += s.attempted[k]; total.dropped[k] += s.dropped[k]; total.reads[k] += s.reads[k]; }
    total.failedReads += s.failedReads; total.sendFailures += s.sendFailures; total.conflicts += s.conflicts;
    total.maxConcurrentReads = Math.max(total.maxConcurrentReads, s.maxConcurrentReads);
  }
  const sum = (r: Record<RefreshSource, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  return { ...total, triggersAttempted: sum(total.attempted), triggersDropped: sum(total.dropped), refreshesExecuted: sum(total.reads) };
}
