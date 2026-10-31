# Alternative committee loading screen

Executive → Workflow & features → Alternative loading screen provides Preview and a switch for each active committee. Defaults are off. The “Diplomatic Royale” subtitle and bottom-right tagline have been removed. The collage is a decorative image; branding, committee, loading status and tip are live HTML. The artwork fills the screen edge to edge behind the smaller header and footer, with a gentle gradient for text contrast. The owner chose the natural borderless layout over letterboxing; narrow screens crop the artwork to fill their viewport. Dots cycle one/two/three every 500 ms, stop moving in hidden tabs and show three static dots with reduced motion. No progress bar, animation dependency, external font or artificial wait is added.

## Integration and limits

The existing Executive-only `feature` command saves `committeeLoadingScreen:<committee-id>` through the established durable outbox, audit and configuration sync. No migration, new RPC, permission expansion or repository-contract changes. The Executive controls exclude archived committees and the internal keys are hidden from the generic feature list.

Only `/chair` startup with **already active, unexpired access** can select the art. It reads the existing actor-keyed IndexedDB checkpoint and committee preference concurrently, without awaiting them in the actual repository startup. An assigned single committee wins; multiple assignments require a valid saved selection. The confirmed checkpoint must match the conference, contain that non-archived assigned committee, and have a strict `true` flag. Any missing/malformed/failed cache or unavailable artwork falls back to the existing seal loader. Other workspaces, the initial access check and public delegate forms keep their existing behavior. A ready snapshot unmounts the loader immediately; failed startup still shows access/retry/recovery controls.

New devices see the standard screen on their first opening. They learn the preference through normal configuration snapshots for later openings. Offline or not-yet-synchronized devices may use an older cosmetic setting until their next confirmed snapshot. The switch is not a security control. No claim is made that toggling it instantly changes every offline device.

## Asset and offline behavior

`public/loading/committee-collage-v1.webp`: 1672 × 941, 229,078 bytes (~224 KiB). Generated from the supplied student collage as a separate clean background; no text is baked into the image. Requested only for opted-in startup or explicit Executive Preview, not prefetched during standard startup and not added to the service worker install list. A first uncached offline request fails back to the existing loader. The service worker and offline data storage are unchanged.

## Risk before the 31 October load test

**Low database impact; low-to-moderate startup/UI risk until browser and rehearsal checks pass.** There are no new Supabase reads, subscriptions or background writes. An Executive toggle is one normal configuration mutation; avoid switching many committees during the measured load window. Enabled startups do add one local checkpoint read and one preference read, plus a ~224 KiB static download when the art is not cached (about 24 MiB for 110 simultaneous uncached enabled devices). The checkpoint is already read by normal startup, so this is an additional local structured-clone cost on large saved snapshots. It runs concurrently and never gates readiness.

Keep the baseline load run on the same deployed commit with all switches off; test the enabled case separately on a prepared Chair device and a small group before expanding. Compare cold/repeated startup, missing/offline artwork, ready-to-render time and errors. Server-only load scripts do not measure artwork download/rendering. Do not deploy a different build halfway through the load run. Disable the affected switches to return to the standard loader after devices synchronize; a code rollback restores it immediately on the rolled-back build. No database rollback is needed. Stale offline cosmetic settings can persist until sync or a new build.

Independent review, CI and release approval remain the normal merge/release gates. This PR does not deploy or certify tomorrow's 110-device rehearsal.

## Verification evidence · 30 October

- Typecheck and production build pass. Lint exits successfully with the same three unused-variable warnings in `tests/committee-live-state-db.test.ts` as the baseline.
- Six new selection/render/outbox tests, one new fresh-database RPC test and the three existing workspace-loading tests pass. The RPC test covers Executive enable/disable, denial for Chair roles, an exact idempotent retry, and the flag reaching the normal Chair snapshot.
- Chromium verified the actual Executive settings page: default off, switch persistence across reload and preview. A local fixture mounting the real `ConferenceProvider` and loader verified enabled cached startup, invalidation after navigating away/disabling/returning, actor change, immediate removal on ready data, recovery precedence after startup error, the 1/2/3-dot sequence, reduced motion, and 320 px layout. A fresh-browser HTTP 404 artwork check falls back to the original seal loader. No hosted data was accessed.
- Completed full run (`node --import tsx --test --test-force-exit tests/*.test.ts`): **825 passed, 58 skipped, 4 failed**. Two failures are unchanged baseline assertions in `tests/device-protocol.test.ts`: “hosted actions carry deviceId, deviceSeq and the displayed label; local demo actions carry none” and “the displayed label: unknown without a schedule, no session outside every window, the session inside one”. Both expect `s1` but get `null` while their `Date.now() ± 1 hour` fixture spans Qatar midnight. Both reproduce on the unchanged baseline. A failed assertion leaves an interval alive, so the suite was also run with Node's `--test-force-exit` to collect the remaining results. These fixtures and session behavior are unchanged by this PR.
- The Node 24 full run also encountered native V8/WASM JIT crashes in `tests/identity-projection-db.test.ts` and `tests/session-schedule-db.test.ts`. Retrying those files on Node 22.23.3, matching the CI major version, passes all 17 tests (5 and 12 respectively). This does not establish a green full suite; CI remains required before merge.

## Layout follow-up · 31 October

Reduced the title, loading label, committee tag and tip text; limited the tip panel to 400 px. The complete collage now uses `object-fit: contain` in a separate middle grid row, with header and footer outside the artwork. Browser checks confirm no crop, overlap or overflow at 1440 × 900, 1920 × 1080, 768 × 1024, 390 × 844, 320 × 568, 568 × 320 and the 390 px Executive preview.

Latest verification: typecheck and production build pass; lint has only the three existing warnings. The full suite on Node 22.23.3 (`npm test -- --test-force-exit`) completes with **836 passed, 58 skipped, zero failed**. PostgreSQL 17 checks gated by local environment availability remain for CI. Earlier clock-fixture failures no longer reproduce at the current time; no unrelated test or session behavior was changed.

## Borderless refinement · 31 October

The owner preferred removing the navy frame. Restored edge-to-edge artwork with `object-fit: cover`, with the smaller text, tag and 400 px tip panel over it. The separate letterboxed image region described in the earlier layout follow-up is superseded. Cropping on narrow viewports is intentional for this full-screen presentation.

Borderless verification: browser checks confirm the artwork reaches all four edges at the same seven desktop/mobile/landscape/preview sizes, without overflow. Production build, typecheck and the loading/loader/artwork-filtered test run pass; lint retains only the three existing warnings.
