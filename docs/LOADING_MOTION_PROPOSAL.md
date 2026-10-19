# DCMUN loading motion: design proposal

19 October 2026. Four working motion studies use the actual, unaltered `public/dcmun-logo.jpg`.
These are design alternatives; no loading screen has been wired into the application yet.

## Recommended direction: Orbit seal

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

## Integration contract for Claude

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

These are isolated design-preview checks. App integration, real loading-state transitions, screen-reader
announcements and production/Chair-device performance have not been verified by this proposal.
