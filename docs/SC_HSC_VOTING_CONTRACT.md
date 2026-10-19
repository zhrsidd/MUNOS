# SC/HSC clause procedure and clear-majority voting

Owner-confirmed requirements, 19 October 2026. High-priority implementation brief for Claude.
**Status: specified; not implemented.** This changes the persistent procedure model, not just button labels.
Keep the existing Google Docs access-verification priority; this package is required before SC/HSC use.

## 1. Confirmed conference rules

These are the owner's DCMUN rules. Do not substitute a generic UN procedure or infer a P5 threshold.

1. SC and HSC debate and vote clause by clause.
2. A veto opens an informal discussion and a separate vote among **P5 members only**.
3. Neither that conversation nor individual P5 votes/counts need recording. The Chair manually records only
   **Veto overturned** or **Veto upheld**. There is no app-calculated P5 threshold.
4. The recorded veto outcome determines whether the veto blocks the clause. An overturned veto allows the
   otherwise passing clause to pass; an upheld veto fails it. Do not treat the initial veto as immediate final
   failure while its discussion outcome is pending.
5. Failed clauses may be removed or revised. Continue with the surviving clauses; failed clauses do not force
   the entire resolution to fail.
6. After clause consideration is complete, hold a separate vote on the **whole resolution**. It may pass or
   fail even though individual clauses passed.
7. A veto on that final resolution vote triggers the **same P5-only informal discussion and manually recorded
   outcome** before the final result can be confirmed.
8. Add **Clear majority For** and **Clear majority Against** so Chairs can record an obvious voting result
   without clicking every country's ballot.

## 2. Chair experience

Keep one Debate screen and one Voting screen. Do not create a tab for each clause.

- Show the current target clearly in both places: resolution code plus `Clause 1 — [label]`, or
  `Whole resolution — final vote`. A compact clause selector shows Pending / In debate / Passed / Failed /
  Removed. Do not overwhelm the existing speech/POI controls.
- Retain roll call and the side-by-side For/Against layout. Speeches, POIs, queues and amendments must refer
  to the current clause/attempt when one is being debated. Existing Main Submitter credit stays once per
  resolution; changing clauses must not award it again.
- The Chair starts a clause, conducts debate, opens its ballot and confirms its result. Passing/failing a
  clause leaves the parent resolution In Debate. A failed clause can be excluded, or revised and reconsidered
  as a new attempt with its prior result preserved.
- After a veto, show `Veto discussion pending` with the vetoing delegation(s) where actually known. Leave
  the main ballot visible, and offer **Record P5 outcome** with exactly two choices: **Veto overturned** /
  **Veto upheld**. Confirm the target and consequence before saving.
- There is no P5 voting grid, tally, threshold setting, transcript, discussion timer, or required discussion
  notes. Save the outcome, Chair and time, tied to that precise target and ballot attempt.
- Once all clauses are resolved or removed, the Chair explicitly opens **Final resolution vote**. It is not
  an automatic pass derived from the clause results. Close the resolution only after confirming that final
  ballot, including any pending veto discussion.
- The original working Google Doc remains the resolution editor. The app must not pretend it has inserted,
  removed or verified clauses in that document. Use a compact Chair-managed clause register with stable ids
  and human-readable numbers/labels; do not restore PDF preview or Drive mirroring.

Proposed default for review: no final vote while any clause is unresolved, and no final vote on an empty
surviving text. Revisions or reopening after a result require an explicit new attempt, not silent overwrites.
These are engineering/product guardrails; the numbered rules above are the owner-confirmed requirements.

## 3. Clear-majority controls across committees

This is a new recording method for an observed result, not a bulk-fill action on named ballots.

- Show two compact actions, **Clear majority For** / **Clear majority Against**, alongside counted voting.
  Confirm target, method, outcome and any veto before recording. Use full words to avoid ambiguity.
- Store `recording method: observed majority`, the Chair's declared direction/result, actor and time. Counts
  and individual country choices remain **not recorded**, never fabricated or shown as zero. Do not mark
  unrecorded countries as having voted For/Against or as absent.
- Keep per-country voting for close votes and Divide the House. The shortcut must not bypass named-roll-call
  requirements or imply a simple majority satisfies a configured two-thirds threshold. Proposed initial
  scope: normal simple-majority votes; other rules use a counted ballot unless separately specified.
- In veto-enabled substantive votes, do not infer `no veto` from the lack of named ballots. Require the Chair
  to confirm **No veto raised**, or identify the actual vetoing member(s) and enter the pending-discussion
  path. A generic For/Against majority must not fabricate permanent members' positions.
- A P5 outcome is a distinct manual outcome record. Do not reuse majority buttons to manufacture a P5 tally.
- Preserve any ballot already entered. Switching recording method or starting over creates a distinct
  attempt with explicit confirmation; never silently erase earlier choices.
- Only finalising a valid whole-resolution vote closes the resolution. A clause vote or a pending veto
  discussion cannot invoke the existing resolution-close command by accident.

## 4. Persistent model and compatibility — engineering proposal

The exact schema/command names are Claude's implementation choice. Review the contract first, then implement
client and server behavior together; do not expose working-looking controls backed only by local state.

- A committee has an explicit procedure profile: resolution-wide or clause-by-clause. Default the SC/HSC
  setup to clause-by-clause; do not guess the procedure from a substring in a committee's display name.
  Veto eligibility continues to use that committee's configured permanent-member delegations.
- Each resolution owns ordered clauses with stable identity and revision/attempt history. A ballot has its
  own identity and target (`clause` or `whole resolution`), session, attempt, rule snapshot, recording method
  and lifecycle. The P5 outcome belongs to that same ballot; it is not another plenary round.
- Never key every ballot solely by resolution + session: successive clauses and the final vote must not
  replace one another. Preserve historical resolution-wide ballots as legacy whole-resolution attempts.
- Persist the active clause/ballot context and show the same target on both Chair devices. Commands must
  include their intended target and revision so stale/offline work cannot land on whichever clause is
  current when it reconnects. Save all outcomes through the existing durable outbox/idempotency path.
- Reject stale/duplicate finalisations, other-committee commands, archived-session live mutations and
  corrections to already superseded attempts. An explicit audited correction/new attempt must retain the
  original record. Access revocation must continue to apply on the server.
- Keep original plenary results, veto raised, manual P5 outcome and final effective result distinct. Do not
  alter the underlying named choices to represent an overturned veto. Existing non-SC/HSC procedures and
  historical records must remain valid.
- Include scoped state in the established snapshots, with bounded historical reads where needed. Keep the
  compact Executive snapshot and avoid per-clause polling. Executive resolution status shows the actual
  parent status plus current clause/final-vote progress; never label a passed clause as a passed resolution.
- Review any migration independently and replay it on staging before release. This brief creates no hosted
  resources, applies no migration and changes no production configuration.

## 5. Current implementation gap

Verified against `codex/priority-chair-ui` at `9b3b9e2`:

- `components/voting-console.tsx` has one resolution ballot, requires every eligible country to be selected,
  displays a veto as `FAILED — VETO`, and closes the resolution itself.
- `lib/commands.ts` (`votingOutcome`, `vetoDelegates`) calculates a resolution/session result and immediately
  returns Failed when a configured permanent member casts Against on a substantive vote.
- `lib/procedure/types.ts` / `commands.ts` expose resolution-level `voteMode`; there is no stable clause target,
  recorded majority method, separate ballot identity, or manual P5-outcome command.
- `supabase/migrations/20261006023111_chair_procedure.sql` enforces the resolution-level veto/close path on the
  server. Changing the client display alone cannot implement the requested procedure correctly.

Do not describe existing configurable veto rules or Divide the House as completion of this package.

## 6. Acceptance and test cases for Claude

1. In SC and HSC, pass clause 1, fail/remove clause 2, revise/reconsider clause 3, then open the final vote on
   the surviving text. Each attempt/result remains identifiable after reload or a session change.
2. An otherwise passing clause with a veto remains pending. Chair records Veto upheld: clause fails without
   closing the resolution. Chair records Veto overturned in a separate test: clause passes. No P5 ballot,
   count, threshold or conversation is created in either case.
3. The final whole-resolution vote can fail after clauses passed, or pass after failed clauses were removed.
   A final-vote veto uses the same pending stage and manual P5 outcome before closure.
4. Both majority directions work in ordinary eligible voting. History explicitly says observed majority;
   exact counts and named choices stay unrecorded. Veto-capable committees require the separate veto check.
5. Divide the House remains a named ballot; Present & Voting cannot abstain. Two-thirds and legacy counted
   voting retain their existing arithmetic. P5 override only resolves the veto; it does not manufacture a
   favourable plenary majority where the initial plenary ballot itself failed.
6. Reload/offline/reconnect, two Chairs acting concurrently, duplicate submits, expired access, cross-committee
   requests and archived sessions preserve scope, history and exactly-once effects. A delayed clause-1 action
   cannot alter clause 2 or a final vote.
7. Speeches/POIs/amendments show the correct clause context without changing contribution totals or awarding
   Main Submitter credit again. Existing roll call, compact search and side-by-side speeches still work.
8. Demo and database engine agree; migration replay and required checks pass. Browser checks cover phone,
   desktop, keyboard and the existing truthful fixed sync strip. Report staging and hardware limits honestly.
