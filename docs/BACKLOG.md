# Remaining product and release work

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
leaderboard separately shows points. Do not mark either ranking requirement complete based on the older UI.
