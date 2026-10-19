# DCMUN loading motion: selected Orbit seal

19 October 2026. Four working motion studies use the actual, unaltered `public/dcmun-logo.jpg`.
The owner selected Orbit seal. It is now wired into the initial staff loading states on `codex/priority-chair-ui`.
The other directions below are retained as design-study references.

## Owner-selected direction: Orbit seal

Keep the entire seal upright on a small white backing. A fine blue arc rotates around its outside, one turn
per 3.2 seconds, with constant speed. Put DCMUN / Conference OS and “Opening your workspace…” beneath it.
The mark stays readable throughout, and the small amount of rotation gives the circular seal a natural loading
identity. No logo redrawing, segmented layers, glow, particles or full-screen illustration is needed.

Use the existing Manrope/DM Sans families and brand tokens. Initial proposal: 112 px seal in a 160 px white
backing, 176 px motion area; adapt the surrounding placement to the viewport rather than enlarging the mark.
The white backing is intentional because the supplied logo is an opaque JPEG, including white corners. Keep
those corners inside the backing even during rotation. Use a smaller mark on short phone viewports if needed.

## Alternatives to compare

| Direction | Motion | Reason to choose it | Tradeoff |
| --- | --- | --- | --- |
| Orbit seal | Upright mark; outer arc turns in 3.2 s | Best balance of the requested spin and readable identity | Adds a small decorative ring outside the mark |
| Slow seal spin | Whole logo turns in 4.8 s | Most literal version of the owner's spinning-logo idea | The curved school/conference lettering rotates upside down |
| Breathing seal | Scale 0.985 to 1.02; opacity 0.88 to 1 over 2.8 s | Quietest movement, suitable for the official Assembly identity | Less recognisable as a busy indicator without the loading label |
| Assembly dots | Upright logo; three small dots fade in sequence over 1.6 s | Familiar and visually calm; keeps the logo entirely still | Less distinctive than the orbit |

All are CSS studies built specifically for DCMUN. The original asset stays intact. The preview supports a
speed adjustment and play/pause through the conversation's design controls. Reduced motion stops the animation;
the orbit disappears, the logo remains upright, and the loading label remains readable. Hidden/offscreen
previews pause. The dots are decorative, not a percentage, stage counter or proof of saved work.

## Online inspiration checked

- [CSS Loaders: spinner collection](https://css-loaders.com/spinner/): visually inspected the live arc, ring and
  orbital families. Borrow the restrained circular movement, rather than its many decorative variants.
- [Loading.io: Loading.css](https://loading.io/animation/): reviewed its spin, orbit, breath and fade families,
  speed and pause controls. Its browser page was Cloudflare-blocked in this session; the public documentation
  was readable. This is a documented inspiration, not a claim that its live browser demo was tested here.
- [Loading.io: CSS loaders](https://loading.io/css/): useful small CSS-only ring/dot references. Do not install
  the whole library just for this effect.
- [Atlassian: applying motion](https://atlassian.design/foundations/motion/applying-motion): adapt its restraint,
  prompt feedback and transform/opacity guidance. Loading must never delay focus, errors or ready content.

No third-party component source or animation package was copied into the app. The proposal does not claim a
measured production bundle cost or lag-free operation on Chair hardware.

## Integration rules

1. Use the brand loader for the initial access/data opening state. Integrate the same primitive into the current
   staff-access loading gate and initial conference-data wait, so two loading screens cannot compete.
2. Render only for a real pending operation. An optional ~150 ms reveal threshold can avoid flashes on near-instant
   reads; it must not impose a minimum wait. As soon as content/access is ready, show it. Do not finish a full
   animation cycle first, animate a fabricated percentage, or hold a splash screen for branding.
3. Existing saved content stays usable during refresh/offline/reconnect. Those states use the permanent sync strip;
   they must not replace the workspace with a full-screen loader or restart the entrance animation.
4. Preserve “Opening your workspace…” while checking access. If that check fails, immediately show the existing
   actionable access/error state. A spinner must not conceal a failure indefinitely. Keep queued local work intact.
5. Decorative logo/arc/dots are hidden from assistive technology. Expose one concise `role="status"` message;
   announce actual state changes, never every rotation. Do not move keyboard focus into a decorative splash.
6. Honour reduced motion and pause hidden/offscreen continuous animation. Animate only transform/opacity; no
   width/height/layout animation, blur or per-letter animation. Plain CSS is sufficient; no new Motion dependency
   is proposed. Any optional exit fade should be roughly 120–160 ms and must not block interaction with ready UI.
7. Verify immediate success, slow first read, cached refresh, offline start, failed access/read and retry, plus
   keyboard, screen reader, reduced motion, short phone screens and real Chair-device performance. Do not create
   an animation-only success or “synced” state that bypasses the reviewed repository status helper.

## Prototype verification

Four directions were rendered at 760, 390 and 320 px with the real embedded logo. Checked no horizontal overflow,
image decoding, actual orbit movement, static reduced-motion behavior and no browser errors. Light/dark preview
screens were inspected; dark is a preview accommodation, not an app-wide dark-theme proposal.

These checks concern the original design preview. App implementation and its verification are recorded below;
they do not imply screen-reader, authenticated staging or representative Chair-device verification.


## App implementation

- One shared component now serves the access-loading gate, the first conference-data opening, sole-workspace
  entry and wrong-role navigation redirects. Existing permission checks and redirect destinations are unchanged.
- Only the arc rotates; the actual mark stays upright. The image uses the original `/dcmun-logo.jpg` URL rather
  than an optimisation endpoint, so the existing offline-shell image cache can serve it.
- A workspace with data stays rendered for saved/syncing/waiting/conflict/error repository states. Missing data
  with an error/waiting state shows the existing Retry access/recovery controls instead of an endless spinner.
  This is a UI recovery path; authentication, transport, persisted data and queued mutations are unchanged.
- No minimum display timer, artificial progress, exit delay, new animation dependency or public-form loader.
- Hidden pages and offscreen emblems pause. Reduced motion keeps the mark/text and removes the arc.
- Worker cache version 0.2.6 prepares the changed shell assets; interception/bypass rules are unchanged.

## App verification

- Typecheck and lint pass with no warnings; production build passes. Full suite: 407 tests, 403 passed,
  4 existing PostgreSQL 17 concurrency skips, 0 failures. Focused loading/access/health/offline-shell checks:
  22 passed, 0 skipped.
- Production-build Chrome at 1280x900, 390x844, 320x640 and 640x320: one loading screen/status, original logo
  decodes at its prepared URL, no horizontal overflow, and the outer arc actually rotates. The 320 px run uses
  reduced motion and confirms the arc is absent. Desktop/phone/short-landscape screenshots were inspected.
- Delayed real IndexedDB opening keeps the initial loading screen visible. Releasing storage displays the
  actual local-demo workspace in 25-40 ms in this sample, without an animation-cycle wait. Unit checks also cover
  missing initial data and retain cached content for every repository refresh/error/conflict state.
- Browser offline/reconnect preserves the ready workspace without a splash. A prepared service worker reloads
  the workspace offline, and `/dcmun-logo.jpg` is present in cache 0.2.6. Existing API/Auth request bypass tests pass.
- Page-visibility event simulation and moving the emblem offscreen pause the CSS animation; visibility/position
  restoration resumes it. These checks exercise the real component; the visibility event is simulated, rather
  than a claim about every platform's background-tab scheduling.
- Injected IndexedDB failure exits to the existing “Connection needed” screen and offers Retry access. This
  test verifies the error UI, not a successful recovery from a persistent storage failure.
- No new runtime package, database migration, server permission or hosted-environment change.

Not verified: real screen-reader speech, authenticated cloud startup/recovery, representative Chair hardware,
production deployment or the conference-week Pro/Small capacity rehearsal. Local timings are observations,
not a device-performance guarantee. The original alternative-design preview remains available for reference.
