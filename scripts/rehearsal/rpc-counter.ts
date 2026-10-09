/** Snapshot read RPCs the core transport can issue. Bundled core (migration 20261006211039, PR #11) makes ONE per
 *  logical refresh (conference_state_snapshot or executive_state_snapshot); only its PGRST202/42883 fallback (bundled
 *  function missing) — or core older than PR #11 — makes TWO: the core snapshot plus operations_snapshot. */
export const SNAPSHOT_RPCS: readonly string[] = ["conference_state_snapshot", "executive_state_snapshot", "conference_snapshot", "executive_snapshot", "operations_snapshot"];
/** snapshot: this device's running total; byName: shared per-stage tally across devices. */
export interface RpcCounter { snapshot: number; byName: Record<string, number> }
type RpcClient = { rpc: (name: string, ...rest: never[]) => unknown };
/** Counts the snapshot RPCs a client actually sends (so reports never assume an RPCs-per-refresh constant).
 *  Wraps the instance's rpc method in place; every other method and the call itself are unchanged. */
export function countSnapshotRpcs<C extends RpcClient>(client: C, counter: RpcCounter): C {
  const rpc = client.rpc.bind(client) as (name: string, ...rest: unknown[]) => unknown;
  (client as { rpc: unknown }).rpc = (name: string, ...rest: unknown[]) => {
    if (SNAPSHOT_RPCS.includes(name)) { counter.snapshot++; counter.byName[name] = (counter.byName[name] ?? 0) + 1; }
    return rpc(name, ...rest);
  };
  return client;
}
