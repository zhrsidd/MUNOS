# Felix: the Conference OS helper

Felix is the Doha College mascot and a small, deterministic helper mounted in every staff workspace (Chair,
Approval Panel, Admins/printing, Executive). It is a port of the earlier conference's rule-based assistant, with
DCMUN content and the owner-requested improvements. Implemented in the `claude/felix` branch (20 October 2026);
not yet released.

## What it is, and is not

- **Rule-based.** Questions are normalised and matched to workflow concepts (`lib/felix/match.ts`), then to a
  reviewed knowledge base (`lib/felix/knowledge.ts`). The same question in the same state always gets the same
  answer. There is no generative-AI service, no network call, no backend, migration or new dependency.
- **Read-only.** Felix reads only what the workspace already loaded (`lib/felix/context.ts`) plus the same
  repository health store the sync strip uses. It never changes conference data, retries or discards changes.
- **Immediate.** Replies are computed and shown at once: there is no typewriter effect, "thinking" delay or
  simulated streaming. See "Typing speed" below for the measured comparison with Leo.
- **Links are real destinations.** `safeLink` accepts only `/role` + a slug from `destinationSlugs(role)`
  (`lib/navigation.ts`); anything else is dropped, including stored links. Tests check every answer, reminder and
  example against the navigation and the app's route list.

## Interface

- **Launcher**: the owner-selected Launcher face at 48 × 48 CSS px inside a 56 × 56 button, bottom-right, 16 px
  from the edges (or the safe-area inset if larger). Accessible name "Open Felix" / "Close Felix" with
  `aria-expanded`; images have empty alt text. An unread count badge is backed by a described-by sentence.
- **Panel** (non-modal dialog) above the launcher: 380 × 560 px on desktop; on phones it spans the width with an
  8 px margin and fits the viewport height. Two views: **Ask** (conversation, suggestions, composer) and
  **Inbox**. Footer: "Still stuck? Message the Executive." and the **Animate Felix** switch.
- **Focus**: opening by click, tap or Enter moves focus into the composer (or the Inbox heading when opened from a
  notice); nothing else moves focus. Escape (in the panel or on the launcher) closes it and returns focus to the
  launcher. Following a link closes the panel.
- **Short notices** appear above the launcher as real DOM text inside a polite `role="status"` region: at most
  12 words, "Open Inbox" and a "Dismiss notice" button (Escape also dismisses). Each notice pops up once; dismissing
  it leaves it unread in the Inbox. Hidden while the panel is open.
- **Space**: page content gets extra bottom padding so the end of every page scrolls clear of the launcher (and of
  a notice while one shows); the existing save toast moves to the left of the launcher.

## Inbox and reminders

`lib/felix/reminders.ts` builds reminders from loaded data, per role (Chairs only for their committee):

- every role: conflicts and "this device cannot save" (urgent, link to System health); changes waiting to sync
  (information; not in the local demo);
- Chair: group photo warning/now/cancelled (from `committeePhotoReminders`, the same rules as the banner), no
  sessions / no current session, roll call not started, changes requested, delegate submissions and "Can't access"
  submissions, submitted amendments, passed amendments to apply to the Google Doc by hand, drafts, printed
  resolutions; information on debate, accepted amendments, resolutions with Approval or awaiting print;
- Approval Panel: new submissions and resolutions in review; Admins: the print queue with its stored copy total;
  Executive: information only (with Approval, awaiting print, amendments awaiting Chairs).

Only urgent and action reminders enter the **Inbox** (`lib/felix/inbox.ts`); information is given in answers to
"What should I do next?". Rules, all pure functions with tests:

- one entry per reminder key; refreshed wording keeps its read state;
- a newer reminder of the same kind replaces an older **unread** one (e.g. "2 submissions" → "3 submissions");
  read ones stay as history;
- a situation that passes stays listed as "No longer current" (newest 20 kept); if it comes back it is a new,
  unread occurrence;
- **read** means the entry was shown in the open Inbox. "New" labels mark entries first shown during the current
  visit. Nothing claims server delivery; browser notification APIs are never used, so blocked notification
  permissions make no difference.

## Storage (this browser only)

| Key | Contents |
| --- | --- |
| `felix-chat-v1:<scope>` | last 60 messages |
| `felix-inbox-v1:<scope>` | inbox entries with read/popped state |
| `felix-motion-v1` | `"off"` when the person turned animation off (device-wide) |

`<scope>` is `chair:<committeeId>` for Chairs and the role name otherwise. Every reader tolerates missing, corrupt
or hostile values and drops links outside the role. If storage is unavailable Felix works for the page only.

## Artwork and motion

Assets are the owner-selected frames (idle = the Launcher image, half-blink, blink, closed-beak, happy-squint,
content), downscaled from the 1254 px originals with Pillow LANCZOS to transparent WebP at 96 px (1x–2x) and
144 px (3x) in `public/felix/` (about 88 KB for all twelve), same full canvas for every frame. They are plain
`<img srcset>` so they work offline; `public/sw.js` precaches all twelve (cache `conference-os-0.2.8`).

`lib/felix/motion.ts` adapts the supplied `felix-motion.js` controller: one 260 ms blink every 5.2–8.4 s, no
bobbing; typing in the Felix composer plays the gentle typing cycle below; hover/pointer movement or
keyboard focus (`:focus-visible`) on the launcher plays the 1.12 s happy sequence with at most 5° tilt and 1.05
scale, 1.25 s cooldown; touch only opens/closes. Reduced motion, the Animate Felix switch, a hidden tab, an
offscreen launcher or frames that failed to decode hold the static idle face and cancel timers. Frames are fetched
only after the launcher mounts and only while motion is allowed. Expressions never represent saving, syncing,
errors or delivery: the sync strip does that.

## Typing speed (21 October 2026)

Owner requirement: Felix's typing is faster than Leo's without being irritating, for reply text and for the small
typing expression. Leo's timings below were read from the earlier conference's `components/leo-helper.tsx` and
`app/globals.css` (commit 73e337e).

| | Leo (baseline) | Felix |
| --- | --- | --- |
| "Thinking" delay before a reply | 500 ms fixed `setTimeout`, with a bouncing-dots bubble (0.7 s loop) | none (0 ms) |
| Reply reveal | typewriter, one character every 19 ms (about 53 characters/s), no cap; a 420-character answer took about 8 s plus the 500 ms delay; the link showed from the first character, but a new question was refused until the reveal finished, and the whole message list was one polite live region that was rewritten on every character | whole reply at once (0 ms); the link is part of the same paint |
| Beak while Leo "talks" | two-frame swap every 240 ms (0.48 s loop, about 4 swaps/s) for the whole reveal | none while replying |
| Expression while the person types | none | gentle typing cycle (below) |
| Typing stops | when the reveal finished | 600 ms after the last keystroke |

**Reply text: decision.** The requested target was about 80 characters/s with a 900 ms cap and never slower than
Leo. Felix already shows every reply in full on the frame it is sent (measured 3–5 ms from click to the complete
text and link, a single DOM insertion, in Chromium), which is inside the cap and faster than Leo, so **no typewriter
is added**. Consequences, all deliberate:

- *Show all* is unnecessary: the whole answer is already shown, so there is nothing to skip.
- The *Animate Felix* switch (and system reduced motion) still cover "let the user disable animation" for the face;
  there is no text animation to disable. Reduced motion shows replies immediately, as it always does.
- The question and the whole reply, link included, enter the conversation log in one state update. The log is the
  one polite live region (`role="log"`), so a finished reply is announced once and never per letter.
- Nothing delays, staggers or gates a link or action. `tests/felix-motion.test.ts` fails if a timer, animation frame
  or typewriter is introduced into `components/felix-helper.tsx`.

If a longer or streamed reply is ever added, the owner's targets apply: about 80 characters/s, 900 ms total cap,
first content immediately, links and actions usable at once, Show all offered, and one announcement of the complete
reply.

**Typing expression.** Constants live in one place, `MOTION` in `lib/felix/motion.ts`:

| Constant | Value | Was | Meaning |
| --- | --- | --- | --- |
| `typingCycleMs` | 1100 ms | 1400 ms | one cycle; requested range 1.0–1.2 s |
| `typingQuietMs` | 600 ms | 950 ms | settle this long after the last keystroke |

One cycle: still idle face at 0 ms, the beak closes at 260 ms and reopens at 440 ms (a single beak change), one
230 ms blink from 640 ms (the same half-blink, blink, half-blink shape as the idle blink), then rests open until 1100 ms.
The earlier cycle closed the beak twice in 1.4 s; this one closes it once in 1.1 s, so the face moves less often even
though the cycle is shorter. Rules:

- The first keystroke in the Felix composer starts the cycle. Later keystrokes only move the inactivity deadline; the
  cycle is never restarted, so the rhythm is steady however fast someone types. Only the Felix composer calls it:
  no other page input animates.
- It stops 600 ms after the last keystroke (even part-way through a cycle), immediately on Send, on a suggestion
  click, on blur, when the panel closes or switches to the Inbox, and when Animate Felix is off, reduced motion is on,
  the tab is hidden, the launcher is offscreen or frames failed to decode. It does not loop after an answer and the
  launcher never moves.
- Petting is separate: the same 1.12 s response with a 1.25 s cooldown, on hover or keyboard focus; clicking and
  keys are never delayed and focus is never moved.
- Every timer is cancelled on stop and on unmount; no sound.

Verification: fake-clock tests in `tests/felix-motion.test.ts` assert the exact frame timeline, cycle length, one beak
change and one blink per cycle, the 600 ms stop, no restart under continuous keystrokes, all stop conditions and
timer cleanup. Chromium check against the demo build (43 keystrokes at about 105 ms): beak closes every 1100 ms
(1101, 1100, 1100, 1100), one blink per cycle (1100 ms apart), the face returned to idle 600–601 ms after the last
key (five runs), no frame change at all with reduced motion or Animate Felix off, panel and launcher faces in step.
Not yet measured on a representative Chair device.

## Knowledge review (20 October 2026)

Reviewed against the MUNOS code, not the source app:

- **Removed:** Award discussion (now: awards are Chair judgement; Participation for reference), Resources & Drive,
  automatic Debated Amendment credit (no such code in MUNOS), PDF/file submission for
  new resolutions, the projector/server timer (the speaker timer is local to the device), schools/import column
  details that could not be confirmed, every reference to the previous mascot, conference and attribution.
- **Added or rewritten:** Google Docs-only submissions with "Anyone with the link → Editor" or a direct share to a
  Chair, "Can't access" / "Access fixed", Approval-folder copy; changes requested and "Resubmit after editing →";
  Approval history; contributions vs points and deductions/restores; sync strip wording ("Saved on this device" is
  not "synced"); passed amendments history; group photo acknowledgements; access-code redemption, rotation and
  revocation (cloud-only, not queued); offline reload scope matching `public/sw.js` per role.
- **Not claimed:** a clear-majority shortcut (pending), two-thirds voting configuration UI, automated Doc access
  checks (specification only), anything about server delivery of notices.

## Limits

- Felix knows only what the page has loaded; it cannot see other devices, contact details or code values.
- Read state and chat are per browser; another device or a cleared browser starts fresh.
- Unclear questions get a list of topics rather than a guess; out-of-scope roles are told which workspace does the
  job without a link.

Tests: `tests/felix.test.ts`, `tests/felix-inbox.test.ts`, `tests/felix-motion.test.ts`.
