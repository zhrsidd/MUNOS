# UI priorities and first implementation package

Repository review follow-through: [START_HERE.md](START_HERE.md) records the shared agent context, governance and post-merge Graphify refresh; the [PR #22 acceptance gate](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate) covers migrations and the sync changes. Existing owner decisions and feature statuses below are retained; none is upgraded to staging or release acceptance by this documentation update.

Owner-authorised Codex implementation, 19 October 2026. Base: Claude branch `0a43c73`.
Branch: `codex/priority-chair-ui`. Claude can review and clean up this package independently.

## Claude handoff coverage · 20 October 2026

This is the active feature handoff, alongside [CLAUDE_VISUAL_CLEANUP.md](CLAUDE_VISUAL_CLEANUP.md).
The owner removed the SC/HSC clause-by-clause and informal P5-outcome proposal from this handoff on 20 October.
General clear-majority voting remains a separate request. Do not revive the removed proposal from Git history.
Statuses below describe the reviewed branch; implemented locally does not mean released or verified in staging.

| Owner request | Handoff / current status |
| --- | --- |
| Claude primary engineer across the whole app | `AGENTS.md` updated; Codex provides review/specialist support. |
| DCMUN seal identity, DeutschLab principles, Assembly direction | [BRAND.md](BRAND.md); preserve and finish applying tokens to shared components. |
| Global ugly buttons, uneven spacing, panel widths and action alignment | Claude's dedicated [visual cleanup brief](CLAUDE_VISUAL_CLEANUP.md), across every workspace and dialog; pending. |
| Compact home/workspace chooser with useful first-viewport role cards | [Assembly home proposal](HOME_SCREEN_PROPOSAL.md) and local reference implemented 20 October; desktop/phone screenshots included. Claude review remains; role gates and auto-entry preserved. |
| Declutter and remove useless tabs/duplicate actions | Continue the all-workspace inventory in [UI_OVERHAUL.md](UI_OVERHAUL.md); preserve roll call and side-by-side For/Against speeches. |
| Resolution documents overhaul and easy-to-see approval comments | Preview/mock-version clutter removed; latest full feedback visible. Preserve in the visual pass. |
| Approval history and chosen-amount deductions/restores | Code and migrations written; independent review accepted them for staging replay. [Review packet](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md); migrations remain unapplied. |
| No PDF submissions; native Docs and Anyone-with-link access | Docs-only enforced on client and server on 20 October (files refused, Word-in-Docs links refused, historical files still readable). Automated access check specified with its verification limits in [GOOGLE_WORKSPACE_ACCESS_MODEL §7](GOOGLE_WORKSPACE_ACCESS_MODEL.md#7-google-docs-only-submissions-and-access-checks--20-october-2026); its states/recheck need a reviewed migration and are not implemented. |
| Drive mirroring and award discussion removal | Retired; preserve ordinary Google Docs links and history. Complete/check server-timer and projector retirement; keep the local speaker timer. |
| Executive resolution status across committees | Implemented locally in `9b3b9e2`, including feedback and source links; review and cloud verification remain. |
| Participation ranked by contributions; compact Debate points list | Implemented locally in `9b3b9e2`; [counting contract](PARTICIPATION_VIEWS.md), focus freeze and manual scoring preserved. |
| Searchable speech/POI dropdown, Enter picks first, compact footprint, opportunity ordering | Implemented locally; review keyboard, eligibility and Fewest/Most behavior during cleanup. |
| Permanent minimal sync strip under navigation | Implemented locally; preserve fixed geometry, truthful read/save states and native-dialog failure alerts. |
| Passed amendments remain available after debate/session changes | Implemented 20 October: Chair → Amendments → *Passed amendments*, grouped by original resolution with exact wording/type/clause/delegation, working-Doc link and honest copy feedback; reads newest-first in pages of 50 under the existing table RLS (committee Chair or Executive); no migration. The time an amendment passed is not stored, so the submitted time is shown and labelled. |
| Clear majority For / Against | Pending; separate [voting brief](CLEAR_MAJORITY_VOTING.md), with no fabricated country ballots. |
| Chairs included in their school's scheduled group photo | Pending: explicit Chair-school affiliation and matching, with existing reminder/acknowledgement behavior retained. |
| Main Submitter and Debated Amendment points configurable | Implemented 20 October in a draft PR with migration `20261021090000_configurable_points` (**not applied**; needs Codex review and owner approval). Main Submitter is one value from 1 to 20 (default +5), still once per resolution; Debated amendment is a required category (default 3), awarded manually. Stored credits keep their points. |
| Port PHESMUN About and check feature parity through PR #13 | About ported 20 October in its own PR: public `/about`, DCMUN seal, credits Zuhayr Siddique (creator) and John Paul Ribeiru (Development Contributor) and the PHESMUN licence wording, linked from every workspace footer. Parity table: Codex audit 20 October §D; missing ports (print copies, optional email/committee import, staff edit/remove) are tracked separately. |
| Leo becomes Felix, with all proposed Leo improvements | Pending: owner-approved Launcher head at 48 px, six expression frames, blink/eyes/mouth while typing and cheerful petting hover; deterministic DCMUN content, short popups above Felix, discoverable persistent inbox, blocker-resistant in-app notices, motion-off/reduced motion. Include supplied assets; do not substitute a new mascot or claim assets are ported until present. |
| Orbit seal loading, suitable Watermelon components and gentle transitions | Orbit initial loading implemented; adapt Skeleton, Spinner, Combobox, Continuous Tabs and Copy Confirm principles as suitable. Broader transitions/loading states remain pending; no delayed ready content or unnecessary dependency. |
| Existing session and reliability work | Keep [SESSION_MODEL.md](SESSION_MODEL.md) and its sign-off gate; do not confuse the removed procedure proposal with removal of the session work. Preserve offline recovery, export, conflicts, permissions and print copies = delegates + 3 spares. |
| Release and capacity verification | Staging replay, signed-in flows, rollback and realistic 19-committee rehearsal remain outstanding. Size the rehearsal for the owner's 57 Chairs, about 10 Approval devices, 5–6 printing devices and Executive/spares, with 1–2 active Chairs per committee. |

## Implemented in this package

1. **Compact country search for speeches, POIs and yield.** Uses the current eligible-delegate lists, existing
   country aliases and a small local typo matcher. Exact matches precede prefixes, substrings and typo matches.
   No backend requests or package dependencies. Enter chooses the highlighted/top result without submitting the
   form; queue/POI/yield buttons remain explicit actions. Escape retains the selected country. For/Against
   selections are independent, and stale/ineligible choices cannot be added. Five-row scrolling popup overlays
   the page, with current-session non-voided speech/POI counts and Fewest/Most first. Ordering stays stable while
   open; counts remain live. Zero-point genuine contributions count; submitter credit, adjustments and voids do
   not manufacture speech/POI counts. Eligibility and recording commands are unchanged.
2. **Stable sync strip below navigation.** Always rendered in all four workspaces, including System health.
   Reuses `saveStatus` so failed reads, waiting work and locally durable saves keep their reviewed meaning.
   One reserved-height slot replaces the masthead indicator and conditional banner; Open details stays available.
   Navigation/strip stick while the large masthead/context can scroll away. Failed-save dialog alerts remain.
3. **Award discussion retired.** Removed navigation entry, Chair/Executive page content, unused icon and UI
   capability label. Old Chair bookmarks redirect to Participation; Executive bookmarks redirect to Scoring.
   Historical records and the already-retired command checks are preserved. The offline shell never contained
   the award routes. Cache version 0.2.5 refreshes the changed shell assets without changing bypass rules.

## Follow-up functional package

Implemented: contribution-ranked Participation, compact conference-points Debate leaderboard and read-only
Executive resolution status at `/admin/resolution-status` (Operations menu and Overview shortcut).
See [PARTICIPATION_VIEWS.md](PARTICIPATION_VIEWS.md) for counting rules. Existing scoped snapshots supply all
three views; no extra polling, schema or permission changes.

**Claude: the owner explicitly requests a global button and spacing overhaul.**
See [CLAUDE_VISUAL_CLEANUP.md](CLAUDE_VISUAL_CLEANUP.md) for the owner's feedback and acceptance checks.
This functional package does not claim that cleanup is complete.

## Remaining priority order

These are the owner's current requirements, including superseding decisions. They are not marked done by this
package. Continue from the existing Assembly implementation, rather than reintroducing retired workflows.

1. **Google Docs-only submissions and access verification.** Native working Docs only for new submissions,
   including the server endpoint; preserve historical attachments. Explicit Anyone-with-link instructions,
   bounded type/access checks, verified/restricted/unable states, timestamps and recheck at Chair/Approval
   handoff. URL shape or a signed-in success cannot prove anonymous access. Specify verification limits before
   implementation. Do not restore Drive mirroring.
2. **Passed amendment history.** Exact wording, type, clause, submitter, outcome, time, honest clipboard feedback
   and working-Doc link remain accessible by original resolution after closure, session changes and reload.
   Bound/paginate older history and verify permissions; the current active-resolution inbox is insufficient.
3. **Executive resolution status — implemented in the follow-up package.** Useful all-committee status/feedback/working-document overview using existing
   scoped state; no per-row polling or audit-log exposure to other roles.
4. **Participation by contributions, Debate by points — implemented in the follow-up package.** Contribution count descending, stable country/name/id
   ties, no points tie-break; define counted amendments and submitter credit first. Preserve editing focus and
   align exports. Separate compact, bounded Debate leaderboard contains every country, flag and point total,
   explicitly labelled scope, including ties/zero/negative totals. Replace the suggestions panel there.
5. **Compact entry screen and shared layout cleanup.** [Home proposal and local reference](HOME_SCREEN_PROPOSAL.md)
   implemented with useful first-viewport role cards; authorised roles and sole-workspace auto-entry preserved.
   Claude review and global cleanup remain. Consistent buttons, wrapping, content widths and alignment
   across workspaces at phone widths and 200% zoom. Preserve roll call, documents and side-by-side speeches.
6. **About and parity.** Accurate PHESMUN About credits (Zuhayr Siddique and John Paul Ribeiru); audit merged
   features through PR #13, recording verified equivalents, deliberate retirements and omissions. No recovery
   system from PR #14 or unmerged PR #5 requirement.
7. **Felix and restrained loading/motion.** Owner-selected supplied Launcher head at 48 px, six expression
   frames, blink/typing/petting response, motion-off and reduced motion. Deterministic Leo port with reviewed
   DCMUN knowledge, short popups above Felix, persistent discoverable inbox and blocker-resistant in-app notices.
   No implied generative AI service. Adapt the selected Watermelon Skeleton/Spinner/Combobox/Continuous Tabs/
   Copy Confirm principles to current tokens; no wholesale template or automatic dependency installation.
8. **Protected contracts next.** [Clear-majority For / Against](CLEAR_MAJORITY_VOTING.md), recorded as an observed
   result without fabricated named ballots; explicit school affiliation so scheduled school photos include
   Chairs; configurable Main Submitter and Debated Amendment points with historical values/idempotency retained.
   Define and review migrations/contracts independently.

Staffing note: organisers should arrange both Chairs' presence; this is not a new software control.

## Verification and handoff

- Automated suite: 404 tests, 400 passed, 4 existing PostgreSQL 17 concurrency skips, 0 failed. Focused
  search/navigation/save-status/health/offline-shell regressions: 26 passed, 0 skipped. Typecheck, lint (zero
  warnings) and production build pass.
- Production-build Chrome demo checks at 320/390/768/1280 px: Enter selects without mutation, a new query replaces
  the selected display while focus remains, arrows/Tab/Escape, no matches, POI add, independent For/Against,
  no horizontal overflow, correct retired-route HTTP 307 responses. For/Against remain side by side at desktop.
- Real browser offline/reconnect: first content position moves 0 px. All nine representative status labels
  fit the same fixed strip geometry (other cloud labels injected for layout only, not real cloud transitions).
  One strip and correct System health link verified in all four demo workspaces. The 320 px run requests reduced
  motion. A separate 640 x 450 viewport check verifies touch option selection and popup containment.
- Local search benchmark: 800 searches over 500 synthetic delegates, median 1.12 ms, p95 2.44 ms, maximum 16.83 ms.
  A local Chrome sample with 512 eligible delegates measured eight input-to-next-frame intervals at 15.6-16.8 ms,
  with no observed long tasks during that sample. These are local synthetic checks, not Chair-device guarantees.
- No new package dependencies. No full Watermelon template/component source was copied. Existing Assembly
  tokens and primitives are used. Screenshots and raw local measurements are in ignored `artifacts/ui-priority/`.

Not verified: real screen-reader announcements, live IME use, actual browser 200% zoom, authenticated staging,
real cloud pending/conflict transitions, representative Chair hardware or the full conference-week workload.
The short-viewport check is not presented as an actual 200% browser-zoom check. Broader role-screen declutter,
including existing operation toasts, remains in the queue above.
No hosted environment, production configuration, migration, server permissions or durable transport changed.
Authenticated staging replay and the conference-week Pro/Small capacity rehearsal remain outstanding.

## Loading-screen design follow-up

[LOADING_MOTION_PROPOSAL.md](LOADING_MOTION_PROPOSAL.md) adds four owner-requested logo-based studies, with
Orbit seal selected by the owner and now implemented in the initial staff loading states. The alternatives
remain Slow seal spin, Breathing seal and Assembly dots. The linked document records online references, timing,
reduced motion, app verification and remaining limits. Background work keeps the persistent sync strip; ready
content is not delayed. Row skeletons, other loading primitives and broader transitions remain pending.

## Follow-up package verification · 19 October 2026

- Full automated suite: 416 tests, 412 passed, 4 existing PostgreSQL 17 concurrency skips, 0 failed.
  Typecheck, lint (no warnings) and production build pass.
- New functional coverage: contribution rules (zero points, voids, distinct POIs, recorded amendments,
  automatic submitter credits, duplicate ids), deterministic ties, focus freeze, net points/adjustments,
  lifecycle progress, empty/archived committees, filtering, safe Doc links and Chair-only role denial.
- Production-build Chrome demo checks at 320/390/768/1280 px: all 12 committee delegations in the bounded
  keyboard-scrollable points list; no horizontal overflow; full latest feedback; read-only Executive rows;
  local country/status/code filtering; empty/no-match states. The 320 px run requests reduced motion.
- Six real contribution saves keep keyboard-focused rows stable, then update the rank on leaving the list.
  A deduction changes the numeric total without changing contribution rank; restoring and reloading preserve
  the result. Executive resolution status also reloads and filters offline after shell preparation.
- Snapshot/API/outbox contracts and permissions are unchanged. Executive uses the existing bundled compact
  snapshot; no per-row fetching or new polling is added. Worker shell cache is 0.2.7 for the new route/assets,
  with API/auth bypass and 401/403/404 behavior preserved. No hosted resource or migration was changed.
- Screenshots and browser result details are in ignored `artifacts/participation-views/`.

Not verified: authenticated staging/cloud behavior, screen-reader announcements, actual browser 200% zoom,
representative Chair hardware or the conference-week workload. The global button and spacing overhaul remains
Claude's task; these features do not mark it complete.

## Home screen proposal · 20 October 2026

[HOME_SCREEN_PROPOSAL.md](HOME_SCREEN_PROPOSAL.md) contains the owner-requested Assembly home design,
tracked desktop/mobile screenshots, access-state rules, a working local reference and verification limits.
This completes the local home proposal, not the all-workspace button/spacing overhaul.
