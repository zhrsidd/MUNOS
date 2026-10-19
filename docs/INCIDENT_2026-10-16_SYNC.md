# Day 1 (16 Oct 2026) synchronisation incident — assessment and Day 2 client mitigations

Scope: client-side changes only (no migration, no RLS/grant change, no infrastructure or Vercel configuration change, no
data change). Evidence: the Day 1 report package, the deployed source at `bb20e40`, and read-only queries against the
production project (settings, `pg_stat_*`, advisors).

## What happened

From ~16:31 (Qatar) conference-snapshot reads slowed, from ~16:44 they began failing, and sync stayed degraded until the
sessions ended (~17:00–18:00, stragglers to 18:26). Between 16:40 and 17:05 the gateway logged 1,755 requests and 371 HTTP 5xx
(21 %); 350 of those were `conference_state_snapshot` (45 % of snapshot reads). Every 5xx carried PostgREST `57014`
(statement timeout, `authenticated` role = 8 s). PostgREST pool waits (`PGRST003`) and Realtime "too many database timeouts"
followed. The Nano instance was memory/CPU constrained (report: ~7 MB free RAM, swap in use).

## Why writes were delayed

The deployed sync loop did, **per queued action**: `send` → full `conference_state_snapshot` read → persist → next action.

1. A queue of *n* actions needs *n* sequential snapshot reads. In 16:40–17:05 the app made **777 snapshot reads for 309
   mutation calls** (live gateway logs), and 545 `user_access` checks (avg 4.1 s while degraded).
2. If the read-back timed out (8 s) the head action stayed queued; the next attempt **re-sent the same UUID** (idempotent, but
   still a round trip) and tried the snapshot again. Nothing behind it could advance.
3. Retries followed a 2→60 s ladder with **< 1 s jitter**, so devices that failed together retried together. Focus events,
   Realtime reconnects/notifications, peer-tab broadcasts and every new action also called the flush path **directly,
   bypassing the backoff** — more load exactly when the database was timing out.
4. Timeouts are expensive: a failed snapshot occupies a connection and CPU for the full 8 s, and the 60-connection / Nano
   headroom meant timeouts queued behind each other (`PGRST003`), so even the cheap `user_access` poll slowed to seconds.

Recovery after sessions ended is consistent with load removal: chairs stopped producing mutations, Realtime notifications and
focus events fell away, and the backlog (receipts show 20–57 min apparent age) drained with the database no longer saturated.

## Confirmed vs suspected

| Confirmed (logs + code) | Suspected / not established |
| --- | --- |
| Snapshot reads dominate failures; all 5xx are `57014` | Exact CPU / memory / I/O split on Nano |
| Sync does one snapshot per queued action and replays acknowledged actions after a failed read | Whether the HRC roll-call burst *triggered* it (correlation only) |
| Passive triggers bypass backoff; jitter is < 1 s | Whether `has_access` RLS evaluation or JSON aggregation dominates snapshot cost |
| Per-minute `user_access` poll on every device; 60 s snapshot poll | Realtime `postgres_changes` cost (270k `list_changes` calls, 3.0 M ms cumulative) vs snapshot cost — both material |
| Live `pg_stat_statements`: snapshot mean 535 ms, max 7.9 s on tables < 4 k rows (cost is query shape/RLS, not data volume) | A browser-count surge (not supported) or a school Wi-Fi cause (not supported for server-side 5xx) |

Cross-check notes: the report's conclusions held up against the code and live settings. One refinement: the report calls the
sequential read-back "the" bottleneck; the logs show read-backs are ~40 % of snapshot traffic (309 mutations of 777
snapshots) and polling/Realtime/retries the rest, so reducing *all* passive reads matters, not only the write path.

## Top improvements (ranked by impact ÷ risk)

| # | Change | Impact | Risk | Time | In this PR |
| --- | --- | --- | --- | --- | --- |
| 1 | One snapshot read confirms a *batch* (≤ 25) of acknowledged actions; acknowledged actions are never re-sent after a failed read-back | Cuts write-path snapshots by up to 96 % (1 read per 25 actions); a 298-action recovery needs 12 reads, not 298 | Low: actions stay in the IndexedDB outbox until the confirming read; same server idempotency | done | ✅ |
| 2 | Passive triggers (focus, Realtime, peer tab, poll) respect backoff and never re-read < 5 s after any tab's refresh; new actions during backoff wait for the retry timer | Ends retry storms from tab switching / Realtime flaps / N tabs per device | Low: purely client gating; explicit Retry and the backoff timer still run | done | ✅ |
| 3 | Overload-aware backoff (8→90 s) with 0–50 % positive jitter; online-event retries spread over 3 s | Stops devices re-hitting a timing-out database in lockstep | Low | done | ✅ |
| 4 | Steady polling ±20 % jitter, 120 s when Realtime is connected (60 s otherwise); access check jittered, focus-throttled to 20 s | ~50 % fewer idle snapshot polls when Realtime is connected; duplicate focus-triggered access checks removed | Low–moderate: changes worst-case staleness for passive viewers from ~60 s to ~144 s when Realtime silently drops; chairs' own writes always read back | done | ✅ |
| 5 | System Health: "database busy" vs "unreachable", retry attempt/time, error class/code, "received by server, confirming" | Operators stop pressing Retry during overload; faster diagnosis | None (display only) | done | ✅ |

Not done (need approval or are architectural): server-side snapshot slimming / delta reads, RLS helper tuning, an index for the
unindexed FK advisor finding, moving off `postgres_changes`, compute upgrade. See "Next" below.

## Behavioural guarantees (unchanged)

- Actions are removed from the IndexedDB outbox only by a successful confirming read, and only the exact acknowledged IDs.
- Conflict protection is unchanged: the loop stops at a conflict; earlier acknowledged actions in the same batch are settled
  best-effort; the conflict and everything behind it stay queued. `resolveConflict` is still an explicit operator action.
- Server idempotency (mutation UUID receipts) is untouched. After a page reload the in-memory "acknowledged" set is empty, so
  those actions are re-sent once (idempotent) exactly as before.
- Authorization, RLS, auth/identity checks, the service worker, the persistent-storage request and `/api/health` are untouched.

## Day 2 operator notes

- Pending actions confirm in batches; "N received by the server, confirming" in System health is normal and means nothing is lost.
- During "Conference database busy", **do not press Retry repeatedly** — automatic retries are already spread out.
- The ECOSOC recovery queue (298 actions behind one stale session selection) is unaffected by this change; reconcile it as
  described in the incident report addendum before Day 2.

## Rollback

Revert the PR's merge commit (`git revert -m 1 <merge sha>`) and redeploy the previous Vercel deployment (instant rollback in
the Vercel dashboard works too). No data or schema is involved, and the outbox format is unchanged (no new persisted fields), so
devices can move between versions freely, including with queued actions.

## Next (needs owner approval)

1. Profile `conference_state_snapshot` as the `authenticated` role on a copy; slim it (current-session scope, bounded history).
2. Consider a compute increase on Day 2 morning (Micro, 1 GB) as the report suggests; verify the actual compute size first.
3. Add the covering index for the `participation_events_amendment_scope` FK (advisor INFO) via a committed migration.
