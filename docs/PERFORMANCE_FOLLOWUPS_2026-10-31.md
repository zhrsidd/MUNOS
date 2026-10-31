# Read performance and optional queue-clear follow-ups

**Status: design for review, 31 October 2026.** The delta-read and automatic queue-clear designs below are not implemented. Neither is a release gate by itself. Further read architecture work is conditional on the final capacity results; the existing capacity, correctness and release gates remain required.

The owner selected **1 November 2026, 16:00–18:00 Qatar (13:00–15:00 UTC)** for the next final-test window. Selecting the window does not authorise a hosted operation, migration, fixture reset, deployment or production change. Use the approved run packet and its target, lifecycle, fixture, watcher and GO controls. This document performs no hosted operation and makes no claim that performance is complete or capacity has passed.

## 1. Candidate to test first

Keep the reviewed full-snapshot contract for the initial candidate: a successful read returns the complete role-specific state, and the durable repository replaces its persisted base before projecting its retained outbox. Accepted actions leave that outbox only after read-back; retries retain their mutation UUID and payload.

The baseline already includes:

- **PR #93:** committee prefilters in `conference_snapshot`, ahead of expensive per-row access checks. The migration leaves RLS authoritative and compares output before/after across callers. Its local measurements are not concurrent hosted-capacity evidence. See the [migration](../supabase/migrations/20261101090000_snapshot_committee_prefilter.sql) and [equality tests](../tests/snapshot-prefilter-db.test.ts).
- **PR #94:** suppression of notifications that only echo this device's acknowledged/confirmed actions, and a 15-second minimum passive refresh gap for Approval, Printing and Executive-only identities. Own writes still receive immediate confirmation; foreign notifications and recovery reads remain necessary. See the [transport](../lib/supabase/repository.ts), [repository](../lib/sync/repository.ts), [timing policy](../lib/sync/backoff.ts) and [Realtime tests](../tests/realtime-invalidation.test.ts).
- **The additional existing-conflict regression:** an accepted batch followed by an already stored conflict previously caused a confirmation snapshot and then an unnecessary second snapshot. The candidate now skips that second read. Its local regression passes and checks that only the confirmed UUID leaves the outbox, the conflict and later intent remain durable, and a later blocked refresh still reads. See [the regression](../tests/sync-read-amplification.test.ts). This rare path is not evidence of an H3 capacity improvement.

The readiness work also aligns the rehearsal's simulated notification policy with the production client. Simulated delivery must not be reported as proof of real Auth, Realtime or venue-network behaviour. The full branch's verification and independent review remain separate from these design notes.

### Executive prefilters are not an established next optimisation

The transport selects `executive_state_snapshot` only when authenticated role metadata is exactly `['admin']`. A normal conference-wide Admin grant makes `private.visible_committees` return `NULL`, meaning there are no other committees to skip. Copying #93's predicates into `executive_snapshot` would therefore provide no demonstrated benefit for that normal workload. A committee-scoped Admin may differ, but requires its own measurement and output-equality coverage.

`operations_snapshot` and `staff_batch_snapshot` also contain committee scans. Profile them before extending prefilters. A new SQL change must preserve every policy's role set, conference-level rows, lifecycle restrictions and invoker behaviour; it must not widen access or drop visible data to obtain a faster result.

## 2. Local profiling and decision record

Use disposable local PostgreSQL 17, replaying the complete committed migration chain from empty. Populate synthetic fixtures matching the final workload: 19 committees, 420 delegates, realistic document/version/comment history, roll calls, votes, participation events, audit history and support work. Use the existing [local PostgreSQL helper](../tests/helpers/postgres.ts) as the loopback-only boundary. Do not import real conference data or treat a historical hosted fixture as authorisation to contact it.

Measure each component and its bundled caller separately: `conference_snapshot`, `executive_snapshot`, `operations_snapshot`, `staff_batch_snapshot`, `conference_state_snapshot` and `executive_state_snapshot`. Use Chair, Approval, Logistics and Executive callers with representative grants. Warm queries, alternate before/after runs, record sample count and report database timing, output bytes, rows considered and policy-call counts. Inspect the slow inner scans with `EXPLAIN (ANALYZE, BUFFERS)` and local function statistics where available. Function-level plans alone may conceal the expensive nested statement.

For a proposed optimisation, compare JSON equality and denial behaviour across single/multiple committee grants, mixed roles, conference-wide roles, revoked/expired grants, no grant, another conference, lifecycle phases and owner execution. Keep the [snapshot equality](../tests/snapshot-prefilter-db.test.ts), [composition](../tests/state-snapshot.test.ts), [routing](../tests/snapshot-routing.test.ts) and durable-sync tests. PGlite can check PostgreSQL semantics locally; its timing does not establish hosted throughput.

The final decision record should identify the exact candidate SHA, ledger, fixture, staffing profile, request counts, role latency, CPU/connection evidence and observed pending/conflict results. Keep the original failed run's evidence. If the corrected candidate passes the unchanged capacity gates with acceptable headroom, retain full snapshots and defer the delta architecture. If it fails, identify whether the remaining cost is snapshot construction, request amplification, transport/network behaviour or workload fidelity before selecting the next change.

## 3. Conditional delta-read design — not implemented

### Proposed contract: replace complete scopes

Start with complete **scope replacement**, rather than arbitrary entity patches. A scope could be conference configuration or a committee's complete role-specific state. A response would carry the schema/projection version, actor/grant context, replacement scopes, removed scopes and a server-authoritative version token. An unchanged response would still require current access validation.

The server must build payloads and their versions from one consistent database snapshot. The client atomically persists the replacement base and its version token, then projects the unchanged pending mutations. Replacing a complete scope removes entries that no longer exist without needing individual tombstones; scopes that disappear through archive, deletion or grant changes still require explicit removal or a full rebaseline. Nested documents, comments, versions, roll calls, ballots and conference-level dependencies must belong to a defined scope. A global change must invalidate all dependent projections.

The existing `operational_changes` table is an invalidation hint, not this protocol: it contains UUIDs, topics, mutation IDs and timestamps, without complete replacement data, deletion coverage or a proven commit-order cursor. Realtime remains a hint to reconcile, not the authoritative stored delta stream.

### Cursor and access requirements

- A plain timestamp, UUID ordering or sequence high-water mark is insufficient. Transaction A can allocate an earlier value, transaction B can allocate a later value and commit first, and a reader can then advance past A before A commits. Taking `max(id)` or `max(created_at)` can permanently miss A.
- A possible design uses version rows updated under the same scope lock as every relevant write. Writers to one scope serialize; readers fetch each scope's committed version and payload in one snapshot. Cross-scope writes require deterministic lock order and atomic invalidation of every affected scope. This remains a design to prove, including contention cost and all write paths; a new global lock must not create another capacity bottleneck.
- Tokens bind to conference, actor, projection/schema version and current effective grant context. Expiry, revocation, lifecycle changes, mixed roles and scope removal force denial or a safe rebaseline. Cached role metadata alone cannot authorise a delta read. Loss of access must not leave stale formerly authorised scopes in the active projection.
- An unknown, expired, incompatible or missing token requires a full snapshot. A failed read or IndexedDB write must advance neither the base nor its token. Never merge a partial response into a different actor's or conference's cache.
- Confirmation must prove that the returned state covers the accepted mutations in the batch. An unchanged response cannot acknowledge a write whose affected scope is absent or whose version predates it. Specify the receipt/version fence or use full-snapshot confirmation until this is proven. Keep failed read-back, lost send responses, PT409/40001 and cross-tab behaviour unchanged.

### Files and acceptance work

A separate reviewed bundle would add a forward migration for the version/invalidation contract and RPC, explicit privileges, transport response types, persisted token handling in [the durable store](../lib/sync/store.ts), scope merging in [the repository](../lib/sync/repository.ts), and safe full-snapshot fallback in [the transport](../lib/supabase/repository.ts). Every writer affecting a returned scope must participate, including server submissions, Executive configuration, held approvals and cleanup/archive paths.

Before adoption, prove equivalence to full snapshots after creates, updates, removals, archive, grant changes and reordered/concurrent commits. Test crash/reload between receive and persist, lost responses, cursor expiry, schema upgrades, mixed roles, cross-tab writes and a foreign mutation arriving during confirmation. Profile any lock contention locally and independently review the schema, access and offline contracts. Only then include the design in a new capacity candidate; documentation alone does not clear a failed gate.

## 4. Optional automatic queue clear — not implemented

The owner approved the option; [SESSION_MODEL §9](SESSION_MODEL.md#9-deferred-approved-scope-automatic-queue-clear-at-session-start) retains it as deferred scope. The current queue persists across sessions, with existing explicit removal controls. Completing the session model does not imply that automatic queue clear exists.

### Proposed state and transition

Add an opt-in setting and a per-committee `queue_epoch`; stamp entries and newly saved queue commands with their epoch. A server-owned transition, keyed idempotently to the authoritative boundary, locks the committee, marks old entries removed, increments the epoch and records its audit/notification in one transaction. Reuse the committee lock already acquired by Chair commands so add/clear races serialize. Replaying a completed transition must not clear the new queue or bump the epoch again.

The transition key must account for published schedule versions and overrides. Review the semantics of schedule edits, resumed automation, missed boundaries, day close and enabling the option during a session. Decide whether enabling mid-session waits for the next start or requires an explicit Executive clear. These details are open design decisions, not new product commitments in this document. Preserve the active speech, POI state and debate mode unless the owner separately approves changing them.

A device timer cannot be the authority. For visible clearing at the actual boundary, a server scheduler/worker must discover due transitions and invoke the idempotent operation, with retry and missed-boundary handling. A lazy check on the next write alone leaves the old queue visible until that write. Reads must not secretly perform clearing. Server trigger/scheduler choice, privileges, operational ownership and failure monitoring require review before implementation.

### Old actions, old clients and approval races

Once the option is active, a queue add from an older epoch must be **held**, even if ordinary clock/window hold enforcement is disabled. A legacy client or queued action without an epoch must not silently adopt the current epoch and resurrect cleared entries. Define its migration policy explicitly; the safe starting proposal is to hold unversioned queue changes after the first enabled transition, while leaving existing behaviour intact while the option is off. Already accepted exact retries still acknowledge their original receipt without executing again; receipt checks precede new epoch admission.

Version all queue operations that can affect the new queue, including the legacy `queue` command and order/remove/recognise operations, rather than protecting only `queueAdd`. Keep the saved payload and mutation UUID immutable. Local projection can display retained pending intent, but must distinguish held work after reconciliation instead of presenting it as an accepted active entry.

An Executive approval must recheck the epoch under the same committee lock. An action reviewed against epoch N cannot be approved into epoch N+1 merely because a boundary occurred while the review dialog was open. Stale-epoch work stays held or is explicitly discarded. If the Executive deliberately wants to re-add it now, specify a separate authorised current-epoch action with a new UUID and an audit link to the held original; do not rewrite the old command, reuse its UUID with different JSON, or silently reinterpret ordinary approval. Apply the same rule to single and bulk approval, and preserve held dependency ordering.

### Implementation and proof required

A separate feature bundle would cover a forward migration, epoch-aware server dispatch/admission and held approval, snapshot fields, shared domain/command types, local projection/fingerprints, Executive setting/review controls and held reason text. Existing clients, cached bundles and durable outboxes are part of its compatibility review.

Required local cases include simultaneous chairs at a boundary, clear/add contention, a duplicate or delayed worker job, old offline adds, commands without epochs, already accepted receipt replay, stale single/bulk approval, approval racing a boundary, schedule edits and disabled-option behaviour. Verify migration replay, role/committee/lifecycle denial, unchanged outbox durability, and actual browser behaviour. Protected-area changes need an independent review before shipping. This optional feature does not need to be rushed into the final capacity candidate.

## 5. Release and operational boundaries

The [load plan](LOAD_TEST_PLAN.md), [execution packet](LOAD_TEST_EXECUTION_PACKET.md), [lifecycle](INFRASTRUCTURE_LIFECYCLE.md), [scope decision](RELEASE_SCOPE_2026-10-26.md) and [release checklist](V1_RELEASE_CHECKLIST.md) remain authoritative for their respective controls. The new selected window supersedes the old date for scheduling only; old run records remain historical evidence.

No new hosted project, paid branch, production configuration change, hosted migration or release approval follows from this design. Source review and local synthetic tests remain the cloud-agent boundary after production promotion. John Paul Ribeiru approves release; Zuhayr Siddique owns scope/infrastructure decisions. Record final capacity results before choosing another performance architecture.

## Appendix: fresh-fixture local component observation

A disposable PostgreSQL 17.11 replay of all 37 migrations accepted the four-Draft fixture SQL: 19 committees, 420 delegates, 22 synthetic identities/grants, 133 documents/versions, 19 roll calls and 420 roll-call rows. No event, vote, audit or queue history was populated. The temporary database was dropped after the probe.

For each role/RPC, one warm-up was discarded and five sequential calls were timed with the server clock. The table shows median JSONB construction/execution time and uncompressed JSON text bytes; text-size calculation was outside the timed interval. Host contention was uncontrolled and this excludes HTTP, network, Auth issuance, Realtime and concurrent load. The raw local report was kept under `/tmp/munos-final-readiness/profiling/report.json` during preparation; it contains only counts and metrics. This is a fresh-fixture observation, not the history-rich profile prescribed in section 2, a before/after comparison or a capacity result.

| Caller | `conference_state_snapshot` | JSON bytes | `executive_state_snapshot` | JSON bytes |
| --- | --- | --- | --- | --- |
| Chair | 30.390 ms | 18,112 | 31.974 ms | 15,937 |
| Approval | 50.744 ms | 59,296 | 34.884 ms | 47,480 |
| Printing | 34.303 ms | 59,353 | 45.758 ms | 47,537 |
| Executive | 138.719 ms | 320,120 | 113.347 ms | 278,759 |

Both bundles were probed for comparison; actual client role routing still chooses the production RPC. The result supports measuring the wider Executive payload and real request rate during H3, and does not establish that another prefilter or delta protocol is necessary.
