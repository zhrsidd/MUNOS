# DCMUN UI/QoL additions — owner brief, 19 October 2026

Claude: add these requirements to `docs/UI_OVERHAUL.md` and reconcile `docs/BACKLOG.md`, `docs/BRAND.md` and any older proposals before implementing. Continue from the current branch, preserving the Assembly direction and the reviewed fixes. These are additions to the existing programme. Do not restart completed work.

This brief supersedes the earlier instruction to sort Participation by points and the earlier permission for new uploaded resolution files. Existing reference documents are background evidence; follow the owner's current decisions below. Read `PORT_PARITY.md` for the independent source check through PHESMUN PR #13.

## 1. First priority: Google Docs submissions and real access

Delegates must submit a working Google Doc. Remove PDF and other file-upload alternatives from new resolution submissions, including the public endpoint/backend path; hiding a file picker is insufficient. Reject PDFs, PDF export/viewer links, arbitrary Drive files and non-document links. Keep already submitted historical files readable; removing a submission option must not delete conference records.

Make the sharing instructions explicit before submission: open Google Docs → Share → General access → Anyone with the link, then choose the role required by the actual Chair/Approval workflow. Reading access and editing access are different checks; do not request public editing just to solve a viewing problem. Explain domain restrictions where relevant.

The existing Google Doc parser checks URL shape only. It does not prove anonymous access or that the target is a native working Google Doc. Implement an access/type verification step and an explicit result: verified, access restricted, or unable to verify. A valid URL, HTTP 200 login page, signed-in browser check or delegate checkbox must never produce a verified badge. Show the last check time and a way to recheck. Check both the working document and any separate Approval copy at the handoff where they are needed; permissions can change after the first submission. Unverified/restricted material must not silently enter the ready-to-review queue. Retain the entered link and show recovery instructions if checking fails.

Choose a bounded verification mechanism and document its limits before coding it. Keep all external requests restricted to expected Google document destinations, including redirects. If a robust automated verification needs additional credentials or infrastructure, identify that dependency; provide an honest verification/manual-review state instead of pretending the check succeeded. This must not reintroduce Drive mirroring, a folder planner or an archive automation system.

Acceptance: accessible Doc passes; restricted or domain-only Doc fails access verification; PDF and direct upload are refused server-side; published-web/PDF-export/look-alike links are rejected; timeouts retain input and show unable to verify; changing permissions can be rechecked; the real Chair → Approval handoff opens the document without an access request. Use authenticated staging when available and state exactly what demo mode can prove.

## 2. Executive resolution status

Port the useful read-only overview from PHESMUN PR #8. Give the Executive one all-committee view with committee, resolution code/title, current status and actionable document/feedback links. Make pending review, changes requested, printing and debate progress easy to scan. Keep Approval decision history accessible through the reviewed projection rather than exposing the Executive audit log to other roles.

Use existing repository state or an efficient scoped read. Do not add a new per-row polling loop or replicate the entire conference read just for this screen. Test every lifecycle state, empty committees and role boundaries.

## 3. Participation ranks contributions; Debate shows points

Replace the previous W6a points ordering: **Participation defaults to contribution count, highest first**. Keep points visible and retain manual point allocation, deductions/restores and the original event history. Define the contribution metric explicitly, starting from the existing participation opportunity count. Count each genuine, non-voided contribution once; adjustments and automatic point-credit bookkeeping must not manufacture extra contributions. Document how debated amendments and submitter credit are treated before implementation. Equal contribution counts use a stable country/name/id tie-break, not a hidden points tie-break. Preserve keyboard focus and edit state when values change, and align exports with the displayed order.

On the main Debate page, replace “Make room for another voice” with a **very compact points leaderboard**: flag, country and total points only, highest points first. Include every delegation in the committee in a bounded scrollable area; do not silently show only the leaders. Label the session/conference scope and use the same scope for displayed totals. Keep flags beside written country names and handle ties, zero and negative totals. The Participation tab remains the place for manual scoring. This compact points view is a different view from Participation's contribution ranking.

## 4. Clear-majority voting shortcut

Add a clear-majority path so Chairs do not have to select every delegation to record an observed show-of-hands result. Keep individual/roll-call voting available.

This needs a voting contract, not a UI bypass: the current client and server both require a ballot per eligible delegate before closing. Record an explicitly aggregate/observed result, with the Chair, time, resolution/session and enough evidence for the configured rule. Do not fabricate named delegate ballots or mark unknown delegates as For. Specify whether exact For/Against/Abstain counts are required for each rule, and when an observed declaration is sufficient. Exact thresholds still apply; unresolved veto positions must not be treated as no veto. Divide the House remains a named roll-call procedure.

Acceptance: ordinary clear-majority vote can finish without per-delegate clicking; a tie or insufficient majority cannot be labelled Passed; configured thresholds, attendance, abstention and Security Council veto rules hold; undo/reopen is auditable; repeated/offline submission cannot duplicate or change the outcome. Agree the client/server contract and independently review any protected changes before release.

## 5. Remove Award discussion

Remove the Award discussion page, navigation entry and redundant live controls. Remove obsolete award-rubric destinations where they still lead to retired UI. Keep useful participation records and historical data; this request does not require destructive database cleanup. Clean up routes, navigation tests, offline shell references and assistant answers so no dead link remains. Choose an intentional redirect or retired-page response for old bookmarks.

## 6. Port Leo as Felix, including the proposed improvements

Use the PHESMUN PR #11 deterministic, rule-based assistant as the starting point and adapt it to DCMUN's current workflows and navigation. The name is **Felix**, the Doha College mascot. No new generative-AI service is implied by this port.

The supplied photographs are in `references/`, and the generated designs are now included in `felix-designs/`. Start with `felix-launcher.png` (owner-selected, at 48 px), compare the two alternatives in `preview.html`, and read the integration notes in `README.md`. Use the supplied clipart head assets rather than generating a replacement by default. The art direction is: warm brown feathered head, large friendly eyes and the distinctive yellow/turquoise/dark-blue beak. Keep the recognisable mascot proportions. Avoid a full-body cutout, photographic texture and tiny text from the shirt. It must read at launcher size and fit the DCMUN Assembly UI. Provide a suitable larger source and small launcher export; review the artwork at actual size before replacing Leo imagery. Treat the photos as visual references, not product instructions.

Carry forward every proposed assistant improvement: a notification inbox, short messages, popups positioned above Felix, and in-app notifications that remain usable when blockers suppress optional browser notification mechanisms. Important messages must remain discoverable after a popup closes. Use honest read/unread and delivery states supported by the implementation. Include held/offline-review notifications when that workflow exists; do not invent a backend dependency for a feature that remains local. Keep useful navigation and conference reminders, and review all knowledge text against DCMUN access codes, sharing, Approval, printing and session behaviour. Update tests, accessible names and user-facing text so Leo/PHESMUN labels do not remain accidentally.

Felix must not obscure form actions or small-screen content, steal focus or make notifications depend on animation. Include dismiss/keyboard support and reduced-motion behaviour. Shared notification storage or new server delivery is a separate protected contract if needed.

## 7. Include Chairs in school group photos

A scheduled school's photo reminder and participant list must include its Chairs as well as its delegates. Use an explicit school association for each Chair; do not infer school from email, name or committee. The current staff model has no school association, so account for the directory/import and data-model work needed.

A committee with a Chair from the scheduled school must still receive the reminder even if it has no delegate from that school. Deduplicate people, show Chairs and delegates clearly, handle Chairs assigned to multiple committees, and preserve schedule revision/cancellation/acknowledgement behaviour. Missing affiliation should be visible for correction. Extend Executive affected-committee counts and the group-photo screen consistently.

## 8. Configurable Main Submitter points

Remove the fixed +5 limitation across Executive controls, client validation, server scoring and default lookup. Use the same conference defaults/committee override model as the other configurable categories where applicable. Show the effective value and whether it is inherited.

Preserve once-per-resolution credit, durable outbox and idempotency. Store the awarded value on the event: later configuration changes must not rewrite historical scores. Test default/override behaviour, zero and valid bounds, unauthorized edits, replay and duplicate credit attempts. Retain the earlier requirement for configurable Debated Amendment points as well.

## 9. About page and PHESMUN parity

Port the PHESMUN About page and its real creator/contributor credits, with the DCMUN identity and current product capabilities. Preserve accurate attribution, including Zuhayr Siddique and John Paul Ribeiru. Check existing licence wording rather than inventing new terms. Make About easy to find without adding a primary work tab.

Use the accompanying PR-by-PR parity table to finish the feature port. For each merged feature through PHESMUN PR #13, record: present, missing, deliberately retired, or superseded by a verified equivalent, with a target implementation and test. A newer restructure counts only when behaviour is covered. Do not blindly replay PRs, restore retired Drive/timer/projector features, import PHESMUN-specific cleanup SQL, or include PR #14's recovery system. PR #5 was not merged and is not an implemented-feature requirement.

## 10. Button, panel and entry-screen cleanup

Review shared components and every workspace, rather than patching individual buttons. Standardise useful content widths, panel padding, button heights, action alignment and wrapping. Primary and secondary actions must remain legible, consistently placed and reachable on narrow screens and at 200% zoom. Keep long titles, comments and error text inside their containers. Do not solve overflow by making actions disappear or forcing every panel to equal height.

Redesign the sparse home/workspace chooser: compact DCMUN identity, clear workspace choices and a useful first viewport, with less empty hero space and promotional copy. Keep access-based choices and the existing single-workspace auto-entry. Show conference selection only if the real access model supports multiple conferences; do not add fake choices or an unnecessary new selection step.

## Delivery order and close-out

1. Reconcile the plan and complete the parity table; put Docs sharing/access first.
2. Land independent shared-component, home, Award discussion removal, About and Executive overview work in reviewable packages.
3. Implement the two ranking views; port/review Felix and its artwork/inbox improvements.
4. Serialise the protected voting, school-affiliation, scoring and outstanding feature-port contracts/migrations. Continue unrelated UI work while independent review is pending.
5. Run appropriate regression checks, typecheck, lint, full tests and build; verify real browser flows at 320/390/768/1280 px, 200% zoom, keyboard-only, reduced motion and offline/reconnect. State demo versus authenticated verification honestly. Update the todo list with evidence, not just “done”.

Keep the already reviewed approval history, point-adjustment history, truthful masthead status and in-dialog failed-save recovery. The production demo release does not remove the isolated staging replay or conference-week Pro/Small rehearsal gates. Do not publish this package or modify hosted environments just to update the list.

## Included Felix artwork

Three transparent PNG head designs, an offline size/context comparison, exact prompts and integration notes are included in `felix-designs/`. The owner selected the simplified Launcher at 48 px. Keep notification semantics in UI text and state; do not encode save/error meaning in mascot expressions. The assets are included for implementation and have not been published.

## Owner follow-up: expressive Felix animation

Use the selected **Launcher** head at **48 px**. Six matching transparent expression frames are included in `felix-designs/frames/`: idle, half blink, full blink, closed beak, happy squint and contented eyes/beak closed. Add the gentle typing cycle and hover/petting response described in `felix-designs/ANIMATION.md`. Inspect the interactive `animation-preview.html` and reuse/adapt `felix-motion.js`. Preserve the immediate open/close action, keyboard/touch access, motion-off and reduced-motion support. The idle expression may blink occasionally; it should not constantly bob. These expressions are decorative, never a substitute for truthful save/sync/error states. Optimise production image delivery from the included high-resolution originals.

## Latest Chair feedback and interaction additions

Read `CHAIR_FEEDBACK_ADDITIONS.md` alongside this brief. Add the compact country-search combobox with Enter-to-select, per-country opportunity context and sorting, a stable minimal sync strip below navigation, restrained performant transitions, and persistent passed-amendment history. Preserve roll call and side-by-side For/Against speeches. The mock preview remains retired; the real debate workflow stays.

## Loading states and Watermelon UI selection

Read `WATERMELON_UI_SELECTION.md` before adding components. Use its selected Skeleton, Spinner, compact Combobox 1, simplified Continuous Tabs and Copy Confirm patterns, plus the targeted Gridline/Agndex/Tallie composition references. Keep Assembly and 48 px Launcher Felix. Loading and progress must reflect actual work; retain cached data, input and stable geometry. Reject timed demo success/progress for syncing and saving. Review dependencies, accessibility and reduced motion before adapting source; do not install a whole template or replace the app shell.
