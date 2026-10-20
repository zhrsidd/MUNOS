# Remaining product and release work

Current handoff context and governance: [START_HERE.md](START_HERE.md). PR #22's independent review, authenticated staging migration replay and sync acceptance remain explicit gates in the [review packet](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate); after an authorised merge, refresh Graphify to the resulting `main` commit. The session redesign remains a separate draft contract.

The initial backlog was superseded by the approved core integration. Staff access codes, central sessions, the amendment QR workflow and System health in every staff workspace (PR #12–#16), QR resolution submission, shared current-session selection, school group-photo reminders and configurable Security Council veto rules are implemented, with verification limits recorded in [INTEGRATION_REVIEW.md](INTEGRATION_REVIEW.md).

Public workspace labels are **Admins** and **Executive**; internal role identifiers and routes are unchanged. Award rubric controls and the Award discussion page are retired. Historical participation records remain available; award decisions stay with Chairs.

Still deferred:

- Amendment editor, document parsing and automatic amendment application. (Amendment QR submission and the Chair amendment workflow exist since PR #13; Chairs still edit the working Google Doc manually.)
- Motions, announcements and general logistics requests.
- Legacy Google Docs `resourcekey` preservation in canonical links (low priority).

Release work remains: verify the real public HTTP/file-upload path, rehearse staff devices and separate delegate QR bursts, address read-tail latency, establish protected staging/production, and complete monitoring/rollback drills. PR #6 remains draft and must not be merged as part of this integration.

Claude is the primary engineer across the application; Codex supplies review and specialist work, including the owner-authorised simple UI pass. Shared architecture changes are serialized and cross-reviewed.

Google Drive mirroring and automation are **retired** (owner decision, October 2026). See `docs/OPERATIONS.md` for the retirement checklist.

## Current owner UI priorities

See [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md) for the first implementation package and the remaining ordered
queue. Google Docs-only submission with honest access verification is the first larger task. The new
contribution-ranked Participation view supersedes the earlier points-order requirement; the compact Debate
leaderboard separately shows points. Both new rankings and the Executive resolution-status overview are
implemented in the follow-up package, with local verification in UI_PRIORITY_PASS.md. Global buttons and
spacing remain assigned to Claude: see [CLAUDE_VISUAL_CLEANUP.md](CLAUDE_VISUAL_CLEANUP.md).

## Clear-majority voting

Pending Claude implementation: [CLEAR_MAJORITY_VOTING.md](CLEAR_MAJORITY_VOTING.md). Record the Chair's
observed majority For / Against without inventing named country choices or counts; preserve existing counted
voting and veto behavior. See [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md) for the complete active handoff.
