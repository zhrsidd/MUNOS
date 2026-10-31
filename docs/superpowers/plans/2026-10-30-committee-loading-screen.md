# Committee loading screen implementation plan

**Goal:** Implement the approved collage direction without the “Diplomatic Royale” subtitle or bottom-right tagline, with an Executive switch per committee.

**Architecture:** Reuse the existing admin-only `feature` command and boolean feature map (`committeeLoadingScreen:<committee-id>`). A Chair startup component reads the existing actor-bound local checkpoint after access is active, chooses only an assigned non-archived committee, and falls back to the original loader for unknown settings. No schema, domain-contract, transport, access, outbox or service-worker changes; no added server reads or delays.

**Tech stack:** Existing Next.js/React/CSS, IndexedDB, one compressed same-origin WebP.

## Tasks

- [x] Test the cache selection: default off, one/multiple Chair assignments, expired/revoked access, other workspaces, wrong conference, missing/broken storage, archived committee. Prove the existing feature command is admin-only and works through the durable outbox and server snapshots.
- [x] Add selection helper, alternative loader and Executive configuration/preview in Workflow & features. Keep the initial access check and error/recovery screens unchanged; remove instantly when data is ready. Dots cycle 1/2/3 in 1.5 seconds; static three dots for reduced motion; pause animation when hidden. Failed art uses the standard loader. No progress bar or invented percentage.
- [x] Prepare a clean collage asset, compress to WebP, document the opt-in brand exception and rollout risk. No artwork download for a disabled/unknown committee. First visits use the standard loader until a confirmed setting is cached. An offline device can retain its last synchronized preference.
- [x] Run targeted tests, typecheck, lint, full tests and build, then browser checks of Executive settings, loader animation, artwork failure, small screens and immediate ready/error fallback. Independently review, address findings, commit, push and open a PR. Do not merge or deploy.

## Review focus

Identity changes must never reuse another actor's selection. A multi-committee Chair must not use an arbitrary committee. Unknown/malformed settings must default off. Artwork failure must not block startup. Cached settings may lag Executive changes and must not be treated as permissions.

## Outcome

Draft [PR #90](https://github.com/zhrsidd/MUNOS/pull/90) is open. No merge or deployment. Independent review reports no remaining blockers after the route-invalidation fix. Final verification and full-suite limitations are recorded in [COMMITTEE_LOADING_SCREEN.md](../../COMMITTEE_LOADING_SCREEN.md).
