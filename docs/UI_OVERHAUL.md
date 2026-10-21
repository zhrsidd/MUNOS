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
resolution is one row showing, without opening anything: its identity (`GA1/01 — France`, never a title), status chip, working-document link
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

## Resolution identity (handoff 21 October, section 2): display and search · 21 October 2026

Rule, fallbacks and styling: [BRAND.md](BRAND.md#resolution-identity--21-october-2026). Done on `claude/resolution-identity`
(display and search only; no schema, RLS, command-contract or submission-form change; the title-field removal follows below): Chair Resolutions, Debate, Voting,
Amendments and Participation, Approval queue/detail/history, Executive resolution status and its search (code, country,
status, outcome), Logistics print queue and Completed, delegate submission cards, Felix reminders and answers, the public
amendment page, the device amendment-history cache and the submission confirmation.

Open, for independent review (none are made here):
- **Approval and Logistics cannot read delegates** (`delegates` RLS is admin/chair/observer; their snapshots carry none), so
  in hosted mode their screens and Approval history read `GA1/01 — Main submitter unavailable`. Recommended: add the Main
  Submitter's country (a `submitterCountry` string only) to the `documents` projection in `conference_snapshot` for the
  approval and logistics roles, and to `private.decision_history`. `resolutionIdentity` already prefers the reader's delegate
  and falls back to a published `submitterCountry`, so the UI needs no further change.
- The public amendment page shows `GA1/01 — Main submitter unavailable` until `amendment_link_info` publishes the resolution's
  `submitterId` (its `delegates` list is already public; `AmendmentLinkInfo.resolution.submitterId` is read when present).
- Removing the title field is the contract task below (done on `claude/title-free-resolutions`).

## Title-free resolutions (handoff 21 October, section 2): contract change · 21 October 2026

Status: implemented on `claude/title-free-resolutions` (stacked on `claude/resolution-identity`); needs independent review.
Nobody is asked for, or shown, a resolution title any more.

Removed: the Chair "New resolution" form (`NewResolutionForm` in `components/documents.tsx`, now only the Main Submitter and
the `Resolution number assigned on submission — <country>` preview), the public form (`components/operations/submission-form.tsx`:
label, input, validation and the `title` field it posted), the room-sheet instruction (`app/submit/[token]/sheet/page.tsx`)
and the `invalid_title` error path. There is no Chair edit-title flow in the app (the `document` command never carried a title).
Felix, FELIX.md, TROUBLESHOOTING.md and START_HERE.md never told anyone to enter a title; one Felix step now says the Main
Submitter is chosen and the number is assigned automatically. The paper-fallback intake log and the rehearsal checklists no
longer list a title.

### Review notes for Codex

What changed (this is a contract change, hence the review):
- **One compatibility rule**, `lib/resolution-title.ts`: `compatResolutionTitle()` returns the fixed, non-descriptive
  `"Untitled resolution"` (19 characters). It takes no input, so nothing a person typed can reach `documents.title`; being a
  constant, a retried submission is byte-identical, so the server's idempotency payload comparison still replays. It is never
  displayed (the identity change made every screen ignore stored titles).
- **Public endpoint.** `lib/submissions/service.ts` no longer reads `form.get("title")`, no longer validates it, and
  `SubmitArgs` has no `title`: a legacy client that still posts one gets the same success, and the value is neither forwarded
  nor stored. `lib/submissions/supabase-backend.ts` passes `title: compatResolutionTitle()` to the unchanged
  `submit_resolution` RPC. `invalid_title` is removed from `SubmissionError`, `submissionMessages` and the known-error list
  (the RPC can only raise it for a title outside 3 to 200 characters, which the constant never is; an unexpected raise would
  surface as the generic "could not confirm" error). The bounded-body (64 KB), rate-limit, Docs-only and token checks are untouched.
- **Chair create.** `newDocument.title` is optional in `lib/commands.ts`. The Chair form always sends the compatibility
  value, so the existing SQL (`command->>'title'` into `documents.title text not null`, and into the draft version text) keeps
  working unchanged; the local reducer falls back to the same value if a caller omits it. A command with NO title would be
  rejected by PostgreSQL (not-null); that is deliberate and tested, which is why the client, not the server, supplies the value.
- **Fingerprints and the outbox.** `newDocument` has no optimistic fingerprint (it returns null with or without a title), so
  commands queued before this change (with a real title) replay exactly as before and are stored with that title.
- Draft version text for a Chair-created draft is `Untitled resolution` followed (locally) by the draft notice, as before with the
  title; no screen renders version text.

What did not change: no migration, no RLS or grant change, no change to `submit_resolution`, `apply_mutation`, the snapshot
projections or the `Resolution`/`Delegate` types. Existing stored titles, Google Doc names, version text and audit records
are untouched, and nothing rewrites a code. `lib/supabase/*`, `lib/sync/*` and migrations are not edited here.

Why no migration: both server checks already accept the compatibility value (`title text not null`, 3 to 200 characters), so
loosening them would only widen a protected contract for no benefit. A later migration could make `documents.title` nullable
and drop the RPC parameter; that is optional cleanup, not a prerequisite.

Risks to check:
- A delegate who loaded the OLD form, submitted once (real title stored in the receipt payload) and retries the SAME submission id
  after this deploys now sends the compatibility title, so `submit_resolution` returns `idempotency_conflict` (409). The
  message tells them to check with their Chair; a fresh submission id (reload the page) works. Window: only retries across the deploy.
- `scripts/verify-submission-http.mts` used a changed title as its "changed payload" case; it now changes the Google Doc and adds a
  legacy-title post (it is a staging tool, not run here).
- Search and aggregations: nothing outside `lib/seed.ts` (demo text), `lib/amendments/history-cache.ts` (history only) and the
  approval-history projection reads `title`; none displays or matches it.

Tests: `tests/title-free-resolutions.test.ts` (public route in demo and Supabase-backend paths, legacy title ignored, static
forms, local create, fingerprint, outbox replay, identity on every screen) and `tests/title-free-resolutions-db.test.ts`
(route to the real `submit_resolution` on the migrated schema, Chair create, history through Draft, Printed, In Debate and Closed).
