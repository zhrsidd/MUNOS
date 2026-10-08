# Staff access, central sessions and amendments

Draft feature branch: `codex/staff-schedule-amendments`.
Base: PR #12, `assistant/realtime-access-prep`, exactly `cdf36861816d2e4637f0834820aa3e043ea4d53d`.

## Delivered behavior

- Cloud staff entry requires an active grant. A fresh visit creates no Auth identity; submitting a code reuses an existing session or creates an anonymous identity, then calls the existing `redeem_access_code`. Invalid/expired and rate-limit responses have distinct, generic messages. Public delegate forms bypass staff initialization entirely.
- Executive `/admin/access-codes` calls PR #12's management RPCs directly. It supports committee Chair, Approval Panel, Admins (`logistics`) and Executive (`admin`) scopes, expiry, rotation and optional device revocation. Raw codes are held only in component/form memory and the required RPC body, displayed once, and never sent through the durable mutation/audit path, URLs or browser storage. Reload cannot recover a raw code.
- Navigation follows active grants; mixed-role users retain their granted workspace choices and actual Chair committee scopes. RLS remains authoritative. Access is checked on startup, Auth changes, focus, reconnect, every 60 seconds and grant expiry.
- Existing actor-bound outboxes remain independent. PR #12's saved authorization pointer is understood without resetting storage. Prepared devices retain the existing maximum 48-hour offline lease, bounded by grant expiry. Expired devices cannot edit; retained changes remain exportable offline without an Auth token-refresh dependency. Sign-out, expiry and revocation never delete pending mutations.
- Executive `/admin/sessions` (also `/admin/schedule`) manages central slots. Each active committee receives a separate local session. New committees inherit active slots. Edits preserve every local session ID, attendance and participation association.
- Committee code/name/room editing and archive/delete actions are available at `/admin/committees`. Historical committees remain archived and hidden from normal Chair selection. Session archive closes its materialized sessions and clears current-session selection while preserving records.
- Executive `/admin/amendment-links` manages separate static QR links; Chair `/chair/amendments` shows QR/copy/print controls and the current resolution's amendment inbox. Public `/amend/[token]` and its print sheet never create delegate Auth sessions. Add/Strike/Replace submissions capture exact wording and progress through Submitted → Accepted for Debate → In Debate → Closed, with explicit outcomes. One amendment can be in debate per committee. A passed amendment prompts the Chair to update the working Google Doc manually.

## Migration and schema

The only new migration relative to PR #12 is `20261007104501_staff_schedule_amendments.sql`. It has **not been applied to shared development**. It adds `conference_session_slots`, `amendment_links`, `amendments`, a private submission-receipt table, committee archive/revision fields and nullable session slot/archive fields. Scoped foreign keys, indexes, uniqueness/check constraints, explicit grants and RLS accompany the tables. Public amendment RPCs are executable only by `service_role`; the server returns a minimal committee/delegation/current-resolution projection without staff or delegate emails.

Hard deletion checks database foreign-key references, including newer modules, and session-linked audit/receipt history. A used committee or slot must be archived. The compact Executive snapshot may not contain every linked historical record, so the database is the final deletion check; rejection retains the durable intent for explicit review and restores authoritative data on reconciliation.

Legacy sessions retain their IDs and a null `slotId`. They are shown read-only as earlier committee sessions. No name/time matching silently merges old attendance, documents or participation into new slots.

New writes preserve UUID receipts, payload-identity checks, revision conflicts (`PT409`), deterministic optimistic IDs and ordered locking. Public submissions have idempotency/conflicting-payload checks, duplicate-content detection and limits of 20 per link and 5 per submitter per 10 minutes. Link rotation/revocation is rechecked inside the write transaction. Audit details omit bearer QR tokens; public submission receipts remain private.

`staff_batch_snapshot` composes into the existing bundled snapshots; no additional snapshot request is added. Chair amendment payloads are bounded to 200 records for the current resolution(s) in debate, with older records retained in the table. The Executive projection omits amendment wording. Amendment notifications use the existing `documents` topic; central schedule changes notify affected committee scopes. Existing recovery polling, first-join authentication and role invalidation filters are unchanged.

## Verification — 7 October 2026

- Typecheck, lint, full local tests and production build pass. Full suite: **187 tests**, including inherited access-code security/Realtime tests and offline/conflict/idempotency regressions.
- Disposable PGlite PostgreSQL instances apply all migrations in order. Tests cover central materialization, deterministic IDs, edits, archive/delete restrictions, legacy preservation, foreign-key/RLS boundaries, revision conflicts, amendment transitions, one active amendment, public validation, replay/deduplication, link rotation/revocation, closed-resolution rejection, both rate limits, token-safe audits and compact Executive reads.
- Access tests cover existing anonymous/named session reuse, identity creation only on submission, invalid/rate-limited results, role scoping, revoked-response races, retained mutation UUIDs, exactly-once recovery, legacy prepared-device offline reopening and expired-device recovery export without Auth requests.
- Browser: local central-session create/edit and persistence after reload; committee edit controls; amendment link management and Chair QR layout; isolated delegate unavailable state; cloud-mode unauthenticated gate with a deliberately unreachable test endpoint. No demo workspace appeared in cloud mode. No browser console errors/warnings on the verified localhost routes. The public local-demo error state is intentional, not a live backend substitute.
- Development Auth settings were read only: anonymous sign-ins are enabled for `opmydpozhdgkpcnjwpqb`. Preview deployment configuration was not modified or independently inspected. Preview must point to that intended project; Claude should verify its environment before a later Preview rehearsal.

## Review / integration handoff

PR #12's access-code migration, RPC implementation, Realtime fix and grammar fixes remain unchanged. The feature migration was initially generated with a timestamp preceding PR #12, then renamed **before application** to `20261007104501` so it sorts after its dependency. No applied migration was renamed or replayed. If another migration lands first, reconcile the timestamp/order before any shared application.

Review focus: `lib/repository-instance.ts`, `lib/access.ts`, `lib/access-codes.ts`, access gate/Executive UI, the new migration, `lib/batch/*`, public amendment server boundaries and new database/recovery tests. After review/base integration, Claude can coordinate shared-development migration application and a real Preview two-device/offline/public-form rehearsal. That remote end-to-end acceptance remains pending by instruction; local tests do not claim it is complete.

No shared-development schema/data writes, Vercel configuration changes, deployments, main merge or load test occurred in this feature pass. PR #6 is outside this feature branch. The new feature stays draft until review.

## Review blockers completed — 8 October 2026

This section supersedes the original base/verification checkpoint above. PR #13 is rebased onto PR #12 head `77744f8375a06ea1857bf9e2c0b6f7dcbc3a689f`. Both PRs remain draft. Neither migration has been applied to shared development.

### Exact patch scope

PR #12:
- `.github/workflows/ci.yml`: disposable PostgreSQL 17 service and loopback test connection; install the PostgreSQL client only if unavailable.
- `supabase/migrations/20261007104500_access_code_redemption.sql`: unique active scope index with `NULLS NOT DISTINCT`; scope advisory lock for rotation; credential row locks and revalidation for redemption/revocation; consistent committee-before-credential lock order for Chair scopes.
- `tests/access-codes-concurrency.test.ts`: real independent-connection races, including deterministic barriers that reproduced Chair grant/audit FK deadlocks before the fix.
- `tests/helpers/postgres.ts`: bounded psql harness; loopback hosts only; uniquely named disposable test databases and cleanup. No new runtime dependencies.

PR #13 blocker patch (beyond the rebase):
- `supabase/migrations/20261007104501_staff_schedule_amendments.sql`
- `lib/repository-instance.ts`
- `components/staff-access.tsx`
- `tests/archive-blockers.test.ts`
- `tests/archive-concurrency.test.ts`
- `tests/signout-recovery.test.ts`
- `tests/staff-batch-db.test.ts`
- `docs/STAFF_FEATURE_BATCH_REPORT.md`

### Invariants and migration edits

1. **Credentials:** the database allows at most one non-revoked credential per conference/role/committee, with null committee treated as a scope. Rotation serializes even an empty scope using a transaction advisory lock. Redemption/revocation lock and revalidate the credential. Chair operations acquire a committee lock first, preventing FK lock inversions while creating grants or audits. Raw-code storage, rate limits, role/RLS rules and one-time secret return are unchanged.
2. **Committee archive:** the same transaction archives/clears current session and revokes all unrevoked Chair credentials and Chair grants for that committee. Approval, logistics and admin grants remain intact. A trigger refuses issuing a new active Chair credential for an archived committee. Both real archive/redemption race orderings leave no active Chair grant.
3. **Archived sessions:** a private guard is inserted into the existing core/procedure mutation implementations after committee locking and after receipt replay checks. It also guards amendment status changes. This covers attendance, participation/corrections, old/new queues, speeches/POIs, ballots/vote mode, timers, procedure state, current-session selection and indirect document/version targets. Archived session/committee writes fail with `PT409`, retaining offline mutation UUIDs for review. The migration asserts its exact function-body anchors rather than silently changing an unknown base. Already-acknowledged receipts keep their existing idempotency behavior.
4. **Active debate:** committee and central-slot archives reject any affected In Debate resolution before clearing state. Slot protection also covers a committee whose current selection would be cleared while its active resolution still references an earlier session. Closing the debate permits archival.
5. **Sign-out:** clean devices sign out normally. Active pending/conflict work refuses sign-out. With revoked/expired/unavailable access, successful recovery download initiation plus an explicit warned final-sign-out action is required. Export authorization is runtime-only and tied to exact actor/checkpoint/pending contents; new work or changed pending state invalidates it. In-flight local saves settle before the decision. Checkpoints and UUIDs remain stored; a new identity cannot send the old actor's mutations.
6. **Safe delete:** actual committee-owned records/FKs and session history still block deletion. Only transient operational invalidations and audit FK scope are excluded from the committee usage scan. Invalidation rows are removed; audit `committee_id` is nulled while all other fields remain byte-for-byte equivalent. Unused central materializations/configuration bookkeeping no longer prevent deletion.
7. **Codes:** a unique `(conference_id, lower(code))` index rejects case-insensitive duplicates even through direct SQL. The prior unique constraint remains.
8. **Archive locking:** configuration uses a conference `FOR NO KEY UPDATE` lock, preserving writer serialization while allowing grant/audit FK `KEY SHARE`. A barrier regression reproduced the archive/grant deadlock with `FOR UPDATE`; the revised lock passes it.

### Final local verification

PR #12: **154 tests passed**, zero skipped; typecheck, lint and production build passed.

PR #13: **234 tests passed**, zero skipped; typecheck, lint and production build passed. This includes 10 real credential concurrency checks, three real archive/redemption checks, 20 explicit core/procedure archived-session paths, lifecycle/RLS/delete/uniqueness tests, eight sign-out recovery tests, and the existing offline/exactly-once/Realtime regressions.

Full local concurrency-enabled test command:

```sh
PSQL_BIN=/opt/homebrew/opt/postgresql@17/bin/psql \
TEST_POSTGRES_URL=postgresql://zuhayrs@127.0.0.1:55439/postgres npm test
```

The loopback PostgreSQL 17.11 cluster is disposable, separate from Supabase development, and is stopped after verification. CI runs the same suite against its disposable PostgreSQL 17 service. Consult the current PR checks for the final pushed heads.

No shared-development migration application or replay, main merge, Production deployment, Vercel environment/configuration change, PR #6 change, or load test. Git pushes may trigger the existing automatic Vercel branch Preview; no manual deployment is performed. The public amendment boundary, QR routes, snapshot design, Docs workflow, RLS policies and Realtime architecture are unchanged by these blocker fixes.

## Final narrow archive boundary patch — 8 October 2026

Only PR #13 changes; PR #12 remains at `77744f8375a06ea1857bf9e2c0b6f7dcbc3a689f`. This supersedes the broader document/event session guard described above.

- In the still-unapplied `20261007104501_staff_schedule_amendments.sql`, `submission_link_info` filters archived committees without returning their committee, delegate or Chair projection. `submit_resolution` rechecks committee archival under its existing committee transaction lock, after accepted UUID replay and before duplicate-source receipt creation or any new document writes. Fresh requests fail with `invalid_link`; accepted identical retries remain replayable. Historical links and submission records are retained. Existing server-only grants, rate limiting and delegate-without-Auth boundary remain unchanged.
- The core archived-session guard now exempts document transitions, draft versions and historical event corrections. All existing live session/procedure guards remain, including new documents targeting archived sessions. Entry into debate still checks the current session, rejects missing/archived selection, and moves the document to the selected active session through the existing core workflow.
- `tests/archive-blockers.test.ts` adds QR archival/history/replay coverage and the complete archived Session 1 → version → Submitted → Review → Approved → Printed → active Session 2 debate/close workflow. It now verifies append-only historical correction and undo instead of rejecting them. The 20 live-command rejection paths and retained offline PT409 regression remain.
- Final local checks: **236 tests passed, zero skipped** (including real PostgreSQL concurrency); typecheck, lint and production build passed. A targeted independent read-only review found no concrete issue.

Changed files in this narrow pass: the existing feature migration, `tests/archive-blockers.test.ts`, and this report. No shared-development migration applied/replayed, main merge, Production/manual deployment, Vercel configuration/environment change, PR #6 change, or load test.
