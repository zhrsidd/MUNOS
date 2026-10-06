# Development verification — 6 October 2026

This records evidence, not production approval. Only development project `opmydpozhdgkpcnjwpqb` was used; no production project exists. See [integration review and handoff](INTEGRATION_REVIEW.md) for outstanding gates.

## Current evidence

- Foundation, access hardening, operations, schedule, photo, review-hardening, Chair-procedure and read-only history-grant migrations are applied remotely. The historical failed read-policy optimization and its restoration remain in the ledger. Do not reapply recorded migrations.
- Most recent schema inspection before the additive staff-contact migration: 31 public tables with RLS, 94 public foreign keys, 39 check constraints, 205 indexes; zero anonymous table grants. A follow-up migration removed inherited non-SELECT privileges from the participation-history view. Staff-contact migration `20261006073442_staff_chair_contacts` was subsequently applied exactly once; remote types were regenerated. Verified public relation grants: authenticated SELECT only across 32 relations and no anonymous grants. Contact lookup remains service-only.
- Real rollback-transaction RLS tests passed: ungranted identity denied, committee isolation, direct writes denied, role escalation denied and idempotent participation retries. Local tests also cover lifecycle-scoped document links/Storage and stale extension mutations.
- [Remote integration results](remote-integration-results.json), recorded 6 October at 02:35 UTC: Google Doc Draft creation; Chair → Approval → printing → debate → vote; shared current session; independent POIs and exactly-once recognition; Main/Co-Submitter flow; persisted queue order; Divide the House; schedule import; exactly-once photo acknowledgement; configured SC permanent-member IDs; fresh repository persistence. Submission creation used the service-only SQL boundary, followed by real staff Data API operations. This is **not** a public HTTP-route or file-upload test.
- Staff-contact browser save and reload persisted correctly; remote lookup returned the assigned Chair contact, then the temporary test email was cleared. A remote rollback exact-retry test passed.
- Latest reported local suite: **68 tests passed**, including fresh PostgreSQL-compatible migrations/RLS, core procedure/veto cases, extension replay/security and durable IndexedDB recovery. Typecheck, lint and production build also passed today. The final typecheck, lint and 68-test rerun passed after blocking writes when cloud access is unavailable.
- Browser evidence so far: remote Chair, Approval and Admins screens; review/approve/mark-printed actions; two independently authorized Chair identities; shared session selection arriving on another device without refresh. Earlier baseline offline scoring/timer/queue navigation passed. Final-build close/reopen, conflict recovery and mobile checks remain to be recorded.
- Latest remote advisors: **34 security warnings** (33 anonymous staff-bootstrap policy warnings and one leaked-password-protection warning); these are not zero findings. Staff identities still require explicit scoped access grants. Performance: **69 informational unused-index findings**, no warning/error findings.

## Capacity evidence and limits

[Current restored-policy load report](load-test-results.json): 150 simulated operational clients, one authorized identity, 1,500 requests, zero errors, 150 participation events without duplicate events, 150 attendance records, 150 printed resolutions, and 150 successful Realtime connections/reconnections. Burst-read p95 was **13,093 ms** and p99 14,480 ms. Correctness passed for that workload; latency does not justify conference-capacity acceptance.

[Before-optimization report](load-test-before-optimization.json) and [reverted experiment](load-test-reverted-experiment.json) preserve historical measurements. The speculative optimization caused timeouts and incomplete writes and was reverted; it is not the current load result. Database CPU was unavailable through the Data API and requires Observability inspection.

This is staff-app load, not distinct-device enrollment or delegate submission load. Delegates create no Supabase Auth sessions. Rehearse staff enrollment behind school NAT separately from server-mediated QR-form bursts, including file-upload exceptions and per-link rate limiting.

## Remaining acceptance checks

- Supply the development `SUPABASE_SECRET_KEY` in ignored server-only configuration, then test real public HTTP submission and fallback Storage success/failure. The key must never enter browser configuration, repository history or chat.
- Rerun typecheck, lint, full tests and build on the final code; record final desktop/mobile role screens, runtime errors, refreshed persistence, offline close/reopen, exactly-once replay and two-device conflict recovery.
- Preserve the recorded advisor warnings and explicitly disposition relevant release risks; repeat advisors if schema changes again.
- Address tail latency; test actual school-network staff devices and separate delegate bursts.
- Protected staging/production, monitoring and rollback rehearsal remain outstanding. Drive failure tests await the future integration.

PR #6 remains draft. Review acceptance does not imply any PR has been merged. Local demo/fallback behavior is not production-ready cloud behavior.

## GitHub checkpoint

Core integration branch is pushed through commit `35f89be`. Ordered PR merges remain pending; this SHA is not the resulting `main` SHA. PR #6 remains draft.

### Browser recovery checkpoint (6 October)

Two real remote participation actions survived an offline browser reload and synced on reconnection. Outbox returned to zero; remote receipts `cef8dca6-c2a8-4965-9eee-0955f1b313ed` and `eabec35c-1328-4cbc-aded-d544542d8bf5` each produced exactly one event. Mobile Chair layout at 390 px had no horizontal overflow. The isolated public form was visually inspected using explicit demo data; its checkbox wording matched and no Supabase/Auth network requests were observed. This is not a substitute for remote HTTP submission verification. Full browser-process close/reopen and two-Chair conflict rehearsal remain separate acceptance checks. Realtime showed its yellow degraded state after the network interruption; automatic recovery to a subscribed channel still requires verification.

The existing PR #5 GitHub `verify` job was cancelled at its 15-minute limit, without a reported failed test step. It is not a passing CI result. Ordered merges remain on hold until the integration checks and public HTTP gate are resolved; PR #6 remains draft. No production deployment occurred.
