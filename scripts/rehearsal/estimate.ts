// Deterministic, network-free estimate of how many full refreshes the scenario causes, by running the SAME client
// model as the live harness (client-model.ts) on a virtual clock with fixed latencies. Upper bound on writes: every
// scheduled write step is assumed to produce a write (the live run skips some when its precondition is not met).
import { SimClient, sumStats, type Clock, type RefreshSource } from "./client-model";
import { READS, TOPIC_OF, recipients, type RealtimeModel, type SimUser, type Step } from "./scenario";
/** Snapshot RPCs per logical refresh on current core: one bundled state-snapshot RPC (PR #11). The run harness measures
 *  the real count instead (rpc-counter.ts); 2 would apply only if core fell back to the separate snapshot RPCs. */
export const SNAPSHOT_RPCS_PER_REFRESH = 1;
export interface EstimateOptions {
  minutes: number;
  /** Fixed latency of one full refresh (one bundled snapshot RPC). */
  readMs: number;
  /** Fixed latency of one mutation RPC. */
  sendMs: number;
  /** Server commit → Realtime delivery to subscribed devices. */
  realtimeMs?: number;
  model: RealtimeModel;
  /** PR #10 fixed Chair-topic window for Executive/Admin-only devices (topic-aware only; 0 = plain debounce). */
  executiveChairWindowMs?: number;
  seed?: number;
}
interface Item { user: SimUser; step: Step }
type Timer = { t: number; seq: number; fn: () => void; dead?: boolean };
/** Deterministic virtual clock (also used by tests). */
export class VirtualClock implements Clock {
  t = 0; private seq = 0; private queue: Timer[] = []; // kept sorted by (t, seq)
  constructor(private rand: () => number) {}
  now() { return this.t; }
  random() { return this.rand(); }
  setTimeout(fn: () => void, ms: number) {
    const e: Timer = { t: this.t + Math.max(0, ms), seq: this.seq++, fn };
    let lo = 0, hi = this.queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; const q = this.queue[mid]; if (q.t < e.t || (q.t === e.t && q.seq < e.seq)) lo = mid + 1; else hi = mid; }
    this.queue.splice(lo, 0, e);
    return e;
  }
  clearTimeout(h: unknown) { if (h) (h as Timer).dead = true; }
  sleep(ms: number) { return new Promise<void>((r) => this.setTimeout(r, ms)); }
  async run(until: number) {
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.dead) { this.queue.shift(); continue; }
      if (next.t > until) break;
      this.queue.shift();
      this.t = next.t;
      next.fn();
      await new Promise((r) => setImmediate(r)); // let the client's promise chains settle at this instant
    }
    this.t = until;
  }
}
export function estimate(users: SimUser[], o: EstimateOptions) {
  let s = (o.seed ?? 7) >>> 0 || 1;
  const clock = new VirtualClock(() => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32));
  const staff = users.filter((u) => u.role !== "delegate");
  const clients = new Map<SimUser, SimClient<Item>>();
  const end = o.minutes * 60_000;
  let writes = 0;
  const readsByRole: Record<string, number> = {};
  const readsBySourceRole: Record<string, Record<RefreshSource, number>> = {};
  for (const user of staff) {
    const windowMs = user.role === "executive" && o.model === "topic-aware" ? (o.executiveChairWindowMs ?? 0) : 0;
    clients.set(user, new SimClient<Item>({
      isConflict: () => false,
      read: async (source) => { readsByRole[user.role] = (readsByRole[user.role] ?? 0) + 1; (readsBySourceRole[user.role] ??= { open: 0, postWrite: 0, realtime: 0, periodic: 0, refocus: 0 })[source]++; await clock.sleep(o.readMs); },
      send: async (item) => {
        await clock.sleep(o.sendMs * (item.step.retry ? 2 : 1));
        writes++;
        const topic = TOPIC_OF[item.step.action];
        if (!topic) return; // e.g. timer: no operational change, no Realtime fan-out
        for (const r of recipients(o.model, staff, { topic, committee: item.user.committee })) clock.setTimeout(() => clients.get(r)!.notify(topic), o.realtimeMs ?? 100);
      },
    }, clock, { executiveChairWindowMs: windowMs }));
  }
  for (const user of staff) for (const step of user.steps) clock.setTimeout(() => {
    const client = clients.get(user)!;
    if (step.action === "open") client.open();
    else if (step.action === "refocus" || (step.action === "read" && !step.periodic)) client.focus();
    else if (step.action === "read" || step.action === "health") return; // periodic recovery is the client's own timer
    else if (!READS.includes(step.action)) client.execute({ user, step });
  }, step.at);
  return clock.run(end).then(() => {
    const total = sumStats([...clients.values()].map((c) => c.stats));
    const pendingAtEnd = [...clients.values()].reduce((n, c) => n + c.pending, 0);
    const exec = sumStats([...clients.entries()].filter(([u]) => u.role === "executive").map(([, c]) => c.stats));
    return {
      model: o.model, executiveChairWindowMs: o.model === "topic-aware" ? (o.executiveChairWindowMs ?? 0) : 0, readMs: o.readMs, sendMs: o.sendMs, minutes: o.minutes,
      writes, pendingAtEnd,
      refreshes: total.refreshesExecuted, snapshotRpcCalls: total.refreshesExecuted * SNAPSHOT_RPCS_PER_REFRESH,
      readsPerWrite: writes ? Number((total.refreshesExecuted / writes).toFixed(1)) : 0,
      triggersAttempted: total.triggersAttempted, triggersDropped: total.triggersDropped,
      bySource: total.reads, droppedBySource: total.dropped, byRole: readsByRole, bySourceAndRole: readsBySourceRole,
      maxConcurrentReadsPerDevice: total.maxConcurrentReads,
      executive: { realtimeEvents: exec.realtimeEvents, chairWindows: exec.chairWindows, chairEventsCoalesced: exec.chairEventsCoalesced, realtimeTriggers: exec.attempted.realtime, refreshes: exec.refreshesExecuted },
    };
  });
}
