# PHESMUN → MUNOS feature parity through PR #13

Source check: 19 October 2026. Live GitHub branch `claude/epic-clarke-djmafa` is still `0a43c73aec4e839cdfab79ed493285e9aa8233eb`. Compared PHESMUN merged PR metadata/file lists and selected patches with the exact local MUNOS source snapshot reviewed at that SHA. This is a source inventory, not a new hosted or per-feature runtime validation. The previous independent full suite at this SHA passed 407 tests including PostgreSQL 17.

**Verdict: the port is incomplete.** Presence of the UI overhaul and sync work does not imply feature parity.

| PHESMUN PR | Implemented behaviour | MUNOS evidence at 0a43c73 | Disposition |
|---|---|---|---|
| [#1](https://github.com/zhrsidd/PHESMUNOS/pull/1) | Time-zone header date; About credits; one-off smoke cleanup record | No `app/about/page.tsx` or `lib/brand.ts`. New Assembly header removed the date entirely. Existing `lib/operations/time.ts` supports conference-zone formatting. | About/credits missing: port using DCMUN values. Removed header date is a deliberate shell replacement; do not restore clutter just for parity. PHESMUN smoke-cleanup SQL stays excluded. |
| [#2](https://github.com/zhrsidd/PHESMUNOS/pull/2) | Optional delegate email in CSV, edit and database | `lib/import.ts` requires a valid email and deduplicates even empty values; command import also requires email. Migration `20261010150000_optional_delegate_email.sql` absent. | Missing. Port semantics across import, editor, domain and database; blank emails must not become duplicates. |
| [#3](https://github.com/zhrsidd/PHESMUNOS/pull/3) | Edit/remove Chairs with reassignment; automatic Debated Amendment credit | Commands have staff creation and `staffContact`, but no `staffUpdate`/`staffRemove`. `lib/scoring.ts` required categories are speech, poi and submitter; both feature migrations absent. | Missing. Contact-email editing is not equivalent to staff edit/removal. Port with access/reassignment review and configurable amendment value; retain exactly-once credit semantics. |
| [#4](https://github.com/zhrsidd/PHESMUNOS/pull/4) | Print copies equal committee delegates +3 spares at approval | No `lib/print.ts` or `20261010200000_print_copies_from_delegates.sql`; resolution creation still assigns `copies: 24`, and approval does not recalculate. | Missing. Port server/local consistency and confirm the already proposed delegates +3 rule in the plan. |
| [#6](https://github.com/zhrsidd/PHESMUNOS/pull/6) | School import accepts a committee column and optional email | `validateImport` has only rows/mapping/existingEmails; no committee lookup parameter or `matchCommittee`. UI maps name/country/email rather than each row's committee. | Missing. Keep existing single-committee workflow and add validated committee-column mapping/preview. |
| [#7](https://github.com/zhrsidd/PHESMUNOS/pull/7) | Initial Leo UI/images from a branch whose title mentions Drive | Actual changed files are Leo helper, workspace, CSS and two images. None of the assistant UI is in the target. | Superseded upstream by #9/#11; port the later assistant as Felix. Do not exclude the useful assistant merely because the PR title says Drive. Mirroring remains retired. |
| [#8](https://github.com/zhrsidd/PHESMUNOS/pull/8) | Executive all-committee resolution overview; guarded test cleanup | No `executive-resolution-overview.tsx`, `resolution-overview.ts` or `admin/resolution-status` route; the shared status/history code does not provide this Executive screen. | Overview missing. Port read-only behaviour efficiently. PHESMUN-specific cleanup remains excluded. |
| [#9](https://github.com/zhrsidd/PHESMUNOS/pull/9) | Leo message-state TypeScript fix | Assistant absent. | Incorporate via the #11 Felix port rather than recreating obsolete intermediate code. |
| [#10](https://github.com/zhrsidd/PHESMUNOS/pull/10) | Make the PHESMUN cleanup script atomic in SQL Editor | One-off PHESMUN cleanup; no DCMUN product feature. | Deliberately excluded. Retain the general guarded-transaction principle for any separately authorized maintenance. |
| [#11](https://github.com/zhrsidd/PHESMUNOS/pull/11) | Trustworthy deterministic operations assistant, local chat, reminders, shared navigation | `lib/navigation.ts` exists as a newer Assembly destination map; no `lib/leo`, `leo-helper.tsx` or Leo tests. A navigation refactor alone is not an assistant port. | Assistant missing. Reuse the current destination map and port as Felix with DCMUN content and the previously proposed inbox/message/popup improvements. |
| [#13](https://github.com/zhrsidd/PHESMUNOS/pull/13) | Batch confirmation reads, backoff/jitter, passive refresh throttling and honest health | Sync port `122545f`, later confirming-read/gateway fixes, existing `backoff.ts`, repository changes and sync/realtime regressions; latest UI status fix `0a43c73` independently verified. | Covered with later improvements. Preserve the reviewed confirm/idempotency/access behaviour rather than overwriting it with an older diff. This does not certify conference-week capacity. |

PR #5 (Web Analytics) was unmerged when checked, so it is outside the implemented-feature set. No PR #12 was returned in the repository's pull-request listing. PHESMUN PR #14's recovery system and PHESMUN-specific operation/cleanup targets remain excluded by the existing port manifest.

## Additional source findings for this request

- Google Doc links are format-validated in `lib/submissions/google-doc.ts`, whose comment explicitly says document text is never read. There is no proof of Anyone-with-link access in that parser. The submission service and `OpenSubmittedFile` still support uploaded files. Fix both the public write path and the handoff UX.
- `Staff` has no `schoolId`; photo reminders derive affected committees only from delegates and filter out school slots without delegates. Including Chairs requires explicit affiliation plus reminder/count changes, not a wording change.
- Main Submitter remains fixed at +5 through `MAIN_SUBMITTER_POINTS`, `isConfigurableScoring`, `conferenceScoring` and `scoringProblem`.
- The voting console and `document` close validation require every eligible ballot. A clear-majority shortcut needs reviewed state/command/server semantics.
- `navigationFor('chair')` still includes Award discussion; the route allowlist still includes `chair/awards` and `admin/awards`.
- The older design prompt says uploaded-file access remains and Participation sorts by points. The new owner brief supersedes these instructions for new submissions and default Participation ranking, while preserving historical file access.

## References

- [Exact MUNOS source](https://github.com/zhrsidd/MUNOS/tree/0a43c73aec4e839cdfab79ed493285e9aa8233eb)
- PHESMUN PR links above are the live metadata/patch sources checked for this inventory.
- Owner-provided `DCMUN-v2.1-addendum-and-port-manifest.zip`: the feature migrations and selected ports remain dependent on staging replay; operations-specific files and recovery system are not port targets. Its older recommendations do not override the current owner brief.
