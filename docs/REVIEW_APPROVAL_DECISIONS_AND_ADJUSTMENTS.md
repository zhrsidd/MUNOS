# Independent review request: approval decisions, point adjustments, archive_jobs removal

Branch `claude/epic-clarke-djmafa`. Three migrations (not applied to any hosted project) plus client code. These are
protected changes under `AGENTS.md`: please review before they ship. Nothing here touches production, secrets or RLS
on existing tables; no existing migration was edited.

## Migrations

| File | What it does |
| --- | --- |
| `20261019100000_approval_decisions.sql` | `documents.review_round`; table `document_decisions` (read-only RLS, same lifecycle policy as `document_comments`); BEFORE trigger bumps the round on entry to Submitted; AFTER trigger records review started / changes requested / approved with reviewer, version, round; AFTER INSERT trigger on `document_comments` links a comment written in the same transaction; `operations_snapshot` patched to publish `documentDecisions`. |
| `20261019100100_point_adjustments.sql` | Table `participation_adjustments` (signed points, reason, chair, time, `reverses`); `private.ops_point_adjustment`; `apply_operations_mutation` patched at two anchors (scope + dispatch) with a new `pointAdjustment` command (Chair only, committee from the delegate); `operations_snapshot` patched to publish `pointAdjustments`. |
| `20261019100200_retire_archive_jobs.sql` | Drops the unused Drive-era `archive_jobs` table. Raises if it has rows. |

All three patches use `pg_get_functiondef` plus an anchor that must occur exactly once, and fail closed otherwise (the
repository's existing pattern).

## Design choices to challenge

1. **Triggers, not a patch of `private.apply_mutation`.** Every status change already runs under mutation receipts, so a
   replayed or duplicated mutation never reaches the UPDATE and cannot record a second decision. Cost: the decision
   is tied to the status transition, and the actor is `auth.uid()` read inside a SECURITY DEFINER trigger.
   Direct owner/service SQL records `reviewerId = null`.
2. **Comment linking by transaction timestamp.** `link_decision_comment` matches a decision and a comment with the same
   `documentId` and `decidedAt = createdAt` (both `now()` of one transaction). Two comments for one document in one
   transaction would link only the first; the core mutation writes at most one.
3. **Visibility mirrors comments.** The policy is `exists (select 1 from documents d where d.id = "documentId")`, so
   the Approval Panel reads decisions only while the document is Submitted/Review/Approved. After a document is sent
   back to Draft its history is not visible to Approval until it is resubmitted. This is the existing comment
   behaviour; I kept it rather than widen RLS. The Executive audit log is not exposed to any new role.
4. **No historical decisions.** Existing documents get `review_round = 1` if past Draft or commented; earlier decisions are not
   reconstructed (the audit log is the only source and is admin-only).
5. **Adjustments are append-only.** Signed `points`, `-20..20`, never zero; reason 3-300 characters; a deduction is
   undone only by a restore row that references it (partial unique index: once). No update/delete grants. Original
   `participation_events` are never touched; a delegate's total is effective events plus adjustments (client-side
   `participationSummary`). No optimistic fingerprint (append-only); a double restore raises `PT409`.
6. **Extension boundary.** Reuses `apply_operations_mutation`: receipts, idempotency, `PT409`, audit row, and an
   `operational_changes` notification with topic `chair`.
7. **Snapshot size.** Both arrays are conference-wide and small (adjustments are rare; decisions are at most three
   per round per resolution). Please check against the 110-device rehearsal budget.

## Evidence

- `tests/approval-decisions-db.test.ts` (PGlite, all migrations): full round trip; a comment-free approval records a decision and
  no comment; the decision links to its comment otherwise; identical replay records nothing extra; key reuse for a
  different action is refused; invalid transitions record nothing; Approval and the owning Chair read decisions, another
  committee's Chair does not; no insert/update grants; audit log still closed to Approval; unique decision per round.
- `tests/point-adjustments-db.test.ts`: replay x3 records one row; original events byte-identical; chair name and time
  recorded; amount 0/-3/21/1.5/"5"/null/100 and reasons ""/"ab"/301 chars rejected; another committee's Chair,
  Executive, unknown delegate/session refused; reads scoped like participation; direct insert/update/delete denied;
  restore once, second restore `already restored`, restoring a restore refused; `archive_jobs` gone.
- Client: `tests/adjustments-client.test.ts`, `tests/approval-history.test.ts`; browser run in demo mode (deduct, restore, sort, history).
- Not verified: real Supabase (Realtime delivery, PostgREST, advisors), a staging replay of the three migrations, offline close/reopen
  through IndexedDB with these commands (generic outbox tests apply; command routing is asserted).

## Questions for the reviewer

- Is a trigger acceptable here, or do you want the decision insert inside `apply_mutation`?
- Should the Approval Panel keep read access to decisions after a send-back (needs a policy change)?
- Is -20..20 per adjustment the right bound, and should net totals be allowed below zero (currently allowed)?
- Index and lock behaviour of `participation_adjustment_once_reversed` under two Chairs restoring at once.

## Response to the independent review of `fd91da7` (all five accepted and fixed)

The migrations were never applied anywhere, so they were corrected in place (no applied migration was edited).

| # | Finding | Fix | Regression test |
| --- | --- | --- | --- |
| 1 | History hidden after Draft / Printed / In Debate / Closed | `private.decision_history(conf)`: SECURITY DEFINER projection under `private.has_access` for approval, chair, admin, observer; returns only decision, round, version, reviewer name, committee, resolution code/title and the linked feedback text. Legacy comments are projected as `comment`. Table RLS stays narrow; Logistics and other committees get nothing; revocation and expiry are immediate. | `tests/approval-lifecycle-db.test.ts` (Draft, Printed, In Debate, Closed, scopes, revoke/expire, audit still closed, exact field list) |
| 2 | Seeded Review document rejected a second change request | `document_round` is now BEFORE INSERT OR UPDATE: non-Draft inserts start in round 1, direct non-Draft moves are lifted to round 1, Draft to Submitted still increments | same file, using the real seed (GA1 / 02), plus an imported Approved row |
| 3 | Restore bypassed the archive guard | `require_operational_session` on the original adjustment's session | `tests/point-adjustments-db.test.ts` |
| 4 | Client `sessionUsed` ignored adjustments | `sessionUsed` checks `pointAdjustments` (deduction and restore) | `tests/adjustments-client.test.ts` |
| 5 | Check/drop race in `archive_jobs` | `lock table ... access exclusive` first, then check, then drop, in one DO block with a 10 s lock timeout | file-order test, plus a real PostgreSQL 16 run: a writer committing a row during the migration made it refuse and the table and row survived |

Client: `DocumentDecision` now carries code, title, committee and comment so history renders without the resolution being visible; the local demo path produces the same shape. Not changed: timestamp comment linking (hardening noted, mutation-ID correlation left for any future batching); the 1 to 20 per-adjustment bound is still a product default for the owner to confirm; net totals below zero remain allowed.
Not run: the four PostgreSQL-17-gated concurrency suites (the only local server here is PostgreSQL 16 and they fail on it for version reasons; the reviewer ran them on 17.11). Row counts, payload size and query cost of the two snapshot arrays are still unmeasured and belong to the conference-week rehearsal.

## Second review (`0016176`): migrations accepted for staging replay; two UI fixes

- **Masthead after a failed read:** `saveStatus` now handles `waiting` with an empty outbox ("Connection interrupted · showing saved data · open details", attention) before the healthy fallback, and nothing is called synced before the first successful read (`lastSynced`). Regressions: helper cases and a real `DurableRepository` run against a 504 transport (`tests/sync-resilience.test.ts`).
- **Failed save in a native dialog:** the provider keeps the last failed save (`actError`); `Modal` clears any stale one on open and renders the current one inside the dialog as `role="alert"`, with "Your entries are kept: change them or try again." This covers every modal save form, not only deductions, and the entered values and submit button stay usable for a retry. Browser-verified with an injected IndexedDB write failure (dialog open, values kept, alert text inside the dialog, no claim that nothing was saved).

## PR #22 — staging migration and sync acceptance gate

Added from the 20 October repository review. The review identifies PR #22 as the unmerged development package; a passing CI run and earlier local review do **not** close this gate. All boxes below remain pending until dated evidence exists. This packet's earlier “not applied” statements describe its recorded checkpoint, not a fresh hosted ledger query.

### Review and migration replay

- [ ] Record the exact PR head/base, independent protected-area review and green CI for that head. Review the combined UI, sync, authorization and scoring changes, not just the three SQL files. Claude coordinates implementation; Codex/another independent reviewer verifies; name one integration owner for shared contracts.
- [x] Confirm the non-production target, conference, migration ledger and explicitly allowed project ref before any separately authorised staging write. *20 Oct: `kllhswucdhqqywnzxado` (development role), test conference `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`; empty ledger before apply; [evidence](SUPABASE_PROJECT_SETUP.md).* Rehearsal/load tools must refuse production and PHESMUN targets. Never use production credentials or real conference records as fixtures.

  **Progress, 20 October:** the 21 migrations were applied once, in order, by the owner with `supabase db push` after PR #22 merged. The ledger equals the filenames, and the live schema fingerprint equals a local rebuild ([evidence](SUPABASE_PROJECT_SETUP.md)). This is a replay on the single DCMUN project while it holds only test data. There is no separate disposable staging database, so the `archive_jobs` nonempty-refusal proof and any rollback rehearsal below need either a disposable local PostgreSQL 17 or an explicitly approved test on this project before cutover. The boxes below stay open until that evidence exists.
- [ ] Replay committed migrations in dependency order on disposable staging: `20261019100000_approval_decisions.sql`, `20261019100100_point_adjustments.sql`, `20261019100200_retire_archive_jobs.sql`, plus any required predecessors. Verify exact filenames/content against the candidate. Preserve applied history; correct any already-applied migration with a new forward migration. Compare the resulting ledger and schema to the candidate; record each application once.
- [ ] For `archive_jobs`, prove on a disposable fixture that a nonempty table makes the migration refuse with its rows intact, while the empty-table case drops it. Verify the lock-before-check/drop and bounded lock wait. Never empty real rows merely to make the guard pass. Keep the existing independent concurrency evidence; run PostgreSQL-17 concurrency suites rather than counting skips as passes.
- [ ] Exercise real PostgREST/RPC reads and writes, Realtime and advisors. Verify approval rounds/history/comment visibility through the full resolution lifecycle; scoped/revoked/expired access; adjustment/deduction/restore amount and reason checks; one restore only; unchanged original participation events; correct net totals and separate contribution ranks. Retain narrow table RLS and the reviewed history projection; do not expose the audit log.

### Sync and browser acceptance on the same candidate

- [ ] With real IndexedDB and authenticated staging, queue more than 25 valid mutations offline, reconnect, and observe batches of at most 25 acknowledgements sharing a confirming snapshot read. Independently verify one server effect per UUID, final counts/totals and an empty outbox only after confirmation.
- [ ] Lose a mutation response; fail a confirming snapshot after acknowledgements. During that page session acknowledged IDs must not be resent just because read-back failed. Pending intent stays durable until a successful confirming read. Close/reopen the browser before confirmation: in-memory acknowledgement knowledge may be lost, so replay must remain idempotent without missing or duplicate effects.
- [ ] Exercise 502/504/429 and supported overload errors. Verify bounded overload-aware backoff/jitter, passive focus/Realtime/peer-tab/poll triggers respecting it, and recovery after service returns. Verify explicit Retry behavior without a retry storm; record actual request/read counts and latency rather than inferring them from CI.
- [ ] Two Chairs: test conflicting edits, a conflict in the middle of a batch, retained later intent, explicit conflict review/export and exactly-once settlement of earlier acknowledged work. Revocation/expiry or a different actor must not flush the old actor's outbox.
- [ ] Confirm truthful status before the first successful read, after a 504 with an empty outbox, and for device-saved / server-received-but-confirming / server-confirmed / needs-review states. A failed local save keeps the dialog open, entered values and an in-dialog alert/retry; it must not claim a durable or confirmed save.
- [ ] Verify changed workflows across Chair, Approval, Admins and Executive, public QR isolation, reload/offline/reconnect, role denial, mobile/desktop, keyboard, actual 200% zoom and reduced motion. Compare the old app against the migrated schema and rehearse rollback on staging; app rollback must not require undoing these migrations or losing outbox contents.

Attach the candidate SHA, immutable Preview URL, target ref, ledger, automated/PostgreSQL-17 results, browser evidence, request counts and independent data checks. Report failures, skips and unverified paths explicitly. Reverify the resulting `main` Preview after any authorised merge, then refresh Graphify as described in [START_HERE.md](START_HERE.md#shared-agent-context-and-graphify). This gate does not approve the session-model draft or replace the conference-week capacity gate, resource approval or production release approval.
