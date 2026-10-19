# UI priorities and first implementation package

Owner-authorised Codex implementation, 19 October 2026. Base: Claude branch `0a43c73`.
Branch: `codex/priority-chair-ui`. Claude can review and clean up this package independently.

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
3. **Executive resolution status.** Useful all-committee status/feedback/working-document overview using existing
   scoped state; no per-row polling or audit-log exposure to other roles.
4. **Participation by contributions, Debate by points.** Contribution count descending, stable country/name/id
   ties, no points tie-break; define counted amendments and submitter credit first. Preserve editing focus and
   align exports. Separate compact, bounded Debate leaderboard contains every country, flag and point total,
   explicitly labelled scope, including ties/zero/negative totals. Replace the suggestions panel there.
5. **Compact entry screen and shared layout cleanup.** Useful role cards in the first viewport; authorised
   roles and sole-workspace auto-entry preserved. Consistent buttons, wrapping, content widths and alignment
   across workspaces at phone widths and 200% zoom. Preserve roll call, documents and side-by-side speeches.
6. **About and parity.** Accurate PHESMUN About credits (Zuhayr Siddique and John Paul Ribeiru); audit merged
   features through PR #13, recording verified equivalents, deliberate retirements and omissions. No recovery
   system from PR #14 or unmerged PR #5 requirement.
7. **Felix and restrained loading/motion.** Owner-selected supplied Launcher head at 48 px, six expression
   frames, blink/typing/petting response, motion-off and reduced motion. Deterministic Leo port with reviewed
   DCMUN knowledge, short popups above Felix, persistent discoverable inbox and blocker-resistant in-app notices.
   No implied generative AI service. Adapt the selected Watermelon Skeleton/Spinner/Combobox/Continuous Tabs/
   Copy Confirm principles to current tokens; no wholesale template or automatic dependency installation.
8. **Protected contracts next.** Clear-majority observed voting without fabricated named ballots; explicit school
   affiliation so scheduled school photos include Chairs; configurable Main Submitter and Debated Amendment
   points with historical values/idempotency retained. Define and review migrations/contracts independently.

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
Orbit seal recommended. The alternatives are Slow seal spin, Breathing seal and Assembly dots. Online references,
timing, reduced motion and integration rules are recorded there. This is a design proposal, not an implemented
loading-screen claim. Keep the persistent sync strip for background work and never delay ready content.
