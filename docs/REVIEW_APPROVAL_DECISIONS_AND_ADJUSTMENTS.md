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
