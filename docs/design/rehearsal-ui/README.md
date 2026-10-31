# Rehearsal UI evidence · 31 October 2026

Local demo in Chromium, using synthetic seed data. These are UI measurements, not hosted capacity evidence. The implementation follows the existing Assembly tokens in `docs/BRAND.md`.

| View | Before | After |
| --- | --- | --- |
| Desktop Participation | [1280 px](before-1280-chair-participation.png) | [1280 px](after-1280-chair-participation.png) |
| Desktop roll call | [1280 px](before-1280-chair-roll-call.png) | [1280 px](after-1280-chair-roll-call.png) |
| Phone Participation | [390 px](before-390-chair-participation.png) | [390 px](after-390-chair-participation.png) |
| Phone roll call | [390 px](before-390-chair-roll-call.png) | [390 px](after-390-chair-roll-call.png) |

Additional detail: [phone attendance selection and focus](after-390-roll-focus.png), [320 px dialog](after-320-dialog.png), [Participation at actual 200% browser zoom](after-zoom-200-chair-participation.png), [committee dialog at actual 200% browser zoom](after-zoom-200-admin-committees.png).

The phone roll-call overview captures the header and draft actions; the separate focused screenshot shows the attendance targets after scrolling. The actual-zoom screenshots are captured directly through CDP without a CSS clip, preserving the full 1280 px physical viewport.

[Measurements](measurements.json) contain the before/after control bounds, overflow checks, keyboard/focus results and browser zoom metrics. Browser zoom was applied through Chromium's `tabs.setZoom(2)` in an isolated temporary test profile. It is actual page zoom, not a narrowed viewport, device-scale override or pinch zoom: CDP reports page zoom `2`, inner width `640`, outer width `1280`, device-pixel ratio `2` and visual viewport scale `1`.

All tested routes used the local backend. Native phone hardware, hosted role access and live conference readiness are outside this evidence.
