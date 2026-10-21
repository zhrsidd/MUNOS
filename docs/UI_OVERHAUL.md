# UI and quality-of-life overhaul: approved plan

Approved by the owner. These are part of the overhaul, not optional suggestions. UI work proceeds now. Schema
changes stay coordinated and independently reviewed (see `AGENTS.md`). Performance and release validation on
Supabase Pro with Small compute stays outstanding for conference week and is not replaced by anything here.

Status key: ☐ not started · ◐ in progress · ☑ done (with the verification that closed it).

## Order and dependencies

```
W1 AGENTS.md ──┐
               ├─► W2 Brand identity ─► W3 Shell + navigation ─┬─► W4 Resolution documents tab ─┬─► W6c Approval history
W5 Drive removal (independent; before W4 ships)────────────────┘                                 └─► W6a/b rest
                                                      W3 ─► W7 Declutter all workspaces ─► W8 Release pass
```

W5 touches only code and docs that W4 also edits (the "Resources & Drive" tab, the documents footer note), so it
lands before W4. W6 items are small, independent and ride along with the screen they live on.

## W1 · AGENTS.md ☑

Rewrite around Claude as primary engineer across the whole application; Codex as reviewer and specialist;
no authorship-based restrictions; keep the production, secrets, migrations, access control and offline-data
safeguards.

Acceptance: no rule restricts Claude from core features; the five protected areas are listed with reasons; it
points at `docs/BRAND.md` and this plan; no reference to the ChatGPT mirror or `sources/` directory remains.

## W2 · DCMUN visual identity ◐ (BRAND.md, tokens, buttons, chips, focus, sidebar, lockup (`components/brand.tsx`) done; a mechanical pass moved ~120 grey text/border/background values onto tokens; remaining one-off hex values and the panel/modal/table primitives still to sweep)

Palette, typography, spacing, component styles and information hierarchy defined in `docs/BRAND.md` first,
adapted from DeutschLab's principles (colour roles, hairlines over cards, 4 px scale, measured contrast).

Steps: (a) `docs/BRAND.md`; (b) tokens in `app/globals.css` with the old variable names aliased so nothing
breaks; (c) shared primitives in `components/ui.tsx` (button, chip, row, callout, dialog, page heading) moved
onto the tokens; (d) header lockup; (e) manifest and theme colour.

Acceptance: contrast table in BRAND.md reproduced by a script; no new one-off hex values in components; every
status chip has a word; focus ring visible on every control; typecheck, lint, tests, build pass; real-browser
screenshots of the four workspaces at 360 px and 1280 px reviewed.

## W3 · Shell and navigation ◐ (one lockup, grouped sidebar, duplicate topbar role/DEMO chip removed, fake staff name/avatar and hard-coded date removed; Approval/Print/Executive tab consolidation continues)

One shell for Chair, Approval Panel, Printing and Executive: lockup, workspace and committee, sync status,
user menu, ≤ 5 tabs named for jobs. Auto-enter for single-workspace users is already in (`soleWorkspacePath`).

Acceptance: a Chair-only login lands in Chair with no picker; tab names match BRAND.md §5; sync status is a live
region; keyboard-only walk-through passes; no horizontal scroll at 320 px.

## W5 · Remove Drive mirroring completely ☑ (commit "retire Google Drive mirroring"; typecheck, lint, 354 tests pass)

Remove: `lib/drive/plan.ts`, `scripts/drive-plan.mts`, `npm run drive:plan`, `tests/drive-plan.test.ts`,
`docs/GOOGLE_DRIVE_ARCHITECTURE.md`; the "Resources & Drive" tab label (rename to "Resolutions"); the Drive
boundary panel and "Drive archive" row in admin/health; the "Drive will mirror…" note; "separate from future Drive
automation" copy; Drive entries in README, BACKLOG, OPERATIONS and runbooks. Keep ordinary Google Docs links,
`lib/submissions/google-doc.ts`, `resolution_links` and the manual "copy into Approval Panel folder" step.

Also list externally provisioned resources to retire, with the owner (nothing is deleted by me): any Google
Shared Drive or folder tree created for mirroring; any Google Cloud project, service account and keys created
for Drive automation; any Vercel/Supabase environment variables for such credentials; any scheduled jobs. The
repository contains no Drive API dependency or credentials (checked: no `googleapis` in `package.json`).

Acceptance: `grep -ri drive` over code, scripts, package.json and docs returns only "Google Docs/Drive link"
wording that describes ordinary link sharing; no dedicated dependency, script, env var or setting remains; tests
and build pass; a retirement checklist is in `docs/OPERATIONS.md`.

## W4 · Resolution documents tab ☑ (Chair tab, Approval detail, print queue; history via W6c)

Remove the document preview (the demo "paper", version picker and `<pre>` text). The list becomes the page. Each
resolution is one row showing, without opening anything: title, submitter, status chip, working-document link
(opens Google Doc), and the Approval Panel feedback (latest decision plus full comment text in a callout). One
primary next action per row from `nextAction`; redundant controls (mock version, timeline duplication, status
paragraph) removed. Approval history opens inline under the row.

Acceptance: every fact in the list above visible on a 360 px screen with no click; the latest Approval Panel
comment is readable in full on the row; no control appears twice; Chair permissions unchanged (same commands,
same server checks); a unit test covers row view-model (status → next action, latest feedback selection); a
browser check covers draft, submitted, changes-requested, approved.

## W6 · Functional quality-of-life

**W6a · Participation ranking ✓ (owner's contribution ordering implemented, 19 October).** Conference-wide
contribution count, highest first, with country/name/id ties and no points tie-break. Points and manual scoring
remain visible; editing/keyboard focus keeps the row order stable. Counting rules, including amendments and
automatic submitter credit, are in [PARTICIPATION_VIEWS.md](PARTICIPATION_VIEWS.md). No ranked export exists to
align. A separate bounded Debate list shows all committee countries, flags and conference-total net points,
including zero and negative values. Unit tests and production-build browser checks cover both views.

**W6b · Chair deducts a chosen number of points ◐ (code and migration reviewed for staging replay; no staging application recorded).** A custom amount, not fixed steps.
Stored as a traceable adjustment: amount, reason (required), chair, time, delegate; original participation
history is never edited or deleted, totals are original events plus adjustments. Existing committee permissions
(Chair of that committee only) enforced on the server and through the outbox/idempotency path. Needs a
migration and repository change: written up and reviewed independently before it is applied on staging.
Acceptance: unit tests for totals and bounds; a replay and double-submit test (receipt idempotency); a
cross-committee Chair is refused; history shows original event and adjustment separately.

**W6c · Approval history in the Approval Panel ◐ (code and migration reviewed for staging replay; no staging application recorded).** Accessible list or table of decisions: decision,
comment, reviewer, time, newest first, per resolution. Landmark and heading structure, status by word, keyboard
focusable, announced updates. Acceptance: axe-style checks (roles, names, contrast) pass in a browser; works
without colour; shows decisions made offline once synced, labelled with the server time.

## W7 · Declutter every tab and panel ◐ (depends W3, W4)

Inventory so far (screen → decision):

| Screen | Decision | Reason |
| --- | --- | --- |
| Chair nav (9 items) | 6 everyday + "More" (Group photos, System health) | Match the day's jobs; rare screens stay reachable |
| Chair "Documents" | Renamed Resolutions; preview, timeline, version panel, mock version removed | Facts inline; one next action |
| Executive nav (15 items) | Grouped: Set up / Run the day / Records | Same pages, findable |
| Executive "Resources & Drive" | Removed | Retired feature; stale "Not connected" panels |
| Sidebar conference label, topbar DEMO/STAFF chip, topbar role name | Removed | Repeated the lockup, sync status and workspace label |
| Sidebar user block | Role and sign-in state only | Showed an arbitrary staff member's name and fixed initials |
| Topbar date | Removed | Hard-coded "Monday, 5 October" |
| Executive home demo callout | Demo only, with the reset button | Was shown in production |

Remaining: Approval/Print/Executive page bodies, Chair Debate screen, Executive Overview, Amendments, Group photos.

Audit every tab, panel and repeated control across Chair, Approval Panel, printing and Executive. Remove
retired features (timers on the server, projector, Drive, award rubric remnants), merge redundant views, keep
frequent actions prominent, move secondary detail to "More". Apply the brand consistently.

Acceptance: an inventory table in this document (screen → kept / merged / removed → reason); no screen has two
controls with the same effect; each workspace has ≤ 5 tabs; the Chair's roll call, queue, vote and participation
actions are reachable in two taps or fewer; before and after screenshots at two widths.

## W8 · Release pass ☐

Full test, typecheck, lint, build; browser smoke at phone and desktop widths for all four workspaces; update
README and BRAND.md; staging checks that need a Supabase project (signed-in flows, 110-device rehearsal) remain
the conference-week gate.

## Related items already approved (not part of this sequence)

Session restructure (blocked on contract sign-off), Leo notification inbox and short messages, popups above Leo,
ad-blocker-resistant notifications, configurable Debated Amendment and Main Submitter points, print copies =
delegates + 3 spares, break-shorter-than-lead rule, executive resolution overview, automatic conflict pause and
export, amendments-by-resolution fix. See `docs/SESSION_MODEL.md` and `docs/BACKLOG.md`.

## Review queue (protected changes)

`docs/REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md`: migrations 20261019100000, 100100, 100200. Not applied anywhere.
Independent of: session contract (`docs/SESSION_MODEL.md`, still draft) and the conference-week Pro/Small
performance checks, both unchanged.

## Owner follow-up and first priority pass · 19 October 2026

The current additions and implementation evidence are in [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md). These
supersede older wording where it conflicts. The owner explicitly authorised Codex to implement simple,
high-priority UI work; Claude remains the primary engineer and can review/clean up this branch.

- Compact local country combobox: implemented for Open/For/Against queues, POI selection and co-submitter yield.
  Enter selects only; adding/recognising remains a separate action. Current-session delivered speech/POI counts,
  Fewest/Most first, aliases and typo tolerance are included. No new dependency or network search.
- Permanent sync strip: implemented immediately below the sticky navigation for every workspace, including
  System health. The reviewed status helper and in-dialog failed-save alerts are retained.
- Award discussion: removed from Chair/Executive UI, navigation and capability labels. Old bookmarks redirect;
  participation history and historical award data remain intact. Worker cache version advanced to 0.2.5.

These items are verified as recorded in UI_PRIORITY_PASS.md; they do not close W8 or the staging and
conference-week validation gates. No schema, repository transport, migration or hosted environment changed.


## Orbit seal · owner-selected follow-up

`components/workspace-loading.tsx` implements the selected logo/outer-arc design for initial staff opening and
workspace redirects. Cached refreshes retain the workspace and use the sync strip. Existing failed-startup
recovery controls replace the loader when data is unavailable. See [LOADING_MOTION_PROPOSAL.md](LOADING_MOTION_PROPOSAL.md)
for the implementation and verification; other skeleton/loading primitives and wider transitions remain open.

## Watermelon patterns · 21 October 2026

Selected from [WATERMELON_UI_SELECTION.md](WATERMELON_UI_SELECTION.md) and re-implemented in plain React and CSS with the
existing tokens: no dependency was added and no upstream component was copied (each file names the idea and points at
[the MIT notice](WATERMELON_LICENSE.txt)). Design rules and constants are in [BRAND.md](BRAND.md) "Feedback and motion patterns".

| Pattern | Where it is used | Why there and not elsewhere |
| --- | --- | --- |
| **CopyButton** (`components/copy-button.tsx`, logic in `lib/ui/copy.ts`) | Access-code reveal dialog, Executive and Chair submission links, amendment links, Passed amendments "Copy wording" | Replaces four ad-hoc copies. "Copied" only after the clipboard write resolves; a refusal or missing Clipboard API shows "Select and copy" and selects the read-only field. One polite announcement; fixed width; reverts after 2 s. The submission-link copy used to reset silently on failure. |
| **Spinner / `PendingButton`** (`components/pending.tsx`, `lib/ui/pending.ts`) | Public resolution and amendment submit buttons; staff access "Open staff workspace" and "Retry access"; access-code Create/Rotate/Revoke/Refresh; "Load older passed amendments" | Only controls that wait on the network. `act()` (the durable local write behind every Chair action) is deliberately not decorated: it resolves in IndexedDB time, and the debate-critical paths gain no code, state or latency. The ring never says saved or synced. |
| **SkeletonRows** (`components/skeleton.tsx`) | Passed amendment history first page when no device cache exists; access-code status table | The only two screens that read from the server after the workspace snapshot is already loaded. Every other screen renders from the snapshot, so no skeleton is needed or shown. System health already says "checking" in words for its probe. |
| **Continuous tab indicator** (`components/shell.tsx`, `lib/ui/tab-indicator.ts`) | Workspace navigation in all four workspaces | One 3 px underline slides to the active tab. Routes, `aria-current`, menus and keyboard behaviour are unchanged; the per-tab underline remains the fallback. Other segmented selectors were not changed: none is a clear, trivial fit. |

Behaviour that matters:

- Skeletons appear only while there is nothing to show; cached or merged data is never replaced by placeholders during a
  refresh. A failed first read shows its error, not "No passed amendments yet" or "Not created" for every access code.
- Skeleton row heights are the typical final height (150 px for an amendment, 69 px for a table row). Amendment wording
  varies in length, so a replacement row can be shorter or longer; nothing above the placeholder moves.
- The pending ring is reserved (16 px slot, 8 px left padding, 4 px gap) so a button never changes width; labels no longer
  swap to "Submitting…" or "Loading…".
- The indicator does not animate on first mount. It remembers its position for 1.5 s because the route remounts the nav
  on every navigation, so it still slides. On narrow screens, where tabs wrap onto rows, it slides along a row and jumps
  between rows.

Client bundle, `next build --webpack`, demo build, summed `<script>` chunks of the prerendered route (raw / gzip), same base
commit before and after: `/chair` 1,193,458 / 352,295 B to 1,198,187 / 354,077 B (+4.7 kB raw, +1.8 kB gzip); `/about`
931,270 / 277,709 B to 932,362 / 278,176 B (+1.1 kB, +0.5 kB; shared chunk only); global CSS 73,019 / 15,049 B to
75,056 / 15,452 B (+2.0 kB, +0.4 kB). No dependency added. Next 16's route table no longer prints First Load JS, hence
the manual sum.

Verified: unit tests (`copy-button`, `pending`, `skeleton`, `tab-indicator`), typecheck, lint of changed files, production
demo build and Playwright runs against it (indicator timing, resize, 640 px at 2x, phone, reduced motion, keyboard,
clipboard success, refusal and missing API, widths). Not verified: real screen-reader output, the spinner and
skeletons against a live Supabase read or a throttled network, and authenticated staging.

Not adopted (per the selection brief): **Run Action Button** (fake staged progress, width changes), **Labeled Progress
Indicator** (timer-driven fake percentage), **Command Search** (palette, global shortcut, substring match; the compact
country combobox is the chosen control), **Inline Toast** (the persistent sync strip and in-dialog save errors stay) and
**Expand Details** (measured-height animation; older feedback keeps the existing disclosure). Also left out: any
animation or measuring dependency (`framer-motion`, `react-use-measure`, `cmdk`, Base UI, Hugeicons) and every page
template or dashboard. Per-screen skeletons for the initial workspace read, and spinners on `act()`, were not added.

## Owner follow-up: button and spacing overhaul

Claude owns the global button, alignment, panel-width and spacing cleanup requested on 19 October 2026.
See [CLAUDE_VISUAL_CLEANUP.md](CLAUDE_VISUAL_CLEANUP.md). The functional follow-up is recorded in
[UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md); it does not complete the global visual overhaul.

## Clear-majority voting · retained owner request

Pending implementation by Claude: [CLEAR_MAJORITY_VOTING.md](CLEAR_MAJORITY_VOTING.md). Add compact
Clear majority For / Against actions that record the Chair's observed result without filling country ballots.
Keep counted voting, Divide the House, existing veto rules, history, permissions and offline durability.
The complete current coverage checklist is in [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md).

## Home screen proposal and local reference · 20 October 2026

[HOME_SCREEN_PROPOSAL.md](HOME_SCREEN_PROPOSAL.md) supplies the compact Assembly workspace chooser, desktop
and phone screenshots, state rules and verification evidence for Claude. Single-workspace auto-entry and
role filtering are preserved. This home reference is implemented locally; Claude's global button, panel-width
and spacing overhaul remains open.

## 19 October UI/QoL brief, Chair feedback and independent audit · reconciled 20 October 2026

Source documents, kept verbatim: [UI/QoL brief](briefs/UI_QOL_BRIEF_2026-10-19.md), [Chair feedback additions](briefs/CHAIR_FEEDBACK_ADDITIONS.md), [Watermelon selection](WATERMELON_UI_SELECTION.md) ([MIT licence](WATERMELON_LICENSE.txt)), [PHESMUN parity at 0a43c73](briefs/PORT_PARITY_2026-10-19.md) (historical; superseded by the audit's §D) and the [independent audit](briefs/INDEPENDENT_AUDIT_2026-10-20.md). The brief supersedes Participation sorted by points and uploaded resolution files. Status as of 20 October:

| Item | Status |
| --- | --- |
| §1 Docs-only submissions | Docs-only enforced (PR #27). Access verification states/recheck need a reviewed migration; advisory only (audit "Google Docs security assessment"). |
| §2 Executive resolution status | On main (`admin/resolution-status`). |
| §3 Contribution ranking and Debate points list | On main ([PARTICIPATION_VIEWS.md](PARTICIPATION_VIEWS.md)). |
| §4 Clear majority | Draft PR #37 (migration not applied). |
| §5 Award discussion removed | On main; old bookmarks redirect. |
| §6 Felix | In progress on `claude/felix` with the supplied Launcher art and six frames. |
| §7 Chairs in school photos | Draft PR #36 (migration not applied). |
| §8 Configurable Main Submitter/Debated amendment | Draft PR #35 (migration not applied). |
| §9 About and parity | About: draft PR #38. Parity gaps from audit §D (print copies F3, optional email/committee import, staff edit/remove) are separate items. |
| §10 Buttons, panels, home | Button system PR #31 and alignment PR #32 merged; home proposal on main; remaining sweep continues. |
| Chair feedback: country search, sync strip, passed amendments | On main; audit F2 (offline durability of passed history) open. |
| Restrained motion and Watermelon patterns | Pending; CSS/Web Animations first, no new dependency without measurement. |
| Audit F1 cutover isolation | Pending: cutover packet. |
| Audit F4 bounded bodies | Draft PR #39. |
| Audit F5 touch targets | PR #32 gives 40 × 44 px on touch; raise to 44 × 44 with 8 px gaps as the audit proposes. |
