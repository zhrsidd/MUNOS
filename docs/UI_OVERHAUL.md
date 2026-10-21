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

## Resolution identity (handoff 21 October, section 2): display and search · 21 October 2026

Rule, fallbacks and styling: [BRAND.md](BRAND.md#resolution-identity--21-october-2026). Done on `claude/resolution-identity`
(display and search only; no schema, RLS, command-contract or submission-form change; the title-field removal follows below): Chair Resolutions, Debate, Voting,
Amendments and Participation, Approval queue/detail/history, Executive resolution status and its search (code, country,
status, outcome), Logistics print queue and Completed, delegate submission cards, Felix reminders and answers, the public
amendment page, the device amendment-history cache and the submission confirmation.

Shipped on `claude/identity-projection` (migration `20261021130000_identity_projection.sql`; additive, no table, policy, grant
or RLS change, no backfill). Hosted Approval, Logistics and the public amendment page now resolve `GA1/01 — France`:
- **Approval and Logistics** cannot read delegates (`delegates` RLS is admin/chair/observer; their snapshots carry none).
  `private.submitter_country(conf, committee, delegate)` (SECURITY DEFINER, EXECUTE revoked from public/anon/authenticated)
  returns only `delegates.country`, and null unless the delegate is in that conference and committee.
  `private.document_submitter_countries(conf)` (definer, granted to `authenticated` like `private.decision_history`) maps
  document id to country and repeats the documents SELECT policy: chair/admin/observer see every document in scope, approval
  Submitted/Review/Approved, logistics Approved/Printed/In Debate/Closed, all under `private.has_access`. Patched in place,
  with exact anchors that must match once: `conference_snapshot` adds `documents[].submitterCountry` (looked up only for
  document rows RLS already returns, so no document becomes visible), and `private.decision_history` adds
  `submitterCountry` to every history entry under its existing access rule (approval/chair/admin/observer), so history for a
  resolution that has left the reader's view still resolves. `executive_snapshot` gets the same documents field so its
  projection stays identical to the core snapshot's.
- **Public amendment page**: `amendment_link_info` now returns `resolution.submitterId` (the delegate list beside it was
  already public; nothing else was added), so the form shows the country instead of `Main submitter unavailable`.
- **Client**: `Resolution.submitterCountry` and `DocumentDecision.submitterCountry` (optional, may be null); the formatter
  prefers the reader's own delegate and uses the published country only when the delegate cannot be found. Approval history
  entries, the device amendment-history cache (`country`) and Felix read it through the same formatter. Older servers and
  cache entries without the field still read `Main submitter unavailable`. Applying the migration is gated on independent
  review and the owner; until it is applied hosted screens keep the honest fallback.
- Review note for Codex: patched functions are `public.conference_snapshot(uuid)`, `public.executive_snapshot(uuid)`,
  `private.decision_history(uuid)` and `public.amendment_link_info(text)`; new functions are `private.submitter_country` and
  `private.document_submitter_countries`. Tests: `tests/identity-projection-db.test.ts` (every role by state, no delegate
  leak, helper grants, committee/conference scoping, history after a document leaves view, public RPC shape) and the
  "hosted" cases in `tests/resolution-identity-ui.test.ts`.

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
  `"Untitled resolution"` (19 characters). It takes no input; being a constant, a retried title-free submission is
  byte-identical, so the server's idempotency payload comparison still replays. It is never displayed (the identity change made
  every screen ignore stored titles). The only other value that can reach `documents.title` is a legacy title, below.
- **Public endpoint, and legacy-title retries (Codex P2 on the first push).** `submit_resolution` stores `trim(title)` in the
  idempotency receipt (`private.resolution_submissions.request_payload`) and compares it on every retry of a submission id. A
  delegate whose OLD cached form was accepted before the deploy has their real title in that receipt, so an unconditional
  compatibility title made their automatic retry of the same id a 409 `idempotency_conflict`. Fix, with no migration and no RPC
  change: `legacySubmissionTitle()` (`lib/resolution-title.ts`) reads a posted `title` and reduces it exactly as the pre-PR
  `cleanTitle` did (every whitespace run to one space, then trim), then bounds it as before (3 to 200 characters after reduction).
  `lib/submissions/service.ts` passes a valid one as the optional `SubmitArgs.title`; `lib/submissions/supabase-backend.ts`
  sends `legacySubmissionTitle(a.title) ?? compatResolutionTitle()` (re-validated there, idempotent) to the unchanged RPC. So a
  retry from an old form is byte-identical to its original receipt payload (verified against the real RPC), while the new form
  never has a title field, never posts one and gets the compatibility title. **An invalid legacy title is not an error**: not
  text (a file part), empty, under 3 or over 200 characters after reduction all fall back to the compatibility title. The old code
  refused such a request with 400 `invalid_title`, so no receipt can exist for it and nothing can conflict; failing it now would
  only block a delegate on a field they cannot see. The body stays bounded (64 KB, counted before parsing) and the title is
  capped at 200 characters before anything leaves the route. A valid legacy title on a NEW submission is stored in
  `documents.title` exactly as before this PR (it is never displayed or searched). `invalid_title` stays removed from
  `SubmissionError`, `submissionMessages` and the known-error list (the RPC can only raise it outside 3 to 200 characters, which
  neither value is; an unexpected raise would surface as the generic "could not confirm" error). The bounded-body, rate-limit,
  Docs-only and token checks are untouched. A reload (new submission id) of the same Google Doc still resolves through the RPC's
  duplicate detection, with or without a title.
- **Chair create.** `newDocument.title` is REQUIRED again in the `Command` type (`lib/commands.ts`), so the typed contract
  guarantees it (a `@ts-expect-error` in `tests/title-free-resolutions.test.ts` fails typecheck if it ever turns optional). The
  Chair form always sends the compatibility value, so the existing SQL (`command->>'title'` into `documents.title text not null`,
  and into the draft version text) keeps working unchanged.
- **Boundary normalisation (Codex finding: a title-less command must never reach PostgreSQL).** `normalizeCommand()` in
  `lib/commands.ts` is a pure step run first in `DurableRepository.execute` (`lib/sync/repository.ts`), the one place every
  command passes before the optimistic fingerprint, the local apply and the persisted outbox entry. For a `newDocument` whose
  title is missing, null, blank or not a string (JS callers, tests, older code paths) it returns a copy with
  `compatResolutionTitle()`; every other command, and any `newDocument` that already has a real title (including one queued
  before titles were removed), is returned as the same object, so legacy queued commands persist and replay byte-identically.
  Because it runs before persistence, the IndexedDB entry, the `apply_conference_mutation` payload and every idempotent retry
  carry identical JSON. The local reducer's own fallback stays as a last resort.
- **The server stays strict.** Nothing in SQL changed: a `newDocument` with no or null title is still rejected by PostgreSQL
  (not-null), asserted by a direct RPC in `tests/title-free-resolutions-db.test.ts`. The fix is that the client can no longer send
  one. Before the fix, a title-less create queued without a title, was refused with 23502 and was retained as a conflict.
- **Fingerprints and the outbox.** `newDocument` has no optimistic fingerprint (it returns null with or without a title), so
  commands queued before this change (with a real title) replay exactly as before and are stored with that title.
- Draft version text for a Chair-created draft is `Untitled resolution` followed (locally) by the draft notice, as before with the
  title; no screen renders version text.

What did not change: no migration, no RLS or grant change, no change to `submit_resolution`, `apply_mutation`, the snapshot
projections or the `Resolution`/`Delegate` types. Existing stored titles, Google Doc names, version text and audit records
are untouched, and nothing rewrites a code. `lib/supabase/*` and migrations are not edited here; `lib/sync/repository.ts` gains only the one `normalizeCommand` call.

Why no migration: both server checks already accept the compatibility value (`title text not null`, 3 to 200 characters), so
loosening them would only widen a protected contract for no benefit. A later migration could make `documents.title` nullable
and drop the RPC parameter; that is optional cleanup, not a prerequisite.

Risks to check:
- **Rollout condition (legacy retries).** An old cached form keeps working across the deploy only because it still posts the
  title it posted before: the retry then carries the stored title and replays. This holds for every submission accepted before
  the deploy, with no database check needed. What cannot be recovered is a retry that omits the title for a submission that was
  accepted WITH one (nothing in the app does that: the new form has a new id per page load and never reuses an old id); the RPC
  would answer 409 and the delegate reloads, which finds the original through duplicate detection. Conversely, once this is
  live, an old form that posts a valid title creates a row whose `documents.title` is that title (as before the PR). If every
  old form can be assumed gone (e.g. the sheet was only ever opened after the deploy), the legacy path is simply never taken.
- `scripts/verify-submission-http.mts` used a changed title as its "changed payload" case; it now changes the Google Doc and adds a
  legacy-title post (it is a staging tool, not run here; it does not exercise the pre-deploy receipt case, the PGlite test does).
- Search and aggregations: nothing outside `lib/seed.ts` (demo text), `lib/amendments/history-cache.ts` (history only) and the
  approval-history projection reads `title`; none displays or matches it.

Tests: `tests/title-free-resolutions.test.ts` (public route in demo and Supabase-backend paths, legacy title reduction/bounds/fallback, static
forms, local create, type contract, `normalizeCommand`, persisted outbox payload and replay, fingerprint, identity on every screen) and
`tests/title-free-resolutions-db.test.ts` (route to the real `submit_resolution` on the migrated schema, including the Codex P2
case: a submission created with the pre-PR RPC payload shape, retried through the new route with the same id and inputs and the
legacy title, replays with no 409 and no second document; the same retry without the title is the 409 the fix removes; a title-free
retry, an invalid-legacy-title retry and a new-id reload; Chair create, strict
server, a title-less create through the real `DurableRepository` and `SupabaseTransport` into `apply_conference_mutation` in
PGlite, history through Draft, Printed, In Debate and Closed).

## Sequential numbering for Chair-created drafts · 21 October 2026

Status: implemented on `claude/sequential-chair-numbering` (protected area: migration and server numbering); needs independent
review. **Migration `20261021140000_sequential_chair_numbering.sql` is NOT applied to any hosted project** (no staging, no
production); it is replayed only by tests until reviewed and pushed to staging by the owner's process.

Problem: in hosted mode a Chair-created draft (`newDocument` in `private.apply_mutation`) was numbered
`<committee> / <first 8 characters of the document id>` (for example `TST / ca7640bb`), while a public submission
(`public.submit_resolution`) was numbered `TST / 01`, `TST / 02`. The demo reducer (`lib/commands.ts`) already counted
(`count + 1`), so the demo and hosted disagreed. Now all three paths use one rule.

### Review notes for Codex

Mechanism:
- New `private.next_resolution_code(conf, committee)` (SECURITY DEFINER, `search_path=''`, EXECUTE revoked from
  public/anon/authenticated; not an RPC). Result `<committee code> / NN`: NN is the highest existing sequential number in that
  committee plus one, left-padded to at least two digits and never truncated (`99` is followed by `100`; the width is `greatest(2, length(n::text))`
  because PostgreSQL `lpad('100',2,'0')` returns `'10'`, unlike JavaScript `padStart`; Codex P2 on the first push). "Sequential" = the code ends in ` / ` plus 2 to 6
  digits; the suffix is read, not the prefix, so a renamed committee keeps counting. It then skips forward while any document
  in the conference already has that code (the loop `submit_resolution` always had), so the existing
  `unique(conference_id, code)` on `public.documents` is never the thing that stops a create.
- Both `private.apply_mutation` (`newDocument`) and `public.submit_resolution` now call it. Both were patched with
  `create or replace` from `pg_get_functiondef` and an exact `pg_temp.patch_once` anchor that must match exactly once
  (the migration raises otherwise). Execute grants are unchanged (checked: `apply_mutation` authenticated, `submit_resolution`
  service_role, helper owner only). `newDocument` still stores `command->>'title'`; nothing about the title changed.
- Behaviour change for public submissions, deliberate: the old rule was `count(*) + 1`, which counts legacy hex drafts and
  leaves gaps (`TST / 02` as the first sequential number). The helper uses the highest sequential number instead. For a
  committee with no legacy drafts and no deletions the result is identical.

Locking and concurrency (no new lock order):
- Both callers already take, in this order, a per-request advisory lock (mutation id / submission id) and then
  `select ... from public.committees where id = <committee> for update`. The helper takes the same committee row lock itself
  (re-entrant), so numbering is serialised per committee whichever caller gets there first, including Chair create against
  public submission. Different committees do not block each other. No advisory lock was added.
- The number is computed and the row inserted in the same transaction under that lock, so there is no read-then-insert race.

Idempotency: `apply_mutation` checks the mutation receipt before any numbering and returns on a replay, so a retried mutation id
inserts no document and consumes no number; `submit_resolution` replays by submission id the same way. The offline outbox
contract (receipts, fingerprints, PT409/40001) is untouched.

Legacy handling: no backfill, no renumbering. `TST / ca7640bb` stays as stored, stays unique, and is displayed
`TST/ca7640bb` by `lib/resolution-identity.ts` (unchanged). Hex suffixes are always exactly 8 characters so they never match the
2-to-6-digit pattern, even an all-digit one (`12345678`); the counter ignores them and continues after the highest sequential
number. Gaps are not refilled.

Client: `lib/resolution-number.ts` (`nextResolutionCode`) mirrors the helper and `lib/commands.ts` `newDocument` uses it, so the
demo reducer and hosted agree (including skipping legacy hex codes). `lib/submissions/demo-backend.ts` (`D01` prefix, an
in-memory demo of the public form that never touches documents) is intentionally left alone.

Rollout: review, replay on staging, then apply with the normal `supabase db push`; no downtime, no data change. Rollback: a
later forward migration that restores the previous bodies of the two functions (from `20261006073442_staff_chair_contacts.sql`
and `20261006023111_chair_procedure.sql`) and drops the helper; documents already numbered `TST / 03` stay valid either way.
Never edit the applied migration.

Tests:
- `tests/sequential-chair-numbering-db.test.ts` (PGlite, always runs): 01/02/03, replay consumes nothing, title still stored,
  Chair and public share a sequence, two committees independent, legacy hex ignored (including an all-digit one), upgrade from
  the previous migration keeps every existing row byte-identical and continues after it, helper not callable by API roles.
- `tests/sequential-chair-numbering-concurrency.test.ts` (real PostgreSQL 17, needs `TEST_POSTGRES_URL`, runs in CI): 8
  Chair creates blocked on one committee lock yield exactly 01..8; 6 Chair creates plus 6 submissions unsynchronised yield
  exactly 01..12; Chair holding the lock against a submission and the reverse; the same mutation id concurrently adds one
  document; another committee is not blocked; legacy hex ignored. Contention is observed (`pg_stat_activity` Lock waits), not
  assumed from sleeps.
- `tests/resolution-number.test.ts`: the client helper and the demo reducer.

What Codex should check:
1. The two anchors match exactly once on the real chain and the patched bodies differ from the previous ones only at those
   two spots (diff `pg_get_functiondef` before and after on staging).
2. That the helper's own `for update` on the committee row cannot invert lock order with any other path: it is only called
   after the caller took the same lock, and no path takes a committee lock then a mutation/submission advisory lock.
3. The `count(*)+1` to `max+1` change for public submissions is acceptable (gaps from legacy drafts stop appearing).
4. Upper bound, decided explicitly: the counter reads and generates the same 2 to 6 digit widths (`01`..`999999`, so `99999` -> `100000`
   works). Past `999999` the helper raises `No free resolution number in committee X` (errcode 22023) before formatting, which also
   bounds the skip loop (a dense `01`..`99` committee continues at `100` immediately; it can no longer spin until a statement
   timeout). The client helper throws the same message. Tests: `tests/sequential-chair-numbering-boundary-db.test.ts` (PGlite:
   only `99` -> `100` for Chair and public, dense 01..99, `100` -> `101`, hex ignored, `99999` -> `100000`, error at `999999`) and the
   PostgreSQL 17 concurrency test (Chair and public racing across 99 -> 100 and 99997 -> 100003, error at `999999`).
5. Any code outside `<prefix> / <digits>` (for example custom edited codes) is ignored by the counter, never rewritten.
