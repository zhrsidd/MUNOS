# Deployment, releases and rollback

Owner: Claude (platform). Schema/migrations remain Codex-owned; see [AGENTS.md](../AGENTS.md).

## Architecture

```
GitHub zhrsidd/MUNOS
  feature branch ──► Pull request ──► CI (typecheck, lint, test, build)
        │                               + Vercel Preview deployment (dev Supabase)
        ▼
  review + Preview check ──► merge to main ──► Vercel Production (production Supabase)
```

- **One Vercel project**, Next.js framework preset, imported from `zhrsidd/MUNOS`. Production branch: `main`.
- Every other branch and every pull request gets a **Preview** deployment with its own immutable URL.
- Functions run in `bom1` (Mumbai), next to the Supabase project, so server routes add little latency.
- Configuration in the repository: [`vercel.json`](../vercel.json) (install/build commands, region, freeze guard), [`next.config.ts`](../next.config.ts) (build identity, security headers), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- Nothing else is required: no Redis, no extra hosting, no separate backend. Supabase remains the only data store.

## Environments

| | Local | Preview | Production |
| --- | --- | --- | --- |
| Trigger | `npm run dev` | any non-`main` push / PR | merge to `main` |
| Supabase | none (local demo) or dev | **development** project `opmydpozhdgkpcnjwpqb` | **production** project (not yet created) |
| Data | demo / dev | dev data only | real conference data |
| Who uses it | developers | reviewers, rehearsals | the conference |

Preview must never point at the production database. Production must never point at the development database.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables, separately for **Preview** and **Production**.

| Variable | Exposure | Preview | Production | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_DATA_BACKEND` | browser | `supabase` | `supabase` | `local` = isolated demo, no database |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | dev URL | prod URL | public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | dev publishable key | prod publishable key | publishable (`sb_publishable_…`) only — never the secret/service-role key |
| `NEXT_PUBLIC_CONFERENCE_ID` | browser | dev conference UUID | prod conference UUID | |
| `NEXT_PUBLIC_ENABLE_ANONYMOUS_BOOTSTRAP` | browser | `false` | `false` | see INTEGRATION.md before enabling |
| `NEXT_PUBLIC_APP_VERSION` | browser | optional | optional | defaults to `package.json` version |
| `SUPABASE_SECRET_KEY` | **server only** | dev secret key | prod secret key | mark **Sensitive**. Used only by server routes (resolution submission links and the file-upload fallback, health storage probe). Never prefix with `NEXT_PUBLIC_`. |
| `CONFERENCE_FREEZE` | build only | unset | `1` during freeze | see Production freeze |

Vercel's system variables (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_DEPLOYMENT_ID`) are read at build time to stamp each deployment; leave "Automatically expose System Environment Variables" enabled.

Rules: never commit `.env.local`; never place a secret in a `NEXT_PUBLIC_*` variable (it is compiled into browser JavaScript); rotate any key that is ever pasted into chat, a ticket, or a commit.

## One-time Vercel setup (manual dashboard actions)

No Vercel project exists yet. An owner must:

1. Vercel → **Add New → Project** → import `zhrsidd/MUNOS`. Framework preset: Next.js. Leave build settings to `vercel.json`.
2. Settings → **Git** → Production Branch: `main`.
3. Settings → **Environment Variables**: add the table above for Preview and Production (Production only once the production Supabase project exists; until then do not create a Production deployment that points at dev).
4. Settings → **Deployment Protection**: keep *Vercel Authentication* on for Preview deployments. Production stays public (conference devices and QR submission pages must open without a Vercel login).
5. Settings → **Functions**: confirm region `bom1` (from `vercel.json`).
6. Settings → **Domains**: add the conference domain to Production when ready.
7. GitHub → Settings → Branches → protect `main`: require a pull request and the **CI / verify** check; disallow force pushes.
8. Recommended: Vercel **Pro** for the conference period. Hobby's Instant Rollback only returns to the immediately previous production deployment; Pro can roll back to any eligible earlier production deployment.

## Normal workflow

1. Work on a feature branch; open a PR.
2. CI must pass. Vercel posts the Preview URL on the PR.
3. Verify the Preview: `npm run verify:deployment -- <preview-url>` (for protected previews, run it from a browser session or use a bypass token), then click through the changed screens.
4. Merge to `main`. Vercel builds Production.
5. Verify Production: `npm run verify:deployment -- <production-url> <merged-commit-sha>`, then open **System health** on one device and confirm the running version.

Database migrations are applied separately (Codex-owned) and must be **backward compatible** with the currently deployed application: apply the migration first, then deploy the code that uses it. A Vercel rollback never reverts the database.

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
- Set `CONFERENCE_FREEZE=1` on the Production environment in Vercel. Normal merges to `main` will then be skipped by the build guard (`scripts/vercel-ignore-build.sh`); they do not reach production.
- Only conference-blocking emergency fixes may deploy. An emergency fix must:
  - be narrowly scoped (the smallest change that removes the blocker),
  - pass CI (typecheck, lint, tests, build),
  - be checked on its Preview deployment first,
  - have an immediate rollback path (the known-good release remains the previous production deployment),
  - contain no database migration,
  - be merged with `[emergency]` in the squash-merge commit title (this is what lets the build guard deploy it),
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
