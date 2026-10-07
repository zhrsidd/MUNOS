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
