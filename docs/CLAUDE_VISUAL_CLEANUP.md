# Claude: global button and spacing overhaul

Owner instruction, 19 October 2026:

> “buttons are also really ugly and spacing is uneven and messed up everywhere.”

The full feature checklist is in [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md); this document specifies the visual work.

Claude owns this cleanup across the application. Treat it as a usability priority, not optional polish.
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
