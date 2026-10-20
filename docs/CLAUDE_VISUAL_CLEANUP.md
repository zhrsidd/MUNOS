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

Still open (next passes):

- **Dense Chair controls**: the Participation quick-entry scorer (+1/+2/+3) is 24–29 px, and the roll-call segments 31 px on desktop. These are the Chair's most-used controls on phones, so enlarging them is a layout change for that page, not a button-style change.
- Panel, table, form and dialog spacing audit; text-button and link-button roles; long-text, error and empty states; a dialog survey; keyboard-focus walk-through.

