# Claude: Felix speed and resolution identity

Owner additions, 21 October 2026. Add these to the UI todo list alongside `docs/UI_PRIORITY_PASS.md` and `docs/CLAUDE_VISUAL_CLEANUP.md`. These are implementation requirements; this document does not claim app integration or runtime verification. Apply to the current integration branch and inspect existing Felix work before porting anything again.

## 1. Faster, unobtrusive Felix typing

Keep the approved Launcher head at **48 × 48 CSS px** and the supplied six expression frames. The owner wants Felix's typing to be faster than Leo without becoming irritating. Cover both reply text and the small typing expression; speeding up the face into a flicker is not the goal.

Proposed starting values for Claude to tune against Leo's actual timing:

- Reveal a prepared local reply at about **80 characters/second**, with **900 ms maximum total reveal time**. Long replies can appear immediately or in a few word-sized batches so the cap always holds. Show the first content immediately; never add a fake thinking delay or hold links/actions behind the animation. If Leo already reveals faster, shorten or omit the reveal rather than slowing Felix down to this default.
- Offer Show all immediately, and let the user disable typing animation. Reduced motion shows complete replies immediately. Announce a complete reply once through the existing accessible message mechanism; never announce individual letters.
- Keep facial typing gentle: proposed **1.0–1.2 second cycle** (original supplied preview: 1.4 seconds), with no more than a few beak changes per cycle and one brief blink. Stop after **600 ms of typing inactivity**, on reply completion, or when motion is disabled/hidden/offscreen. Do not restart the sequence on every keypress, animate unrelated page inputs, loop after an answer, add sound or move the launcher around.
- Keep petting a separate short response with a cooldown, immediate click/keyboard action, and no focus theft. Preserve the motion-off control, static fallback on image failure and timer cleanup. Do not tie expressions to saved/synced state or notification delivery.

The included animation preview/controller is the **original 19 October reference** with its original timing, not an updated implementation of this request. Claude should adapt its lifecycle and assets to the existing app and verify the revised timing. Original full-size PNGs are art sources; produce appropriately sized derivatives for production rather than loading six 1254 px sources on every page.

Acceptance: compare with Leo's actual timings; short replies feel prompt and full text is available within the cap; long replies/actions are immediately usable; no repeated screen-reader chatter; stop/reduced-motion/hidden-tab/unmount cases cancel work; typing, input focus and recording contributions remain responsive. Measure on a representative Chair device. Keep all earlier Felix inbox, short popup, DCMUN content, navigation and in-app notification requirements.

## 2. Remove resolution names from the workflow

Use **`GA1/01 — France`** as the standard visible identity: existing committee/resolution number, then the Main Submitter's **country**. The owner's `GA!/01` example is treated as `GA1/01`. Use real stored codes; never renumber a resolution or use a delegate's personal name in place of the country.

- Replace prominent resolution title/name text in Chair Documents/Debate, selection menus, Approval queue/detail/history, Executive status, Logistics/printing, notifications, amendment context and submission confirmations. Keep status, latest Approval feedback and the working Doc link easy to scan.
- Remove the resolution-name field from new-submission forms and Chair creation/edit flows. Reconcile client and server validation together: a hidden required field must not block submission. A legacy internal title field may remain as a compatibility detail if required, derived through a shared rule; do not invent a user-visible title. Any schema/shared-domain/command-contract change still needs independent review.
- Use one shared formatter/lookup so all screens agree. Scope lookups to the existing conference/committee data and permissions; no per-row fetch or new polling. Search by code and Main Submitter country. Preserve existing codes, UUID relationships, version/round numbers, scoring, outbox/idempotency and approval/amendment history.
- Preserve historical title data and original document contents; this request does not authorize deleting stored titles, changing Google Doc names or rewriting audit records. Historical events retain their actual content, but their surrounding resolution label uses the new identity where the available projection permits it.
- If a historical submitter is unavailable, show the code with **Main submitter unavailable**, never guess a country or fall back to the old title as the new primary identity. A pre-submission preview can use **Resolution number assigned on submission** until a real code exists. History that lacks the submitter must get a reviewed projection change or an honest fallback rather than losing access.

Acceptance: two resolutions with the same Main Submitter remain distinct by code; long country names wrap; missing/archived submitters do not crash or leak data; offline/reload and cross-committee role boundaries hold; title-free submissions succeed through the real endpoint; feedback/history remains visible after Draft, Printed, In Debate and Closed. Verify all four roles, public submission, print/export labels, keyboard, phone widths and 200% zoom. Run relevant regressions, typecheck, lint, tests and build when implemented.

## Watermelon selection and asset pack

The resupplied `WATERMELON_UI_SELECTION.md` is the original 19 October research with its pinned source links and compatibility notes. Keep Skeleton, Spinner, compact Combobox 1, the Continuous Tabs indicator and Copy Confirm as selected patterns; Gridline/Agndex/Tallie are composition references inside Assembly. Adapt to DCMUN tokens, existing controls, Orbit seal and the fixed truthful sync strip. Preserve the MIT notice with copied/adapted Watermelon source. The included source excerpts are references, not a standalone build or automatic dependency installation.

The original research and parity documents describe their stated older commits. They do not override current owner decisions, claim current integration status, or revive the removed SC/HSC proposal. Keep global button/spacing cleanup and all other active handoff items in scope.
