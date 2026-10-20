# Chair feedback and interaction additions

Owner follow-up, 19 October 2026. Add these requirements to `docs/UI_OVERHAUL.md` and Claude's active todo list. Preserve the selected Assembly design, Launcher Felix at 48 px, the reviewed save-state fixes and the earlier UI/QoL requirements.

## Compact searchable country selector

Replace the long country dropdowns for speeches and POIs with one reusable searchable combobox. Apply it consistently to For and Against speeches, POI selection and the relevant queue entry controls. A Chair should be able to type a few letters, a full country name or a small typo and see the relevant eligible delegations immediately.

The closed control takes approximately the space of the existing dropdown. Put the search input in that control or in a compact anchored popover; do not add a permanent large search panel. Open results overlay content instead of pushing the debate panels down. Show roughly five or six options at once, with a bounded scroll area and touch-friendly rows. Keep the For and Against speech controls side by side at widths where that already works.

Match countries locally: exact name/alias first, then word prefix, then substring and modest typo-tolerant fuzzy matches. Use recognised names and existing country aliases, not invented delegation identities. Twenty to a few hundred options do not justify a search service, per-keystroke backend calls or a large dependency.

Keyboard contract: typing filters; Arrow Down/Up moves the highlight; **Enter chooses the highlighted result, defaulting to the first/top match**; Escape closes without changing the selection; Tab follows normal focus order. Choosing a country must not accidentally submit the surrounding form, add a speaker, award points or record a POI. Handle composition input, no matches, stale/unavailable selections and reopening predictably. Use accessible combobox/listbox semantics, a visible highlight and written country names alongside flags.

Counts should help Chairs distribute opportunities without switching tabs. Show small speech/POI counts in the option rows, using real non-voided participation for the clearly labelled scope. Proposed default with no query: fewest relevant opportunities first. Include a small “Fewest first / Most first” control inside the popover so the reported most-to-least comparison is also available. This sorting choice does not override search relevance, the contribution-ranked Participation list or the separate points leaderboard. Keep a stable country/id tie-break and preserve the current highlight while the menu is in use. Existing eligibility, attendance and queue rules still apply; do not show an ineligible delegate as selectable merely because they match the query.

Acceptance: United Kingdom/UK-style aliases, prefixes and a representative typo resolve; Enter after typing selects the top result with no accidental mutation; arrows then Enter choose the explicit highlight; Escape and no-results states work; the same selector works for speeches and POIs; focus and typing are stable when counts change. Browser checks at 320/390/768/1280 px, 200% zoom, keyboard and touch; menu overlay adds no document height. Measure filtering interaction with the full DCMUN roster on a representative chair laptop; target under 50 ms with no new long tasks from the selector.

## Stable sync strip under navigation

The reported banner appears and disappears, shifting the entire page. Replace that behaviour with one compact, persistent sync strip immediately below the navigation, within the sticky header stack. Reserve the same height for every status at each breakpoint, including the initial read, local save, sending, confirmed, offline, conflict and failed-read states. Reserve enough room on phones so a longer status cannot grow the strip unexpectedly. Keep the content start position stable while statuses change.

Use the reviewed status helper and honest wording: locally durable changes are saved on this device; queued work is waiting to send; sent changes may still await confirmation; a failed read shows saved/stale data and offers details. Only claim synced after the required confirmation. Keep meaningful unresolved errors discoverable. Consolidate redundant masthead/banner indicators rather than adding another blinking status surface. Failed-save errors inside native dialogs must remain inside those dialogs.

The strip should have brief text, a small status indicator/count and an “Open details” action. Expanded diagnostics belong in a popover, drawer or the existing System health page, not a block inserted above the live debate controls. Keep polite, meaningful announcements without announcing every repeated refresh. The sticky stack must not cover focused controls or anchor destinations. Do not fix layout movement with an animated height transition; the height should stay stable.

Acceptance: repeatedly exercise idle → local save → sending → confirmation, failed reads with an empty outbox, retry, offline and conflict. The first debate panel's vertical position must not change when the sync state changes, at desktop and phone widths. Measure zero layout shift caused by status transitions; no focus or scroll jump, no duplicate success/error toast covering actions, no false green confirmation.

## Restrained motion across the UI

Add simple transitions where they explain an interaction: popovers, dropdown opening, dialogs, tab/panel content appearance, notification messages and small button feedback. Keep normal transitions short, around 120–180 ms, and interruptible. Use opacity and transform; avoid layout animation on the live debate view, whole-page slides, animated table reordering or a wait before a control becomes usable. Do not animate every incoming participation/sync update.

CSS or the Web Animations API is sufficient for simple cases. If Claude chooses the Motion library, use it selectively and measure the added client bundle and runtime effect. A new animation dependency is justified only by a useful result; do not add one just to obtain fades. Reuse existing animation support if present. Honour reduced motion and the Felix motion setting as applicable; stop background/offscreen animation and clean up timers/listeners. The playful Felix animation remains a contained exception, not the motion style for every panel.

Acceptance: compare before/after bundle size and interaction traces; no new long tasks attributable to transitions, no delay to selecting a speaker/recording a contribution, and no visible dropped-frame regression on a representative Chair device. Reduced motion produces immediate state changes or minimal non-spatial feedback. If a transition harms these checks, simplify or remove it while keeping the feature usable. Do not claim lag-free behaviour from a desktop-only visual check.

## Keep passed amendments discoverable

Chairs reported losing access to an amendment after it passed, preventing them from copying it into the resolution. Add amendment history linked to each resolution, including after the amendment or resolution closes, a new resolution enters debate, or the session changes. Keep the exact wording, Add/Delete/Replace type, clause, submitter, outcome and timestamps readable, with “Copy amendment wording” and the working Google Doc link.

The current `AmendmentInbox` filters by the single resolution currently In Debate, so it is not a general history browser even though it displays Passed wording for that one resolution. Fix the lookup/navigation and any server projection/access limitation; don't merely change a status chip. Make “Passed amendments” easy to reach from the resolution row/detail as well as Amendments. Keep history scoped/bounded with a way to retrieve older entries rather than adding an unbounded conference-wide array. Preserve permissions, offline data and the amendment outcome record. Do not pretend the Google Doc was edited automatically; applying the text remains a Chair action.

Acceptance: pass an amendment, close that resolution, start another, switch sessions, reload and reconnect; the old passed wording remains accessible and copyable from the original resolution. Test historical rather than only currently active data, including any current 200-row limit and access boundaries.

## Preserve what Chairs liked

Keep the roll call workflow, the side-by-side For/Against speech arrangement and the useful resolution documents workflow. Improve the selectors within those controls rather than replacing the whole debate interaction. The mock resolution preview is already removed; check for any remaining mock-debate illustration or non-functional simulation in Documents and remove it. Keep the real Start debate/In Debate workflow and recorded statuses intact.

The request for both Chairs to be present belongs in the staffing/operations follow-up, not a new software control. Record it as an organiser note without creating a product dependency.

## Close-out

Show before/after compact selector, stable sync strip and amendment-history flows to a Chair. Update the todo list with implementation, test and browser evidence. This feedback does not relax the staging migration replay, independent review of protected changes or conference-week capacity gate.
