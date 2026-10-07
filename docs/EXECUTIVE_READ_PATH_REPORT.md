# Executive read-path optimization

Base: PR #9, `6fdf01670f1b58436495d3af04808ad98f987334`.

## Scope and migration

One forward migration, `20261006202710_executive_snapshot.sql`, applied once to development project `opmydpozhdgkpcnjwpqb`. The local filename matches the version assigned by the remote migration ledger. The previous 12 migrations were preserved; none were replayed or edited. No production deployment or load test was performed.

`public.executive_snapshot(conf uuid)` is a stable, SECURITY INVOKER function with an empty search path. EXECUTE is explicitly granted to `authenticated` and revoked from `PUBLIC` and `anon`. Existing table RLS remains authoritative, including when another staff role calls this RPC directly. An inaccessible conference raises `42501`, as in the original snapshot.

## Exact core response shape

The response has the same 20 top-level keys as `conference_snapshot`:

- Retained without changing their existing projections: `conference`, `committees`, `schools`, `staff`, `sessions`, `delegates`, `attendance`, `documents`, `scoring`.
- `audit`: the newest 50 visible audit records, selected by `createdAt DESC, id DESC`, then returned in chronological order (`createdAt ASC, id ASC`) for the existing UI. Each entry contains exactly `id`, `actorId`, `action`, `entityId`, `createdAt`.
- Empty arrays: `versions`, `events`, `queue`, `votes`, `criteria`, `awardScores`, `debateStates`, `speeches`, `poiQueue`.
- Empty object: `timers`.

All attendance is retained. Documents retain their existing summaries, comments, and ordered `versionIds`; only the global versions collection is empty. Database audit history remains complete and append-only. The original snapshot's audit projection is unchanged.

## Client behavior

Only authenticated role metadata exactly equal to `['admin']` selects `executive_snapshot`. Chair, Approval, Logistics, mixed roles, duplicate/ambiguous grants, and missing metadata retain `conference_snapshot`. Both paths still request `operations_snapshot` concurrently and merge it exactly as before. Mutation routing and error handling are unchanged.

For pure Executive, the first `chair` notification starts a fixed 2,000 ms window. Later Chair events do not restart it. The timer clears before issuing one refresh, allowing a subsequent event to start a new window. Non-Chair notifications retain the existing 350 ms debounce. A fast notification cancels a pending Chair timer; Chair events received while that fast refresh is pending share that refresh. Unsubscribe clears both timers.

Chair behavior, Approval/Logistics filtering, connection reconciliation, recovery polling, and the durable outbox are unchanged.

## Read-only development measurements

Measured on existing conference `509c1bcf-fbae-45ac-80e7-c9b8661cc1b5`, using its existing Executive grant with `SET LOCAL ROLE authenticated` and the corresponding JWT subject. No identities, grants, fixture rows, or sessions were created. Both projections were warmed once, then measured in three alternating sequential pairs inside a read-only transaction using `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.

| Metric | Existing conference_snapshot | New executive_snapshot | Reduction |
|---|---:|---:|---:|
| Uncompressed PostgreSQL JSON text bytes | 458,967 | 171,616 | 62.61% |
| Median warm database execution | 93.086 ms | 40.530 ms | 56.46% |
| Audit entries returned | 588 | 50 | |
| Attendance entries returned | 161 | 161 | |

Execution samples in milliseconds: original `[100.181, 91.545, 93.086]`; Executive `[40.336, 40.793, 40.530]`. All six measured queries reported zero shared disk blocks read. These are fresh paired measurements, not the earlier rehearsal/prototype figures. They measure database execution and JSON text size, not HTTP latency, compressed transfer size, or concurrent capacity. `operations_snapshot` is excluded from both comparisons and remains unchanged.

Attendance and documents were byte-for-byte equal as JSON values. Audit table count remained 588 before and after verification. The audit query used the existing `audit_history` index, with an incremental sort for deterministic ID ties; it inspected 51 index rows to return 50 (4.097 ms execution). No index was added.

## Verification

- All 125 tests passed locally, including 31 additional tests net of the PR #9 baseline.
- Typecheck, lint, and production build passed.
- New database test verifies compatible keys, preserved lightweight collections, all empty runtime fields, deterministic audit cap/order/fields, unchanged stored history and full snapshot, invoker execution, and anonymous/unassigned/cross-conference denial plus direct Chair RLS isolation.
- New transport tests verify snapshot selection, conservative fallback, concurrent operations merge, and existing error/recovery behavior.
- Expanded Realtime tests verify the non-resetting window, exactly one refresh per burst, fast-path supersession, subsequent windows, and cleanup. Existing outbox, PT409, conflict, offline recovery and idempotency tests remain green.
- Remote hashes of all 22 pre-existing public/private function definitions and all public/private policies were identical before and after the migration. This includes `conference_snapshot`, `operations_snapshot`, `private.has_access`, and mutation RPCs.
- Remote catalog verification confirmed SECURITY INVOKER, stable volatility, empty search path, authenticated EXECUTE, and no anonymous EXECUTE.
- Advisors reported 34 existing auth-configuration warnings and one unused-index notice, with no finding referencing the new RPC. These were not changed in this patch. References: [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [unused-index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Files changed

- `lib/supabase/repository.ts`
- `supabase/migrations/20261006202710_executive_snapshot.sql`
- `tests/executive-snapshot.test.ts`
- `tests/snapshot-routing.test.ts`
- `tests/realtime-invalidation.test.ts`
- `docs/EXECUTIVE_READ_PATH_REPORT.md`

No RLS policies, mutation semantics, PT409 handling, durable outbox code, original snapshots, Supabase compute, or PR #6 were changed.
