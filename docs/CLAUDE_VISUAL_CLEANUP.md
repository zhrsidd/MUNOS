# Claude: global button and spacing overhaul

Owner instruction, 19 October 2026:

> “buttons are also really ugly and spacing is uneven and messed up everywhere.”

The full feature checklist is in [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md); this document specifies the visual work.

Claude owns this cleanup across the application. Treat it as a usability priority, not optional polish.
The [Assembly home proposal](HOME_SCREEN_PROPOSAL.md) now includes a working local reference and tracked
desktop/phone screenshots. Review and build on it when cleaning up the other workspaces.
The separate functional package (Debate points leaderboard, contribution-ranked Participation and Executive
resolution status) should remain reviewable independently.

- Rework shared button hierarchy, consistent heights and padding, icon/text alignment, primary/secondary/text
  and destructive states, disabled explanations, focus rings and touch targets. Avoid equal visual weight for
  every action. Make button groups wrap cleanly without stretching or squashing labels.
- Audit panel, table, form and dialog spacing; align labels, inputs, row actions and panel headings. Use the
  brand spacing scale and consistent content widths, with no accidental empty expanses on the home chooser.
- Cover Chair, Executive, Approval Panel, Logistics, entry screen, dialogs and public submission forms.
  Fix conflicting legacy CSS at its source instead of accumulating overrides. Include long text, empty states,
  error states and stacked mobile actions in the audit.
- Preserve the Assembly identity, Orbit loading, compact keyboard-searchable country picker, fixed sync strip,
  roll call, side-by-side For/Against speeches and visible approval feedback. Keep workflow permissions,
  durability and scoring behavior intact.
- Verify phone and desktop layouts, actual 200% browser zoom, keyboard focus, reduced motion and no horizontal
  overflow. Supply before/after screenshots and run the required checks. Any motion should remain restrained.

No connected Claude chat was available to message from this session. This is the explicit repository handoff
for Claude's next pass; it does not claim that Claude has received a direct message.

## Pass 1 — shared button system, 20 October 2026

Done, at the source in `app/globals.css` (no overrides added):

- One button height (40 px) and padding (0 16 px) for default, primary and danger buttons; primary actions grow to 44 px on touch screens. Line height and icon gap come from the spacing scale.
- Hierarchy by role: default is the outlined secondary, `.primary` the one main action per region, and the new `.danger` the destructive one. `.danger.primary` is a filled confirm for a destructive step that has no safer alternative in the same dialog. Applied to row *Delete* (committees, sessions) and *Revoke* (access codes), the access-code *Revoke code* confirm, and *Delete unused committee/session*. Those dialogs keep *Archive instead* as the single filled action.
- Disabled buttons are legible (sunken fill, ink-3 text) instead of 42% opacity.
- Table row actions went from 29 px to 34 px (40 px on touch), at 13 px text.
- Action groups use `--space-2` and wrap; a long label wraps inside its button instead of being squashed or overflowing.
- The Approval decision buttons no longer shrink to 12 px.

Measured on a production build of the local demo at 390 px, 1280 px and 640 px at 2x (about 200% zoom), with reduced motion, across 16 routes in all four workspaces plus the public form. Standard buttons are a uniform 40 px (they were 38/39/42 mixed). The committees table had 12 row actions under 32 px; now none. No route overflows horizontally, before or after. Before/after: [design/button-system](design/button-system/).

At the end of Pass 1 (continued in Pass 2 below):

- **Dense Chair controls**: the Participation quick-entry scorer (+1/+2/+3) is 24–29 px, and the roll-call segments 31 px on desktop. These are the Chair's most-used controls on phones, so enlarging them is a layout change for that page, not a button-style change.
- Panel, table, form and dialog spacing audit; text-button and link-button roles; long-text, error and empty states; a dialog survey; keyboard-focus walk-through.

## Pass 2 — targeted rehearsal controls and shared spacing, 31 October 2026

The owner asked Codex to continue the existing cleanup as part of final rehearsal preparation. This is a local demo UI pass; no hosted configuration or conference data changed.

- Participation quick-entry controls now measure 40 × 40 px on desktop, replacing 27 × 29 px controls. Phones retain 44 × 44 px targets. Category labels use the 12 px minimum, groups stay together with 8 px gaps, and long labels wrap. The phone grid becomes one column below 384 px so a full three-value group still fits.
- Roll-call segments now have 40 px minimum height on desktop and 44 px on touch/narrow screens. The checkmark has a reserved slot, so changing a selection does not move the labels. Segments and their row wrap when space is limited; attendance names and `aria-pressed` stay intact.
- Panel headers wrap before actions squeeze the title; panel headings and direct form content use 24 px desktop/16 px phone side insets. Forms use 16 px gaps and shrinking grid columns. Dialogs use the existing container radius and spacing tokens, and their close buttons are 40 × 40 px. Search controls now share the 40 px control height.
- Existing Assembly colours, workflows, the outbox and scoring behavior remain in place. No motion or dependency was added.

Browser evidence: [before/after screenshots and measurements](design/rehearsal-ui/README.md). Chromium local demo checks covered Chair, Approval, Printing, Executive, the workspace chooser and the public submission form, including 1280, 768, 390 and 320 px widths. The two target Chair pages plus Executive committee/scoring pages passed 16 route/width combinations; a further 39 route/width checks covered the shared-layout survey. None overflowed horizontally or contained an overflowing panel header. Long category, country, delegate and school labels were also checked in the target Chair rows.

At 1280/390/320 px, keyboard activation recorded a score and changed attendance, the selected attendance label stayed in position, dialog focus was visible at 3 px, Escape restored the opener, and Tab did not reach background page controls. Reduced motion retained the existing 0.01 ms transition override. Actual Chromium browser zoom was set to 200% in an isolated temporary profile: CDP reported zoom `2`, outer width `1280`, inner width `640`, device-pixel ratio `2` and visual viewport scale `1`. Participation, roll call and the committee dialog fit without horizontal overflow.

Focused Participation and roll-call client tests passed (12 tests). Lint completed with three existing unused-variable warnings in `committee-live-state-db.test.ts`. The coordinated final candidate verification records the full typecheck, test and build results; this pass does not replace that release gate.

Remaining broad visual follow-up: exhaustive text/link-button hierarchy, every dialog and all empty/error states across all roles. The targeted controls and shared-layout samples above are verified; this is not a claim that every screen/state has been audited.

