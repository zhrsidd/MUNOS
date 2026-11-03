# Cutover close-out and freeze, 3 November 2026

The one-page list for today. It adds no approval and changes no procedure: [DEPLOYMENT.md](../../DEPLOYMENT.md) (release, known-good card, freeze) and [LIFECYCLE_CONTROLS.md](../../LIFECYCLE_CONTROLS.md) govern, and the activation record is [EXECUTION.md](../2026-11-01/EXECUTION.md). Everything below that touches Vercel, Supabase or Production configuration is a **human** step and needs the owner's approval where marked. Claude and Codex hold no hosted access after promotion and do not do these steps. This page lives on `main` only: nothing here deploys Production, and the `production` branch must not be moved for it.

**Where things stand (from the repository, 3 November).** The release record names `cfa63db` as the Production release. The `production` branch is at `c8f2a22`: three later commits (#102 docs, #103 copy polish and Chair points guide, #105 five-second Chair welcome after login) went onto it on 2 November, and #103 and #105 changed application code with no migration. Which commit Vercel is serving cannot be read from the repository. The activation record still lists the Executive bootstrap, staff setup and real QR checks as pending.

## 1. Confirm what is running (read-only; do this first)

Do any one of these, and record the SHA:

1. **System health** on a device: "Running version" reads `<version> · <sha7> · production`.
2. **Deployment check:** `npm run verify:deployment -- https://dcmun-os.vercel.app <sha>`.
3. **Vercel, Deployments:** the Production deployment's commit.

| Live SHA is | Then |
| --- | --- |
| `c8f2a22` | The two later app changes are running. Go to step 2 and approve this exact SHA. |
| `cfa63db` | The later changes are not running. Record that. Decide with the owner whether to leave them out or to deploy them, and do that before the freeze takes effect. Do not move `production` after the freeze starts. |
| anything else | Stop and tell the owner before doing anything else. |

## 2. Approve the exact running SHA (release approver)

John Paul Ribeiru records approval for the **exact** SHA from step 1. The 1 November approval names `cfa63db` and does not cover `c8f2a22`. Record it in `docs/RELEASES.md` as a new top row of the entries table (newest first) once verified, using the real values, for example:

`| <date> | <full SHA> | <deployment id from Vercel> | <latest applied migration> | Verified running by <name> | <approver> approved this SHA | <note> |`

The owner separately records infrastructure and configuration approval.

## 3. Set the production freeze (owner approval; Vercel dashboard)

The freeze starts 48 hours before the conference, which is **today, 3 November**. It is a second guard on top of branch protection.

1. Vercel, project `munos`, Settings, Environment Variables.
2. Add `CONFERENCE_FREEZE` with the value exactly `1` (no spaces or quotes), for the **Production** environment only. Leave Preview and Development alone.
3. Saving it does not rebuild anything or change the running deployment. It applies to the next Production build.
4. Check the entry afterwards: name spelled exactly, value `1`, Production only.
5. Confirm the production branch protection is active: GitHub, Settings, Rules, ruleset `26307954` (verify check required, no force-push or deletion; see [production-ruleset.json](../2026-11-01/production-ruleset.json)).

**How the guard behaves.** `scripts/vercel-ignore-build.sh` is wired in through `ignoreCommand` in `vercel.json`. It was run locally on 3 November in five cases:

| Case | Result |
| --- | --- |
| Production, `CONFERENCE_FREEZE=1`, normal commit message | build skipped (exit 0) |
| Production, `CONFERENCE_FREEZE=1`, message contains `[emergency]` | build runs (exit 1) |
| Production, freeze not set | build runs |
| Preview, `CONFERENCE_FREEZE=1` | build runs (Previews are never affected) |
| Production, `CONFERENCE_FREEZE=0` | build runs |

**Do not test the freeze by pushing to `production` or by toggling the setting on and off.** The local result above plus the entry check in step 3.4 is the verification. A rollback in Vercel does not build, so it is unaffected by the freeze.

## 4. While frozen (until the conference ends)

- No normal deployments, no migrations, and `production` does not move.
- Only conference-blocking emergency fixes may deploy. Each must be the smallest change that removes the blocker; pass CI (typecheck, lint, tests, build); be checked on its Preview first; contain no migration; have the known-good release as an immediate rollback; and land on `production` with `[emergency]` in the commit message (squash-merge title, for example `[emergency] fix roll call crash`). Review by Claude or Codex happens before, or immediately after if the conference is blocked. Record it in `docs/RELEASES.md`.
- Do not re-declare the known-good release during the conference unless the old one is unusable.
- Keep [EMERGENCY_RECOVERY.md](../../EMERGENCY_RECOVERY.md) printed in the operations folder.

## 5. Operator checklist for today

Each item is confirmed by a human against the live system. None needs a deployment, and none should change Production configuration unless the owner approves it.

| # | Task | Who | Evidence to record |
| --- | --- | --- | --- |
| 1 | Production variables and secrets are the rotated Production-scoped values; Preview has no hosted values; the database target and classification are production; staff routes require a staff code | Operator, owner | Variable names and scopes (never values), `/api/health` result |
| 2 | First Executive bootstrap, bootstrap code revoked by the first rotation, real Executive code stored | Technical lead and first Executive, in person ([FIRST_EXECUTIVE_BOOTSTRAP.md](../../FIRST_EXECUTIVE_BOOTSTRAP.md)) | Section B verification row, time |
| 3 | Staff codes issued from the app, committees and roster set up | First Executive | Count of codes and committees, time |
| 4 | Brief non-destructive checks as Chair, Approval, Logistics and Admin, including committee scope and Chair permissions | Operator, using real staff accounts and no test data | One line per role |
| 5 | Issue the real resolution and amendment QR links, open both forms from a normal phone on mobile data without a Vercel login, revoke any obsolete code or link | First Executive, operator | Both forms open, time |
| 6 | A recent successful backup, recovery and restore arrangement, offline recovery and outbox handling understood | Operator | Latest backup time, PITR decision |
| 7 | Rollback deployment compatible: a same-revision recovery option is selectable in Vercel. No earlier-version rollback drill was run, and none should be run on Production | Operator | Deployment ID of the rollback target |
| 8 | Capacity evidence gap: the independent review recomputed the H3 pass ([CAPACITY_REVIEW.md](../../evidence/cutover-2026-11-01/CAPACITY_REVIEW.md)), but complete operator capacity acceptance is open. The release owner records an explicit decision. Do not run any load against Production | Release owner | Written decision |

## 6. Known-good release (after steps 1 to 3 and items above)

1. Confirm System health matches the SHA you approved.
2. Tag it: `git tag -a known-good-dcmun-<yyyy-mm-dd> <sha> -m "Known-good conference release"` and push the tag. Never move or reuse a tag.
3. Fill the Known-good card in `docs/RELEASES.md` with the real conference, running version, commit, production URL (`https://dcmun-os.vercel.app`), deployment ID, latest migration, and who verified it and when. Print it and put it in the operations folder.

## Do not

Run load or destructive tests on Production. Toggle the freeze to check it. Push to `production` except an `[emergency]` fix. Apply a migration. Paste a key, code, token or link into chat, a ticket or this repository. Reuse a Preview or staging build for Production.
