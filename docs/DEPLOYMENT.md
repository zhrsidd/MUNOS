# Deployment, releases and rollback

Owner: Claude, primary engineer across the application including platform, schema and migrations. Codex supplies independent review, verification and specialist support; shared architecture is serialized under one named integration owner. Root [AGENTS.md](../AGENTS.md) is authoritative; see [START_HERE.md](START_HERE.md).

## Architecture

```
GitHub zhrsidd/MUNOS
  feature branch ──► Pull request ──► CI (typecheck, lint, test, build)
        │                               + Vercel Preview deployment (dev Supabase)
        ▼
  review + Preview check ──► merge to main ──► Vercel **Preview** of main (dev Supabase)
                                                   │
                         deliberate release step ──┘
                                                   ▼
                     advance `production` to a verified main commit ──► Vercel Production (production Supabase)
```

- **One Vercel project** (`munos`, team `dcmun`), Next.js framework preset, imported from `zhrsidd/MUNOS`. **Production branch: `production`** (changed from `main` on 7 October 2026).
- `main` is the integration baseline. Every push to `main`, every other branch and every pull request gets a **Preview** deployment with its own immutable URL. **Merging to `main` never deploys Production.**
- Production is built only when someone deliberately moves the `production` branch to a commit that already passed CI and a Preview check (see *Releasing to Production*). As of this writing `production` = `c0a6a65` and **no Production deployment exists**.
- Functions run in `bom1` (Mumbai), next to the Supabase project, so server routes add little latency.
- Configuration in the repository: [`vercel.json`](../vercel.json) (install/build commands, region, freeze guard), [`next.config.ts`](../next.config.ts) (build identity, security headers), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- Nothing else is required: no Redis, no extra hosting, no separate backend. Supabase remains the only data store.

## Environments

**Owner-selected Preview mode (20 October 2026): browser demo.** Set `NEXT_PUBLIC_DATA_BACKEND=local` for Preview only. This decision does not change Production. The earlier shared-development-database setup below is historical/optional integration-test context, not the selected default. **Applied and verified 20 October 2026:** Preview `NEXT_PUBLIC_DATA_BACKEND` was changed from `supabase` to `local` by a team-authorized Vercel connection (Production untouched). A fresh Preview of this branch (`dpl_6Zo7x5BTfZ6Lm4bj6vRrkBtnEUtQ`, commit `a5975e9`) built successfully, and its `/api/health` reported `environment: preview`, status `ok`, and Supabase, database and storage all `not_configured` (browser demo). The leftover Preview Supabase variables for the deleted development project are now unused; removing them is a separate owner decision.

| | Local | Preview | Production |
| --- | --- | --- | --- |
| Trigger | `npm run dev` | any push / PR, **including `main`** | push to the `production` branch only |
| Supabase | none (local demo) or the DCMUN project | the **same** DCMUN project, `kllhswucdhqqywnzxado`, while it is in its development role | the **same** project `kllhswucdhqqywnzxado` after cutover (no second project) |
| Data | demo / test | test data only (the `DCMUN Development Test` conference) | real conference data, from cutover |
| Who uses it | developers | reviewers, rehearsals | the conference |

There is one DCMUN Supabase project (`kllhswucdhqqywnzxado`). It is the development project until cutover and the production project afterwards; it is never both at once in the target guard. The PHESMUN production project is never used. Preview must never run against the project once it holds real conference data.

### Target guard

`lib/platform/target-guard.ts` enforces that rule in code. It **fails closed**: a missing, malformed or contradictory configuration refuses, and there is no override flag.

| Where | Rule |
| --- | --- |
| Every build and the `/api/health` probe | The PHESMUN production project (`gglltljhdpkfjnyjmnif`) is **always refused**, in every environment. |
| Vercel **Production** build and probe | `NEXT_PUBLIC_SUPABASE_URL` must be exactly the project in `EXPECTED_SUPABASE_REF`. If that variable is unset the build **fails** (this is a change from before: a Production build now requires it). A refused probe reports `down` ("Wrong Supabase project") and contacts nothing. |
| Load, rehearsal, fixture and verification scripts (`scripts/*.mts`, via `remote-context.mts` and the direct guards) | The project must be listed in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS` (there is **no default**: the deleted former development project is not a fallback, and an unset list allows nothing). The production project is never a tool target. With no allow-list the tool refuses. A refusal throws **before any connection**. |

A project has exactly one role: listing the same ref as production and staging, or listing the PHESMUN production project anywhere, is a configuration error and refuses. Refusal messages name project refs only (public in the URL), never keys.

#### Single-project cutover

While the project is in its development role set `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado` (operator shell, `.env.local`, Vercel **Preview**), leave `DEVELOPMENT_SUPABASE_REFS` empty, and set `NEXT_PUBLIC_CONFERENCE_ID` to the test conference.

**Non-production policy (audit F1).** Every Vercel build other than Production, and every server route and health probe in such a deployment, refuses a Supabase project that is not listed in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS`, and always refuses the project named in `EXPECTED_SUPABASE_REF` (`targetProblem` in `lib/platform/target-guard.ts`). A Preview with `NEXT_PUBLIC_DATA_BACKEND=supabase` and no allow-list therefore fails to build. Production still requires exactly `EXPECTED_SUPABASE_REF`. This guard only covers deployments built after it; **it cannot change deployments that already exist**, because each Vercel deployment keeps the environment it was built with. Old deployments must be deleted (step 3).

At cutover (early November; compute raised from Micro to Small before 5 November) each step needs explicit approval. Record who did each step and when.

1. **Freeze the release.** Record the exact release commit (`main` SHA) and the last known good Production deployment id (rollback target). Confirm CI is green on that SHA and the migration ledger matches the repository.
2. **Remove test data.** Delete the `DCMUN Development Test` conference, its TEST committee and records, every test auth user and their `user_access` grants, and revoke all test access codes. Confirm with a read-only count that nothing test-labelled remains.
3. **Delete old Preview deployments.** In Vercel → Deployments, list every Preview (and Development) deployment built while Preview pointed at this project (filter by date and `Preview`), record their URLs for step 9, then **delete every one of them**. Deletion is required: each deployment is immutable and keeps the Supabase URL, publishable key and (server-side) secret key it was built with, so it can still read and write the project from the browser and from its server routes.
   These are **not** sufficient on their own:
   - Vercel Authentication controls who can open a deployment, not what it can reach; any authorised visitor could still use it against the promoted database.
   - Removing aliases still leaves the deployment's own URL working.
   - Changing environment variables affects only future builds.
   - Rotating the secret key (step 5) stops old server routes, but not browser reads and writes made with the publishable key.

   Keep an old deployment only if a separately verified mechanism blocks both its client and its server reads and writes. Record that mechanism and its verification here.
4. **Cut Preview off from the project.** In Vercel → Settings → Environment Variables (Preview): either set `NEXT_PUBLIC_DATA_BACKEND=local` (browser demo), or point the Supabase variables at a genuinely separate test project listed in `STAGING_SUPABASE_REFS`. Remove `kllhswucdhqqywnzxado` from `STAGING_SUPABASE_REFS` in every environment, including operator shells. From now on the load, rehearsal and verification scripts and any new Preview refuse the project, by design.
5. **Revoke Preview credentials.** Rotate `SUPABASE_SECRET_KEY` in the Supabase dashboard if any version of it was ever set for Preview or pasted anywhere, and set the new key only as a Sensitive **Production** variable. Revoke the anonymous sessions created by test devices (step 2 removes their grants).
6. **Point Production at the project.** Set `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`, the Supabase URL and publishable key, `NEXT_PUBLIC_DATA_BACKEND=supabase` and the real `NEXT_PUBLIC_CONFERENCE_ID` in the Vercel **Production** environment only. Steps 4 and 6 are one change: a project has one role at a time.
7. **Confirm capacity.** Plan, compute size (Small) and backups in the Supabase dashboard; the 110-device / 19-committee rehearsal must have passed before this step.
8. **Bootstrap and deploy.** Create the first Executive with [FIRST_EXECUTIVE_BOOTSTRAP](FIRST_EXECUTIVE_BOOTSTRAP.md), then deploy the recorded release SHA to Production.
9. **Verify isolation.**
   - **Old Previews:** open at least one old Preview URL recorded in step 3; it must be gone (Vercel "deployment not found"). If step 3 recorded an exception, confirm that deployment can neither read nor write the project, from the browser or from its server routes.
   - **New Preview:** open a newly built Preview; it must not reach the project. Expect a refused build, "Wrong Supabase project" on `/api/health`, or the local demo backend.
   - **Production:** `/api/health` reports the expected project and `ok`.
10. **Rollback.** If Production misbehaves, promote the deployment recorded in step 1 (Vercel → Deployments → Promote). Migrations are forward-only and additive; a rollback of the app does not require a database rollback.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables, separately for **Preview** and **Production**.

| Variable | Exposure | Preview | Production | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_DATA_BACKEND` | browser | `supabase` | `supabase` | `local` = isolated demo, no database |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | dev URL | prod URL | public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | dev publishable key | prod publishable key | publishable (`sb_publishable_…`) only — never the secret/service-role key |
| `NEXT_PUBLIC_CONFERENCE_ID` | browser | dev conference UUID | prod conference UUID | |
| `NEXT_PUBLIC_ENABLE_ANONYMOUS_BOOTSTRAP` | browser | — | — | **No longer read** by the application (the staff access-code gate creates the device's anonymous identity only when a code is submitted). Leave unset; harmless if present. |
| `NEXT_PUBLIC_APP_VERSION` | browser | optional | optional | defaults to `package.json` version |
| `NEXT_PUBLIC_CONFERENCE_TIMEZONE` | browser | `Asia/Qatar` | `Asia/Qatar` | venue time zone for schedule import and group photos |
| `SUPABASE_SECRET_KEY` | **server only** | dev secret key | prod secret key | mark **Sensitive**. Used only by server routes: resolution QR submission (`/submit/*`, `/api/submissions`, file-upload fallback), amendment QR submission (`/amend/*`, `/api/amendments`) and the health storage probe. Without it both QR forms report "not available". Never prefix with `NEXT_PUBLIC_`. |
| `CONFERENCE_FREEZE` | build only | unset | `1` during freeze | see Production freeze |

Vercel's system variables (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_DEPLOYMENT_ID`) are read at build time to stamp each deployment; leave "Automatically expose System Environment Variables" enabled.

Rules: never commit `.env.local`; never place a secret in a `NEXT_PUBLIC_*` variable (it is compiled into browser JavaScript); rotate any key that is ever pasted into chat, a ticket, or a commit.

## Vercel project setup

Current state (verified 8 October 2026):

- Project `munos` exists; Git integration with `zhrsidd/MUNOS` is live; Preview deployments build automatically.
- Production branch: **`production`**. Preview environment variables point at the **development** Supabase project, including a development `SUPABASE_SECRET_KEY` (Preview only). **No Production environment variables exist** and **no Production deployment exists**.
- Deployment Protection: *Vercel Authentication* on **all** deployments (Preview and Production). Automated checks use a *Protection Bypass for Automation* secret held only by the technical contact.

Still to do, **only after the conference-week gates in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) pass**:

1. Settings → **Environment Variables** → Production: the table above with **production** Supabase values (never development values).
2. Settings → **Deployment Protection** (conference-week configuration gate — leave unchanged until then): Production must open **without a Vercel account** for conference devices and, above all, for delegates' phones on `/submit/*` and `/amend/*`. Change protection so the Production domain is public (for example "Standard Protection", which protects Preview URLs only); keep Previews protected. Removing the Vercel login does **not** weaken staff authorization: every staff workspace still requires a MUNOS staff access code and an active grant (enforced by the app and by database RLS), and the public delegate routes never create a staff session or open a workspace. Verify from a normal, unauthenticated phone on mobile data before release: the conference URL shows the staff access-code screen, and a resolution QR and an amendment QR open their forms.
3. Settings → **Domains**: add the conference domain to Production when ready.
4. Settings → **Functions**: confirm region `bom1` (from `vercel.json`).
5. GitHub → Settings → Branches → protect `main` **and `production`**: require a pull request / the **CI / verify** check; disallow force pushes.
6. Recommended: Vercel **Pro** for the conference period. Hobby's Instant Rollback only returns to the immediately previous production deployment; Pro can roll back to any eligible earlier production deployment.

## Normal workflow

1. Work on a feature branch; open a PR.
2. CI must pass. Vercel posts the Preview URL on the PR.
3. Verify the Preview: `npm run verify:deployment -- <preview-url>` (for protected previews, run it from a browser session or use a bypass token), then click through the changed screens.
4. Merge to `main`. Vercel builds a **Preview** of `main` (development Supabase). Verify it the same way.

Database migrations are coordinated separately by the named integration owner, independently reviewed and replayed on staging before release, and must be **backward compatible** with the currently deployed application: apply the migration first, then deploy the code that uses it. A Vercel rollback never reverts the database.

## Releasing to Production

Production changes only by a deliberate, recorded step approved by John Paul Ribeiru, with the owner approving production configuration changes. Do it only when every gate in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) up to "Production setup" is ticked, including the PR #22 staging/migration/sync gate where applicable. Historical environment/project/branch values below must be rechecked; this handoff does not establish current hosted state or a known-good release.

1. Pick the exact `main` commit to release. It must have green CI and a verified `main` Preview.
2. Under the approved release plan, the named integration owner applies the committed, staging-replayed migrations that commit needs to the **production** Supabase project first (each exactly once; record the ledger and verify compatibility with the currently deployed app).
3. Advance `production` to that **exact verified commit** through the approved branch-protection workflow; never force-push. A new merge commit has a different SHA: if the workflow creates one, verify that resulting commit before release rather than claiming it is the already-verified SHA. Do not add incidental code changes to the release.
4. Vercel builds Production from `production`. Verify: `npm run verify:deployment -- <production-url> <sha>`; System health on one device shows `<version> · <sha7> · production`, Supabase `ok`, Storage `ok`.
5. Record the release in [RELEASES.md](RELEASES.md).

During the freeze `CONFERENCE_FREEZE=1` (Production environment) additionally makes Vercel skip any Production build whose commit message lacks `[emergency]`, so an accidental push to `production` does not deploy.

## Identifying a deployment

Every build is stamped with version, commit, branch, environment and deployment ID:

- **In the app:** Executive → System health → *Running version* (e.g. `0.2.0 · a1b2c3d · production`).
- **Machine-readable:** `GET /api/health` → `app.version`, `app.commit`, `app.environment`, `app.deploymentId`, plus Supabase/Storage reachability. Cached for 15 seconds; safe for an uptime monitor (one request per minute is plenty).
- **In Vercel:** Deployments list → commit SHA and immutable deployment URL.

## Known-good conference release

The *known-good conference release* is one specific production deployment that has passed the full rehearsal. It is the release you return to if anything goes wrong.

To declare it (technical lead, after rehearsal passes):

1. Confirm the production deployment's commit in System health matches the rehearsed commit.
2. Tag the commit: `git tag -a known-good-<conference>-<yyyy-mm-dd> <sha> -m "Known-good conference release"` and push the tag.
3. Record it in [RELEASES.md](RELEASES.md): version, commit, Vercel deployment URL (`*.vercel.app`, immutable) and ID, database migration version, who verified, date.
4. Print the **Known-good card** from RELEASES.md and put it in the conference operations folder.
5. Set the production freeze (below).

A non-technical organizer can check it at any time: open System health and compare *Running version* with the printed card. If they match, the conference is on the known-good release.

## Production freeze

**From 48 hours before the conference until it ends, production is frozen.**

- No normal feature deployments. No migrations.
- Do not advance the `production` branch. Merges to `main` keep producing Previews only and never reach Production.
- Set `CONFERENCE_FREEZE=1` on the Production environment in Vercel as a second guard: a Production build from `production` is then skipped by `scripts/vercel-ignore-build.sh` unless its commit message contains `[emergency]`.
- Only conference-blocking emergency fixes may deploy. An emergency fix must:
  - be narrowly scoped (the smallest change that removes the blocker),
  - pass CI (typecheck, lint, tests, build),
  - be checked on its Preview deployment first,
  - have an immediate rollback path (the known-good release remains the previous production deployment),
  - contain no database migration,
  - be merged to `main`, then brought to `production` with `[emergency]` in the commit message that lands on `production` (this is what lets the build guard deploy it),
  - be cross-reviewed (Claude/Codex) unless the conference is actively blocked, in which case review happens immediately after.
- After an emergency fix is verified, record it in RELEASES.md. Do not re-declare known-good during the conference unless the old one is unusable.
- Remove `CONFERENCE_FREEZE` after the conference.

## Rollback

A rollback restores an earlier **application build and its configuration**. It does not change the database or recover changes saved on a laptop that has not synced.

1. Check [Vercel status](https://www.vercel-status.com/) and [Supabase status](https://status.supabase.com/) first; a platform outage is not fixed by rollback.
2. Vercel → Project → **Deployments** → find the known-good deployment (match the commit from the card) → **⋯ → Instant Rollback** (or the Production Deployment card → *Instant Rollback* → choose it) → **Continue** → **Confirm Rollback**.
3. Verify: `npm run verify:deployment -- <production-url> <known-good-sha>` or open System health on one device and compare *Running version* with the card.
4. Ask chairs to refresh only once System health shows the known-good version and their device shows **0 unsynced changes**. Devices keep working offline in the meantime.
5. After rollback Vercel stops auto-assigning the production domain to new builds. That is desirable during the conference. Undo it only after a replacement is verified.

Rehearse a rollback on the Production project at least once before the freeze (deploy a harmless change, roll back, verify the version).

## Uptime monitoring

Optional and lightweight: point one external uptime checker (or Vercel's own monitoring, if on a plan that includes it) at `/api/health` every 1–5 minutes. Do not add more frequent probing; devices already measure their own database latency.
