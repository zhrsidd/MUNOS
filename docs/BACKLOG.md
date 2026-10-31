# Remaining product and release work

## Current status · 31 October 2026

This status supersedes older implementation and migration claims in the dated handoff documents. It is checked against the local baseline `682ab47`, the [project setup record](SUPABASE_PROJECT_SETUP.md), the [31 October run-sheet session update](LOAD_RUN_SHEET_2026-10-31.md#3a-what-changed-with-the-session-model-read-before-pf3a) and the [recorded load evidence](../evidence/load-2026-10-31/SUMMARY.md). It is not a new hosted verification.

| Area | Implemented / recorded evidence | Remaining |
| --- | --- | --- |
| Session model | #84 and #88 merged: committee live state, schedule labels, roll calls, ballot snapshots, device protocol and Executive held-action review. Attendance conversion, timer-table retirement and the reports/export audit are complete; see [SESSION_MODEL.md](SESSION_MODEL.md). | Final-candidate functional checks, including held-action review on synthetic data; automatic queue clearing remains approved but deferred. |
| Reviewed feature migrations | Approval history, chosen-amount adjustments, configurable points, Chair-school photos, clear-majority voting, print copies and identity projection are implemented. The setup record documents their application; #95 records all 37 migrations present in preproduction. | Recheck the exact candidate/schema and signed-in workflows during final verification. Do not treat the old PR #22 or 20 October unapplied notes as current status. |
| Read-path improvements | #93 committee pre-filter is applied, recorded by #95; #94 own-echo suppression and 15-second support-role refresh are merged. | Capacity has not been retested with these changes. Full snapshots remain the shipping contract; delta reads are a separately reviewed follow-up. |
| Capacity | 31 October H3 was a **NO-GO**, run as a diagnostic after failed ramps: worst-action write p95 2,726 ms, read p95 6,215 ms, 181 pending and 4 conflicts at close. | A clean 110-device / 19-committee / 30-minute run, 75/20/10/5 roles, 150 public page loads and 16 submissions, with the original thresholds and manual checks. |
| Final test | Owner selected **1 November 2026, 16:00–18:00 Qatar (13:00–15:00 UTC)**; see the [readiness specification](superpowers/specs/2026-10-31-final-rehearsal-design.md). | Freeze and independently review the candidate, complete prerequisites, name operator/watcher and record GO before hosted traffic. The selected window is not an executed test or release approval. |

Governance and historical handoff: [START_HERE.md](START_HERE.md). The [v1 release checklist](V1_RELEASE_CHECKLIST.md), [lifecycle controls](LIFECYCLE_CONTROLS.md) and [26 October scope decision](RELEASE_SCOPE_2026-10-26.md) retain authority: direct RPC is approved for this conference; gateway and signed attestation are deferred. Production promotion, retirement, rollback evidence and John Paul Ribeiru's release approval remain separate gates.

The initial backlog was superseded by the approved core integration. Staff access codes, central sessions, the amendment QR workflow and System health in every staff workspace (PR #12–#16), QR resolution submission, school group-photo reminders and configurable Security Council veto rules are implemented, with verification limits recorded in [INTEGRATION_REVIEW.md](INTEGRATION_REVIEW.md). The original shared current-session selector was subsequently replaced by derived schedule labels in #84.

Public workspace labels are **Admins** and **Executive**; internal role identifiers and routes are unchanged. Award rubric controls and the Award discussion page are retired. Historical participation records remain available; award decisions stay with Chairs.

Still deferred:

- Amendment editor, document parsing and automatic amendment application. (Amendment QR submission and the Chair amendment workflow exist since PR #13; Chairs still edit the working Google Doc manually.)
- Motions, announcements and general logistics requests.
- Legacy Google Docs `resourcekey` preservation in canonical links (low priority).

Release work remains: verify the final candidate's real public HTTP and Google Docs access paths (new file uploads are retired), rehearse physical staff devices and delegate QR bursts, retest read-tail latency, and complete the existing single-project lifecycle, monitoring and rollback gates. The 31 October diagnostic accepted 150 public page loads and 16 submissions; this does not clear the capacity or physical-device gates. PR #6 remains draft and must not be merged as part of this integration.

Claude is the primary engineer across the application; Codex supplies review and specialist work, including the owner-authorised simple UI pass. Shared architecture changes are serialized and cross-reviewed.

Google Drive mirroring and automation are **retired** (owner decision, October 2026). See `docs/OPERATIONS.md` for the retirement checklist.

## Current owner UI priorities

See [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md) for the current status and dated first-package evidence. Google Docs-only submission is enforced; automated access-verification states and recheck remain separate work with explicit verification limits. The new
contribution-ranked Participation view supersedes the earlier points-order requirement; the compact Debate
leaderboard separately shows points. Both new rankings and the Executive resolution-status overview are
implemented in the follow-up package, with local verification in UI_PRIORITY_PASS.md. Global buttons and
spacing remain assigned to Claude: see [CLAUDE_VISUAL_CLEANUP.md](CLAUDE_VISUAL_CLEANUP.md).

## Clear-majority voting

Implemented and merged in #37; migration `20261021110000_clear_majority` was applied and signed-in browser behavior recorded on 21 October in [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md). It records the Chair's observed majority For / Against without named country choices or invented counts, preserves counted voting and veto behavior, and binds confirmation to the ballot revision. [CLEAR_MAJORITY_VOTING.md](CLEAR_MAJORITY_VOTING.md) preserves the design; final-candidate voting checks remain required.
