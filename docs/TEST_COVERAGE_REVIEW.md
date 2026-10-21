# Test coverage review (October 2026)

A pass over the seven areas the owner named, before the 5–7 November conference. Each area lists what the suite already covered, what this review added, and what is still open. Every new test runs locally: the PostgreSQL tests use PGlite with every committed migration applied (`tests/helpers/database.ts`). None of them touch a hosted Supabase project.

| Area | Already covered | Added | Still open |
| --- | --- | --- | --- |
| Committee setup | Archive/delete blockers, committee edits, staff batches (`archive-blockers`, `staff-batch-*`) | `committee-setup.test.ts`, client and PostgreSQL: unique trimmed codes, one session per active schedule slot (archived slots skipped), all-or-nothing delegate import, case-insensitive duplicate emails (existing and within the file), unknown committee or school, Chair refused | — |
| Chair access-code redemption | Redeem into scoped grants, reuse on a second device, rotation, revocation, generic failures, rate limit, bootstrap (`access-codes-*`, `bootstrap-first-executive`) | `chair-redemption-db.test.ts`: code typed in lower case with spaces, grant expiry equals code expiry, repeat redemption keeps one grant, a redeemed Chair can write GA1 but not WHO, an expired code is `invalid` and grants nothing, a lapsed grant loses access | Archive-vs-redemption races run only on PostgreSQL 17 (CI) |
| Participation scoring | Configured values, Main Submitter credit once per resolution (configurable value, and a queued score refused as a retained conflict when the value changed: `configurable-points-db`), POIs, deductions, contribution counting, leaderboard (`procedure-usability*`, `participation-view`, `point-adjustments-db`) | — | — (Main Submitter exactly-once is serialised by the committee row lock in `apply_mutation`) |
| Resolutions and amendments | Lifecycle, submissions, Docs-only links, amendment links, history (`submissions*`, `amendment-*`, `resolution-*`, `workflows`) | — | — |
| Voting | Veto scenarios, Divide the House refusing abstentions, roll call removing ineligible ballots, close with the correct outcome (`procedure`, `database`, `workflows`) | `voting-rules.test.ts`: simple-majority tie fails, abstentions excluded, all-abstain fails, two-thirds inclusive (4–2 passes, 3–2 fails), committee rule overrides the conference rule, ballots from another session ignored, and a PostgreSQL parity check that closing accepts exactly the outcome the client computes | The `votingRule` setting has no Executive UI; it is set only in data |
| Executive approvals | Decisions recorded once, comment-free approval, change requests need a comment, role transitions (`approval-*`) | — | — |
| Offline sync and recovery | Restart, lost response, duplicate retry exactly once; durable conflicts; lease expiry; recovery export; save status (`offline`, `sync-*`, `access`, `save-status`, `system-status`) | — (protected area; no changes) | — |

## Findings

* **Behaviour confirmed, no defects found.** The client (`lib/commands.ts` `votingOutcome`) and the server (`private.apply_mutation`, document close) agree on every voting case tested. Committee import in SQL is atomic and enforces conference-scoped committee and school keys.
* **Voting rule has no UI.** `voting_rule` exists on conferences and committees and is honoured by both backends, but no Executive screen sets it. If DCMUN needs two-thirds for any committee, it has to be set in the data before the conference. This needs an owner decision; see the clear-majority plan.
