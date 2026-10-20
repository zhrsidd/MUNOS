# UI alignment fixes: before and after

Evidence for four reported defects, captured on populated local-demo states. Before is `main` (`e0796a3`), after is this branch. Both are production builds driven by Playwright in phone (375×812, touch), tablet (768×1024, touch) and desktop (1280×900) contexts. The Brazil row's delegate name was changed to "Maximiliana Konstantinopoulou-Rutherford" (France) to test long names.

Screenshots are viewport captures. Element and full-page screenshots switch off Chromium's touch emulation, after which `(pointer: coarse)` stops matching; the touch measurements below were confirmed with the media query still matching.

## A. Main Submitter row (Executive → Scoring)

The fixed Main Submitter row was a bare `div` with no panel inset and no value or action column, so it ran edge to edge. It now uses the same `definition-row` layout as the other rows, with a read-only `+5` field and a "Not configurable" note in the action column.

| | Text left (px) | Right edge (px) |
| --- | --- | --- |
| Desktop: Speech row | 89 | 1191 |
| Desktop: Main Submitter, before → after | 65 → **89** | 1215 → **1191** |
| Tablet: Main Submitter, before → after | 25 → **49** | 743 → **719** |
| Phone: Main Submitter, before → after | 34 → 34 | 127 → **341** |

## B. POI custom allowance (Debate → Points of information)

The global `label` bottom margin lifted the number field 19 px above the adjacent "Set allowance" and "Extend POIs +1" buttons. The field is now level with them and its value is centred.

| Bottom edge: field vs buttons (px) | Before | After |
| --- | --- | --- |
| Desktop | 265 vs 284 | 266 vs 266 |
| Tablet | 279 vs 298 | 280 vs 280 |
| Phone (buttons wrap) | 330 vs 349, 399 | 331 vs 331, 381 |

## C. Voting panel header (Voting → Voting procedure)

The mode buttons, vote-type select and metrics sat 1 px from the panel edge. They are now inside the panel inset, and the select is centred on the buttons. Checked in Normal vote and Divide the House modes.

| | Before | After |
| --- | --- | --- |
| Metrics inset left/right, all widths (px) | 1 / 1 | 25 / 25 |
| Desktop control centres, buttons and select (px) | 252, 252, 256 | 261, 261, 261 |
| Tablet, Divide the House | 608, 608, 612 | 608, 608, 608 |

## D. Participation quick entry (Participation → Quick entry)

On touch screens the +1/+2/+3 buttons are now 40×44 px. On a phone the four groups no longer fit on one line, so they sit in a two-column grid (Speech | POI, Main Submitter | Amendment) instead of leaving Amendment alone on a second line. Desktop with a mouse is unchanged.

| | Smallest button (w×h px) | First row height (px) |
| --- | --- | --- |
| Phone, before → after | 28×29 → **40×44** | 176 → 264 |
| Tablet, before → after | 27×29 → **40×44** | 174 → 189 |
| Desktop (mouse), unchanged | 27×29 | 81 |

The taller phone row is what 44 px targets cost. No view has horizontal overflow, before or after.
