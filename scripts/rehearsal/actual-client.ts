// Live load runner: the shipping repository owns storage, optimistic intent, batching, retries and confirmation.
// fake-indexeddb supplies isolated Node memory devices; this is NOT physical-browser/offline or real Realtime proof.
import 'fake-indexeddb/auto';
import { DurableRepository, type Transport } from '../../lib/sync/repository';
import { DurableStore, type Mutation } from '../../lib/sync/store';
import { normalizeCommand, type Command } from '../../lib/commands';
import type { ConferenceData, Role } from '../../lib/domain';
import type { ChangeEvent, SimUser, RealtimeModel } from './scenario';
import { recipients } from './scenario';

export interface IntentMeta { action: string; retry?: boolean }
export interface ActualClientStats { reads: number; coreSendAttempts: number; maxConcurrentTransportCalls: number; notifications: number; focuses: number; localRefusals: number }
export interface ActualClientOptions {
  key: string;
  seed: () => ConferenceData;
  transport: Transport;
  /** Explicitly simulated connectivity. No real channel is opened. */
  connected?: boolean;
  executiveChairWindowMs?: number;
  /** Observes accepted sends, including exact retry probes; it must not perform an extra snapshot read. */
  accepted?: (m: Mutation, meta: IntentMeta, first: boolean) => void;
}
export class ActualClient {
  readonly repo: DurableRepository;
  readonly store: DurableStore;
  readonly stats: ActualClientStats = { reads: 0, coreSendAttempts: 0, maxConcurrentTransportCalls: 0, notifications: 0, focuses: 0, localRefusals: 0 };
  private active = 0;
  private snapshotReady = false;
  private closed = false;
  private debounce?: ReturnType<typeof setTimeout>;
  private chairWindow?: ReturnType<typeof setTimeout>;
  private intents: { signature: string; meta: IntentMeta }[] = [];
  private byMutation = new Map<string, IntentMeta>();
  private sent = new Set<string>();
  private stop: () => void;
  constructor(private options: ActualClientOptions) {
    if (typeof window !== 'undefined') throw Error('The Node rehearsal adapter must not install a window shim.');
    // One database PER device. Sharing a fake IDB transaction queue would invent cross-device storage contention.
    this.store = new DurableStore(`rehearsal-${options.key}`);
    const tracked = async <T>(op: () => Promise<T>) => {
      if (this.closed) throw Error('Rehearsal device closed before the next transport operation.');
      this.active++; this.stats.maxConcurrentTransportCalls = Math.max(this.stats.maxConcurrentTransportCalls, this.active);
      try { return await op(); } finally { this.active--; }
    };
    const transport: Transport = {
      actorId: options.transport.actorId,
      read: () => tracked(async () => { this.stats.reads++; return options.transport.read(); }),
      send: m => tracked(async () => {
        this.stats.coreSendAttempts++;
        let meta = this.byMutation.get(m.id);
        if (!meta) {
          const index = this.intents.findIndex(i => i.signature === signature(m.command, m.role));
          meta = index < 0 ? { action: m.command.type } : this.intents.splice(index, 1)[0].meta;
          this.byMutation.set(m.id, meta);
        }
        await options.transport.send(m);
        const first = !this.sent.has(m.id); this.sent.add(m.id);
        options.accepted?.(m, meta, first);
        // Explicit lost-response probe: the core owns automatic retries; this repeats only an opted-in same UUID.
        // The first server acceptance above remains observed even if this probe's response is lost.
        if (first && meta.retry && !this.closed) await options.transport.send(m);
      }),
    };
    this.repo = new DurableRepository(options.key, options.seed, this.store, transport);
    // ready() only subscribes in a browser. This public health field makes the *actual* polling code use the explicitly
    // simulated connection state without a window shim (which would activate browser Auth/session code in Node).
    this.repo.health = { ...this.repo.health, realtime: options.connected ?? true };
    this.stop = this.repo.subscribe(() => { if (this.repo.getHealth().lastSynced) this.snapshotReady = true; });
  }
  get snapshot() { return this.snapshotReady ? this.repo.getSnapshot() : null; }
  get pending() { return this.repo.getHealth().pending; }
  get conflicts() { return this.repo.getHealth().conflicts; }
  get unconfirmed() { return this.repo.getHealth().awaitingConfirmation ?? 0; }
  get busy() { return this.active > 0 || this.repo.getHealth().state === 'syncing'; }
  open() { return this.repo.ready(); }
  async execute(command: Command, role: Role, meta: IntentMeta) {
    if (this.closed) throw Error('Rehearsal device is closed.');
    const intent = { signature: signature(normalizeCommand(command), role), meta };
    this.intents.push(intent);
    try { await this.repo.execute(command, role); }
    catch (error) { this.intents = this.intents.filter(i => i !== intent); this.stats.localRefusals++; throw error; }
  }
  focus() { if (!this.closed) { this.stats.focuses++; this.repo.refresh(); } }
  /** The existing transport's trailing debounce / fixed Executive window; delivery is explicitly simulated. */
  notify(topic?: string) {
    if (this.closed) return;
    this.stats.notifications++;
    const window = this.options.executiveChairWindowMs ?? 0;
    if (window > 0 && topic === 'chair') {
      if (this.debounce || this.chairWindow) return;
      this.chairWindow = setTimeout(() => { this.chairWindow = undefined; this.repo.refresh(); }, window);
      return;
    }
    clearTimeout(this.chairWindow); this.chairWindow = undefined;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debounce = undefined; this.repo.refresh(); }, 350);
  }
  async close(timeoutMs = 30_000): Promise<boolean> {
    this.closed = true;
    clearTimeout(this.debounce); clearTimeout(this.chairWindow);
    this.repo.dispose();
    const deadline = Date.now() + timeoutMs;
    // A nonresponsive transport must not prevent a failure report. The live runner also aborts every wire request.
    while (this.busy && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    const settled = !this.busy;
    this.stop();
    if (settled) await this.store.close();
    // If an uncooperative mock/transport is still active, leave its IDB open for that operation; never claim a drain.
    return settled;
  }

}
const signature = (c: Command, role: Role) => JSON.stringify([role, c]);

/** Staff writes and successful public creates use the SAME simulated delivery path and actual event committee. */
export function deliverChange(model: RealtimeModel, users: SimUser[], event: ChangeEvent, notify: (user: SimUser, topic: string) => void) {
  for (const user of recipients(model, users, event)) notify(user, event.topic);
}
/** Resolve event scope from the command's entity, not a conference-wide reviewer's arbitrary scenario index. */
export function commandCommittee(data: ConferenceData | null, command: Command): string | undefined {
  const c = command as Command & { committeeId?: string; sessionId?: string; id?: string; documentId?: string; resolutionId?: string };
  return c.committeeId ?? data?.sessions.find(s => s.id === c.sessionId)?.committeeId ?? data?.documents.find(d => d.id === (c.documentId ?? c.resolutionId ?? c.id))?.committeeId;
}

/** Bound real HTTP work, including caller-provided cancellation, without changing production transport code. */
export function boundedFetch(fetcher: typeof fetch, timeoutMs = 30_000): typeof fetch {
  return (input, init = {}) => {
    const previous = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetcher(input, { ...init, signal: previous ? AbortSignal.any([previous, timeout]) : timeout });
  };
}
