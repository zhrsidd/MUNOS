# v1 release checklist

Consolidated 21 October 2026 from the repository's own documents and scripts. **Documentation only: this page authorises nothing.** It does not approve a migration, a tag, a version bump, a Production backend cutover, a load test or any change to Vercel or Supabase. Feature freeze applies.

It does not replace the existing gate documents; it indexes them against what is actually proven today:
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (gates, last written 8 October), [DEPLOYMENT.md](DEPLOYMENT.md) (single-project cutover, freeze, rollback), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (project record, migrations 1 to 26), [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) (load and failure plan), [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md), [RELEASES.md](RELEASES.md) and [ACCESS_CODES_DESIGN.md](ACCESS_CODES_DESIGN.md). Governance: root [AGENTS.md](../AGENTS.md). John Paul Ribeiru approves releases; Zuhayr Siddique (owner) approves product scope and Production configuration.

## How to read the status column

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Evidence exists. The date, commit or PR, and the place it is recorded are cited. |
| **OUTSTANDING** | Not done. The exact owner action or command is stated. |
| **NOT VERIFIABLE FROM THE REPO** | Lives in the Supabase or Vercel dashboard, or in someone's hands. The named person must confirm it; nothing in the repository can prove it. |

Baseline for this page: `origin/main` = `b123ae6` (PR #56, docs only), whose code is the `542e705` release candidate. `package.json` version is `0.2.0`. No git tag exists.

## Release blockers (summary)

The release cannot be declared until every item below is closed. Each is detailed in the sections that follow.

| # | Blocker | Section |
| --- | --- | --- |
| B1 | Supabase plan (Pro), compute (Small) and backups/PITR are unverified. The record says Micro compute and an unconfirmed plan. | 2 |
| B2 | The public submission server routes (`/api/submissions`, `/api/amendments`, `/submit/*`, `/amend/*`) have never been run against the current project with the server-only key. | 4 |
| B3 | No real-device offline rehearsal has been recorded on the current project. | 6 |
| B4 | The 110-device / 19-committee readiness run (STAGING_REHEARSAL C2) has not been run. This is the capacity gate in `AGENTS.md`. | 7 |
| B5 | Production backend cutover has not happened (Production is a demo build) and needs the owner's approval of each step. | 3, 10 |
| B6 | No rollback drill and no database recovery procedure has been rehearsed or written. | 8 |
| B7 | No known-good release is declared (no tag, no `RELEASES.md` entry, no printed card). | 10 |
| B8 | Final production smoke tests and sign-off are not possible until B1 to B7 close. | 9, 10 |

## Owner-approval gates

Nothing below happens without the named approval, recorded next to the step. Claude proposes; these are not delegated.

| Gate | Needs | Why / source |
| --- | --- | --- |
| Any new migration (27 or later) | Owner approval, independent (Codex) review, replay on the preproduction project, then apply once. **None is planned; feature freeze.** | `AGENTS.md` protected area 3; DEPLOYMENT.md "Normal workflow" |
| Version bump from `0.2.0` | Owner approval. Not part of this task. | `package.json` |
| Git tag (for example `known-good-<conference>-<yyyy-mm-dd>`) | John Paul Ribeiru approves the release, owner approves the tag. **No tag may be created before sign-off.** | DEPLOYMENT.md "Known-good conference release" |
| Production backend cutover (single-project steps 1 to 10) | Explicit approval **per step**, who and when recorded. Includes deleting old Preview deployments, removing the ref from `STAGING_SUPABASE_REFS`, and setting Production `EXPECTED_SUPABASE_REF`. | DEPLOYMENT.md "Single-project cutover" |
| Any Vercel Production configuration change (env vars, Deployment Protection, `production` branch) | Owner approval. | `AGENTS.md` protected area 1 |
| Supabase upgrade to Pro / Small compute / PITR add-on | Owner approval of organisation and cost before the resource change. | RELEASE_CHECKLIST.md header; `AGENTS.md` |
| Load test and the 110-device rehearsal | Owner approval to run; runs only against the project while it holds test data and is listed in `STAGING_SUPABASE_REFS`. | `AGENTS.md`; STAGING_REHEARSAL.md |
| Running anything with the server-only `SUPABASE_SECRET_KEY` | Owner supplies the key in an ignored local environment. It is never pasted into chat, a doc or a ticket. | `AGENTS.md` protected area 2 |
| Release sign-off | John Paul Ribeiru, recorded in RELEASES.md. | `AGENTS.md`; DEPLOYMENT.md "Releasing to Production" |

---

## 1. Database and migration verification

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.1 | Repository holds 26 committed migrations, latest `20261021130000_identity_projection.sql`. | **VERIFIED** | `ls supabase/migrations` on `b123ae6` returns 26 files. |
| 1.2 | DCMUN Staging project `kllhswucdhqqywnzxado` has exactly those 26 migrations; ledger versions and names equal the filenames. | **VERIFIED** | 21 Oct 2026, [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) "Migrations 22 to 26" (PR #56 / `e3e33f8`, `bc6dc9f`). Migrations 1 to 21 applied 20 Oct with the CLI after PR #22 (`852642c`). |
| 1.3 | Applied SQL equals the repository files. | **VERIFIED** | 22 to 26: stored statements compared with the files by trimmed MD5, all identical (21 Oct, same section). 1 to 21: files compared byte for byte before apply; schema fingerprint of the hosted database matched a local PostgreSQL 17 rebuild (columns 402, constraints 291, indexes 260, policies 41, functions 46, triggers 5, enums 4; recorded 20 Oct). That fingerprint predates 22 to 26 and was not repeated. |
| 1.4 | Dry run of 22 to 26 on the live database before applying. | **VERIFIED** | 21 Oct: one transaction, aborted on purpose; ledger still 21 rows afterwards (SUPABASE_PROJECT_SETUP.md). |
| 1.5 | Grants and RLS after the new migrations. | **VERIFIED** | 21 Oct "Grants (live)": new `private` functions callable only as designed; `public.photo_list_epochs` RLS on, `authenticated` SELECT only, nothing for `anon`. Earlier baseline: RLS on all 41 tables, `anon` has no table or function privileges (20 Oct). |
| 1.6 | Security advisors show nothing new. | **VERIFIED** | 21 Oct: same four access-code SECURITY DEFINER warnings, anonymous-policy notices and leaked-password protection, all on the accepted list in RELEASE_CHECKLIST.md section 2. **Repeat if any schema changes.** |
| 1.7 | App-level smoke test on the migrated project. | **VERIFIED** | 21 Oct: `npm run smoke:project` 15/15 and signed-in Chromium checks of scoring, photos, voting, Approval and Logistics on an isolated temporary conference, against a build of `main` at `542e705` (SUPABASE_PROJECT_SETUP.md). |
| 1.8 | CI green on the release candidate (typecheck, lint, test against PostgreSQL 17, build). | **VERIFIED** for `542e705` | SUPABASE_PROJECT_SETUP.md records "CI green on that commit". Workflow: `.github/workflows/ci.yml`. **OUTSTANDING:** re-confirm CI on the exact commit that will be released (PR #56 changed docs only). |
| 1.9 | The released commit contains every migration it needs, and no migration is added during the freeze. | **OUTSTANDING** | Owner decision: freeze the migration list at 26. If any later change needs a migration, it goes through the gate above. |
| 1.10 | Test data present on the project: conference "DCMUN Development Test" (id `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`), the 21 Oct temporary conference with the same name, TEST committee `TST`, anonymous test users and grants, test access codes. | **OUTSTANDING** | Removal is cutover step 2 (DEPLOYMENT.md). Owner approves; confirm with a read-only count that nothing test-labelled remains. |
| 1.11 | Re-run `npm run smoke:project` as a final regression on the exact release commit. | **OUTSTANDING** | Needs an Executive code for a TEST conference in `SMOKE_EXECUTIVE_CODE`, `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado`, and must happen **before** the cutover removes the ref. Operator: technical lead or Claude, with owner approval. |
| 1.12 | `rls_auto_enable()` revoke and PR #25 target-guard review follow-ups listed under "Open items". | **NOT VERIFIABLE FROM THE REPO** | The "Open items" list in SUPABASE_PROJECT_SETUP.md predates 21 Oct and is partly stale (the target guard is on `main`). Owner and Codex must say which items still apply. |
| 1.13 | Dashboard project is renamed from "DCMUN Staging" to a production-safe name. | **OUTSTANDING** | Owner, in the Supabase dashboard, before cutover (SUPABASE_PROJECT_SETUP.md "Naming"). |

## 2. Supabase Pro compute and backup / PITR verification

The Supabase connector **cannot** read the plan, the compute size, backup settings or PITR state. SUPABASE_PROJECT_SETUP.md says so explicitly ("Not verifiable through the connector: plan (Pro) and compute size (Micro)"). Everything in this section needs the **owner or technical lead looking at the Supabase dashboard**, with a screenshot or dated note stored in the release folder.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 2.1 | Organisation is on **Pro**. | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Organisation, Billing. Last recorded as unconfirmed (20 Oct). Owner approves any upgrade and its cost first. |
| 2.2 | Compute is **Small** (last recorded Micro). | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Project Settings, Compute. DEPLOYMENT.md and SUPABASE_PROJECT_SETUP.md require Small **before 5 November** and before the capacity rehearsal. |
| 2.3 | Region ap-south-1 and Postgres 17.11, `ACTIVE_HEALTHY`. | **VERIFIED** (20 Oct) | Project record in SUPABASE_PROJECT_SETUP.md, read through the connector. Vercel functions run in `bom1` (`vercel.json`). |
| 2.4 | Scheduled daily backups exist and the latest one succeeded. | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Database, Backups. RELEASE_CHECKLIST.md section 2 and TROUBLESHOOTING.md both require it; nothing records it as done. |
| 2.5 | PITR decision. | **NOT VERIFIABLE FROM THE REPO** | No repository document mentions point-in-time recovery. Owner decides whether it is needed for the conference and, if so, enables it in the dashboard and records the retention window and cost. Do this **before** real data is loaded, because recovery only reaches back to when it was enabled. |
| 2.6 | A restore has been read through, and ideally rehearsed, on a non-live target. | **OUTSTANDING** | Owner or technical lead reads the Supabase restore steps for the chosen option and records the expected time and what is lost (see 8.5). The repository has no restore runbook. |
| 2.7 | Fallback export plan if backups are not trusted. | **OUTSTANDING** | TROUBLESHOOTING.md says to take an export at the end of each day. Owner names who does it, how, and where the file is stored. |
| 2.8 | Auth rate limit for anonymous sign-ins per IP is set to a measured value. | **OUTSTANDING** | Default is 30 per hour; the venue shares one NAT (STAGING_REHEARSAL Phase D). Owner or technical lead sets it in Dashboard, Authentication, Rate limits **after** the measurement in section 7. |
| 2.9 | Anonymous sign-ins enabled; leaked-password protection warning accepted (no passwords are used). | **VERIFIED** (20 Oct) | Anonymous sign-in works over HTTP (SUPABASE_PROJECT_SETUP.md "Behaviour"). |

## 3. Production environment and project-target guards

Current state, as observed 21 Oct 2026 and **not yet recorded in the repository**: the Production site is a **demo-mode build serving `main` `542e705`**, with Supabase `not_configured`. The owner has removed the Preview Supabase variables. Record both in [RELEASES.md](RELEASES.md) and DEPLOYMENT.md so the repo matches (the "Environments" paragraph in DEPLOYMENT.md still calls the removal "a separate owner decision").

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 3.1 | Guard code: PHESMUN `gglltljhdpkfjnyjmnif` is refused everywhere; Production must equal `EXPECTED_SUPABASE_REF` and fails the build if it is unset; non-Production builds and all `scripts/*.mts` need the ref in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS`; a project cannot hold two roles; no override exists. | **VERIFIED** | `lib/platform/target-guard.ts`, `next.config.ts` and `tests/target-guard.test.ts` on `main`; behaviour documented in DEPLOYMENT.md "Target guard". Re-run `npm test` on the release commit to reconfirm. |
| 3.2 | Production serves `main` `542e705` as a demo build, Supabase `not_configured`. | **VERIFIED** (21 Oct, observed through Vercel and `/api/health`) | Not yet written into the repo. Action: record in RELEASES.md. Production has no Supabase variables, so the guard has nothing to check yet. |
| 3.3 | Preview is cut off from the project (cutover step 4). | **VERIFIED** for the Supabase variables, by the owner (21 Oct) | The 20 Oct record shows Preview was already `NEXT_PUBLIC_DATA_BACKEND=local` with a built and healthy Preview (`dpl_6Zo7x5BTfZ6Lm4bj6vRrkBtnEUtQ`, `a5975e9`). **OUTSTANDING:** `STAGING_SUPABASE_REFS` is still needed in operator shells for tooling until cutover, then removed everywhere. |
| 3.4 | Old Preview deployments that were built against the project are deleted (cutover step 3). Each keeps the Supabase URL, publishable key and server key it was built with. | **OUTSTANDING** | Technical lead lists Previews in Vercel, Deployments, filtered to Preview and dated since 20 Oct; records URLs; owner approves deleting all of them. Removing variables, rotating the key, or Deployment Protection is **not** a substitute (DEPLOYMENT.md step 3). |
| 3.5 | Secret key rotated if it was ever set for Preview or pasted anywhere (step 5). | **NOT VERIFIABLE FROM THE REPO** | Owner confirms history in Vercel and the Supabase dashboard. Set the new key only as a **Sensitive Production** variable. |
| 3.6 | Production environment variables set as per DEPLOYMENT.md "Environment variables": `NEXT_PUBLIC_DATA_BACKEND=supabase`, Supabase URL and publishable key, `NEXT_PUBLIC_CONFERENCE_ID` (real conference), `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`, `SUPABASE_SECRET_KEY` (Sensitive), `NEXT_PUBLIC_CONFERENCE_TIMEZONE=Asia/Qatar`. **No development value in Production.** | **OUTSTANDING** | Cutover step 6, owner approval. Steps 4 and 6 are one change: a project has one role at a time. |
| 3.7 | `vercel-ignore-build` freeze guard. | **VERIFIED** (code) | `scripts/vercel-ignore-build.sh` via `ignoreCommand` in `vercel.json`: with `VERCEL_ENV=production` and `CONFERENCE_FREEZE=1` it skips every build whose commit message lacks `[emergency]`; Previews are never affected. **OUTSTANDING:** it has not been exercised on Vercel; confirm with the freeze drill in 8.1. |
| 3.8 | `CONFERENCE_FREEZE` is **unset** now and set to `1` on Production at T-48h. | **NOT VERIFIABLE FROM THE REPO** | Technical lead confirms in Vercel, Production variables. |
| 3.9 | Vercel Production branch is `production` and it points where the owner expects. | **NOT VERIFIABLE FROM THE REPO** | DEPLOYMENT.md says the branch was changed on 7 Oct and was `c0a6a65` on 8 Oct, but also says the figures must be rechecked. Technical lead confirms the current branch tip and which `production` commit built the demo site (3.2 says it serves `main` `542e705`). Branch protection on `main` and `production` (CI / verify required, no force push) is also unconfirmed. |
| 3.10 | Deployment Protection: Previews protected; Production opens without a Vercel login for delegate phones (`/submit/*`, `/amend/*`). | **OUTSTANDING** | Conference-week configuration, not before. Owner approves. Verify from a phone on mobile data that is not signed in to Vercel (see 9.4). |
| 3.11 | `npm run verify:deployment -- <url> [sha]` passes on Production. | **OUTSTANDING** | Run by the technical lead after cutover. Caveat: the script still requests `/projector`, a feature that `START_HERE.md` says is retired; no `app/projector` route exists. Confirm that check passes or is understood **before** relying on the script. |
| 3.12 | Test and rehearsal scripts refuse Production. | **VERIFIED** (code) | `assertToolTarget` runs before any connection in `smoke-project`, `verify-submission-http`, `verify-stale-conflicts`, `remote-context` (used by `load-test`, `remote-integration`, `remote-workflow`, `prepare-*`) and `scripts/rehearsal/guard.ts` additionally refuses non-`*.vercel.app` non-local app URLs. |

## 4. Public submission HTTP verification

What is proven: the database path as `service_role` (`submission_link_info` and `submit_resolution` created `TST / 01`, replay returned `replayed`, 20 Oct) and, in PGlite and PostgreSQL 17 tests, the SQL boundary. What is **not** proven: the Next.js routes `/api/submissions`, `/api/amendments`, `/submit/<token>`, `/amend/<token>` against the current project with the server-only key. `docs/submission-http-results.json` is from **6 October on the deleted former development project** (`opmydpozhdgkpcnjwpqb`) and also predates Google-Docs-only submissions. It is **not** evidence for v1.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 4.1 | Run `scripts/verify-submission-http.mts` against the current project. | **OUTSTANDING** | **Who:** the owner provides `SUPABASE_SECRET_KEY` (the server-side service key) in an ignored `.env.local`; the technical lead or Claude runs it with owner approval. It was **not run** by the 21 Oct session because the key is not available to it. Never paste the key anywhere. |
| 4.2 | What the script needs and does (read from the source). | n/a | Needs `.env.local` with the Supabase URL, publishable key, `SUPABASE_SECRET_KEY`, `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado`; a running app at the **hard-coded** origin `http://localhost:3001` (for example a production build started with `next start -p 3001`, so it is a local server talking to the staging database, not the deployed URL); `.test-sessions/integration.json` with a `token` of a live submission link, and `supabase/fixture-ids.json` ids for the submitter. It then checks: page 200 and no key in the HTML, create 201, three concurrent retries replayed exactly once, duplicate source, legacy title accepted, changed payload 409 `idempotency_conflict`, invalid host and submitter and token refused, files refused with `docs_only`, and **no auth cookie** for delegates. |
| 4.3 | Caveats before running. | **OUTSTANDING** | (a) `fixture-ids.json` and `integration.json` come from the former development seed (`scripts/remote-integration.mts`); the current project's test conference has different ids, so a fixture and link for the current conference must be prepared first. (b) The script **overwrites** the tracked file `docs/submission-http-results.json` and writes `.test-sessions/http-browser.json`; run it from a scratch checkout or discard the overwritten file so it is not committed by accident. (c) A script change would be a code change and is out of scope during feature freeze; ask the owner if the hard-coded origin or fixture handling needs one. |
| 4.4 | Deployed-URL check of the QR pages. | **OUTSTANDING** | Once Production has the server key (cutover step 6): `npm run verify:deployment -- <production-url> <sha>` covers the unknown-link rejection only. A real resolution QR and amendment QR submission from a phone on mobile data (no Vercel login), then removal of the test records in the app, is the user-visible proof (RELEASE_CHECKLIST.md section 2; 9.4 below). |
| 4.5 | `/api/health` Storage check. | **OUTSTANDING** | Reports `not_configured`/absent without the server key; with it, the `resolutions` bucket must read `ok` (TROUBLESHOOTING.md "Reading System health"). |
| 4.6 | Rate limits, link replacement and amendment QR end to end. | **OUTSTANDING** | Functional checks in STAGING_REHEARSAL Phase A and E15; limits are 20 per link per 10 minutes for resolutions and 20 per link plus 5 per delegation for amendments (TROUBLESHOOTING.md). |

## 5. Access-code authentication and role permissions

Design: a code redeems into an ordinary `public.user_access` grant; role and committee come from the code, never from the device; RLS and the SQL RPCs are the authority, the UI only hides controls ([ACCESS_CODES_DESIGN.md](ACCESS_CODES_DESIGN.md), `AGENTS.md` protected area 4).

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 5.1 | Redemption, rotation and role boundaries on the hosted project. | **VERIFIED** | 21 Oct: `smoke:project` 15/15 (Executive and Chair redemption, idempotent replay, stale-edit conflict, role boundaries, submission link, Executive rotation). |
| 5.2 | Anonymous callers cannot read or write. | **VERIFIED** | 20 Oct HTTP checks: no session gets 401 on tables and RPCs; anonymous with no grant reads empty, insert 403, `redeem_access_code` with a wrong code returns `invalid` (SUPABASE_PROJECT_SETUP.md). |
| 5.3 | Role simulation on the hosted database: Executive, Approval, Logistics, Chair, Photos, Scoring, Voting. | **VERIFIED** | 21 Oct, rolled-back transactions with real `auth.users` rows (SUPABASE_PROJECT_SETUP.md): Approval sees no Draft and no delegates; Logistics sees the country and print copies; Chair cannot read `public.staff`; stale ballot revision refused with PT409. |
| 5.4 | Signed-in browser checks across roles. | **VERIFIED** | 21 Oct, Chromium, real access-code sign-in, no page errors (same section). |
| 5.5 | Automated coverage. | **VERIFIED** (CI) | `tests/access*.test.ts`, `access-codes-db.test.ts`, `access-codes-concurrency.test.ts`, `chair-redemption-db.test.ts`, `approval-decisions-db.test.ts`, `signout-recovery.test.ts`, `bootstrap-first-executive.test.ts`, run by `npm test` in CI. |
| 5.6 | First-Executive bootstrap on the project that will hold real data. | **OUTSTANDING** | [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md): tested on the former development project on 8 Oct only. The 21 Oct session bootstrapped a short-lived temporary Executive by hash on the staging project, not via the documented script. Repeat per cutover step 8 against the real conference id; no hand-inserted `user_access` rows. |
| 5.7 | Real codes: one per Chair committee, Approval, Admins, Executive, expiry at end of conference; test codes revoked. | **OUTSTANDING** | Executive, at T-48h (RELEASE_CHECKLIST.md section 3). Cutover step 2 also revokes all test codes. |
| 5.8 | Revocation is immediate and covers devices. | **VERIFIED** (design and tests); **OUTSTANDING** (live drill) | Revoke with "Also revoke devices using this code" (TROUBLESHOOTING.md, EMERGENCY_RECOVERY.md). Run STAGING_REHEARSAL E14 once on the live project: unsynced work is kept, sign-out refused until a recovery export is downloaded. |
| 5.9 | Archiving a committee revokes its Chair codes and grants. | **VERIFIED** (documented behaviour, TROUBLESHOOTING.md); not re-tested on the hosted project | There is no unarchive in the app. |
| 5.10 | Offline access lease: prepared devices work offline until the earlier of 48 hours after the last access check or grant expiry. | **VERIFIED** (documented, TROUBLESHOOTING.md; offline-lease logic unit-tested in `tests/access.test.ts`) | The 48-hour behaviour has not been observed on real devices; check in section 6. |
| 5.11 | Chair, Approval, printing and Executive permissions stay separate; hiding a control is not the permission. | **OUTSTANDING** (final pass) | Re-run the role matrix with real codes on Production after cutover (9.3). A Chair opening `/admin/health` must be sent to `/chair`. |

## 6. Real-device offline synchronization rehearsal

**No real-device offline rehearsal has been done on the current project.** Evidence that exists is simulated or historical: PGlite/fake-IndexedDB tests (`tests/offline.test.ts`, `sync-resilience.test.ts`, `service-worker.test.ts`, `pending.test.ts`), the 6 Oct remote workflow results, and the 16 Oct incident ([INCIDENT_2026-10-16_SYNC.md](INCIDENT_2026-10-16_SYNC.md), PHESMUN history). PR #22's sync acceptance items in [REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate) are the functional prerequisite.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 6.1 | Offline / reconnect steps 1 to 12 from STAGING_REHEARSAL.md "Offline / reconnect rehearsal (exact steps)": three attendance changes, two speakers, two participation points offline; reload offline; reconnect; second device matches exactly; no duplicates; drop the network **during** a sync; conflict on the same delegate. | **OUTSTANDING** | **Who:** Executive plus two Chairs and a note-taker, on real laptops, with the technical lead observing. **Where:** a `main` build pointed at the project while it still holds test data. Record device, browser, times, unsynced counts and screenshots in `docs/VERIFICATION.md`. |
| 6.2 | One `PT409` "needs review" followed by a device recovery export, *Keep conference value*, and the waiting changes syncing. | **OUTSTANDING** | STAGING_REHEARSAL E13 (central session archived while a Chair is offline). |
| 6.3 | Failure injections E1 to E15 on the live project (Wi-Fi off 10 minutes, Realtime blocked, Storage down, reload mid-debate, double click, two Chairs, lid closed with unsynced work, offline reopen within 48 hours, revoke with unsynced work, link rotation). | **OUTSTANDING** | Phase E; run with 25 to 50 background devices only once approved. |
| 6.4 | Offline shell: staff pages and health pages reload with the network cut. | **VERIFIED** (8 Oct, PRs #15, #16 on development) | Re-verify on the release build on real devices; Approval inbox and Print queue are not in the offline set by design (TROUBLESHOOTING.md "Offline shell"). |
| 6.5 | Replacement laptop and dead-laptop recovery per the runbook. | **OUTSTANDING** | Part of STAFF_REHEARSAL.md; export the recovery file before the old laptop reconnects. |
| 6.6 | Stale-conflict HTTP script. | **OUTSTANDING** | `scripts/verify-stale-conflicts.mts` needs an existing GA1-only Chair session file and the former seed fixture ids; adapt or skip as the owner decides. It was last recorded in `docs/stale-conflict-remote-results.json` against the deleted project. |

## 7. Conference-scale performance testing

Gate (root `AGENTS.md`): **110 devices across 19 real committees on Supabase Pro / Small**, owner profile of 57 Chairs, about 10 Approval devices, 5 to 6 printing devices, Executive and spares, 1 to 2 active Chairs per committee, plus separate delegate public-form traffic (STAGING_REHEARSAL C2). **Not run.**

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 7.1 | Precondition: Pro and Small confirmed (2.1, 2.2). | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in the dashboard. Do not run the load phases on Micro. |
| 7.2 | Harness supports the 19-committee / 110-device shape. | **OUTSTANDING** | The documented recipes and `rehearsal-run.mts` header still show 14 committees and 50/100 staff; STAGING_REHEARSAL.md says to verify and adapt before the readiness run. Claude confirms, with Codex review, what `rehearsal-fixture.mts`, `rehearsal-identities.mts` (capped at 25 anonymous sign-ins per run, one every 20 s, so run it the day before) and `rehearsal-run.mts` actually produce. If they cannot, that is a code change needing owner approval. |
| 7.3 | Fresh synthetic fixture per run; identities prepared; Preview URL is a `*.vercel.app` deployment or localhost (the guard refuses custom domains); `STAGING_SUPABASE_REFS` lists the project. | **OUTSTANDING** | Commands: `npm run rehearsal:identities`, `npx tsx scripts/rehearsal-fixture.mts ...`, then `npm run rehearsal:plan` (dry run, no network), `npm run rehearsal:run -- --app <preview-url> --identities ... --fixture ... ` (STAGING_REHEARSAL "Preparation" and C2). Needs the Vercel automation bypass secret for protected Previews. Owner approves running. |
| 7.4 | Readiness result is labelled `READINESS RUN` and passes: error rate under 1% (conflicts excluded); write p95 at most 1.5 s; read p95 at most 2.5 s; zero unexplained 5xx; zero `PGRST003`; zero `40001` loops and statement timeouts; zero lost or duplicate writes; zero rate-limit responses; delegate page p95 at most 2 s with no Auth activity from delegates; at most 18 real submissions per link. | **OUTSTANDING** | Attach the harness report and Supabase Logs / Observability and Vercel Logs screenshots for the run window (STAGING_REHEARSAL "Readiness criteria"). |
| 7.5 | Burst start of prepared devices reaches GREEN within 3 minutes; fresh code entry from one NAT at N = 10, 25, 40 (Phase D). | **OUTSTANDING** | Ideally on the venue Wi-Fi. Informs the Auth rate limit (2.8). |
| 7.6 | Existing evidence. | Not sufficient | `npm run test:load` (`docs/load-test-results.json`): 150 simulated clients on **one** identity, zero errors and no duplicates, but burst-read p95 13,093 ms, run on the deleted Nano development project. VERIFICATION.md states this does not justify conference-capacity acceptance. `npm run test:load` is also not the readiness harness. |
| 7.7 | Realtime loss never stops core operations. | **OUTSTANDING** | Phase E2 on the live project. |

## 8. Freeze, rollback and incident recovery

### 8a. Write freeze and change freeze

The repository has **no switch that freezes data writes**. `CONFERENCE_FREEZE` is a build-time flag that stops deployments, not edits. "Write freeze" in practice means the Executive controls who holds an active grant (access codes), or the conference being closed after the final export.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 8.1 | Change freeze from T-48h: `CONFERENCE_FREEZE=1` on Production; nobody advances `production`; no migrations; emergency fixes only, narrow, CI-green, previewed, with `[emergency]` in the commit that lands on `production`. | **OUTSTANDING** | Technical lead sets the flag; test it once by pushing a non-`[emergency]` commit and confirming the build is skipped (needs owner approval to touch Production). Procedure: DEPLOYMENT.md "Production freeze". |
| 8.2 | Data write freeze at end of conference (nothing can be edited once final exports are taken). | **OUTSTANDING** | Owner decides the mechanism. The only repository-supported control is revoking every access code with "Also revoke devices using this code" (TROUBLESHOOTING.md "After the conference"). A new read-only mode would be a code change and is out of scope. |

### 8b. Application rollback (Vercel)

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 8.3 | Procedure documented: Deployments, known-good deployment, Instant Rollback, Continue, Confirm; verify with `verify:deployment` or System health; Chairs refresh only at 0 unsynced. | **VERIFIED** (documented) | DEPLOYMENT.md "Rollback"; EMERGENCY_RECOVERY.md. |
| 8.4 | Rollback drilled on the real Production project, timed under 5 minutes. | **OUTSTANDING** | Technical lead, once, before the freeze, with a harmless change and owner approval (DEPLOYMENT.md "Rollback"; STAGING_REHEARSAL Phase F). Note the Hobby plan only returns to the immediately previous production deployment; DEPLOYMENT.md recommends Vercel Pro for the conference. **Vercel plan: NOT VERIFIABLE FROM THE REPO** (owner confirms). The Production demo build is currently the only production deployment, so there is nothing older to roll back to until a real release exists. |
| 8.5 | A rollback never reverts the database. Migrations are forward-only and additive, and each must be backward compatible with the deployed app. | **VERIFIED** (documented) | DEPLOYMENT.md. Consequence: with no new migrations during the freeze, an app rollback is always safe against the schema. |

### 8c. Database recovery

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 8.6 | Database recovery procedure (restore from backup or PITR, who decides, what is lost). | **OUTSTANDING** | **Nothing exists in the repository.** Owner and technical lead write it after 2.4 to 2.6 are answered and add it to EMERGENCY_RECOVERY.md. It must state: the decision-maker (Zuhayr Siddique is in charge during a live problem); how much data a restore discards (everything after the restore point, including any work devices have already synced); and that devices with unsynced work must export before and re-sync after (devices keep unsynced work in IndexedDB). |
| 8.7 | Offline devices are the safety net: Chairs keep working and sync after recovery; unsynced changes never leave the device on their own. | **VERIFIED** (documented, tested) | TROUBLESHOOTING.md "Unsynced changes and conflicts", EMERGENCY_RECOVERY.md. |
| 8.8 | Paper fallback (delegate list, attendance, speakers, QR sheets, known-good card) printed and walked through with every Chair. | **OUTSTANDING** | Executive, T-48h. |

### 8d. Access-code revocation and incidents

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 8.9 | Leaked code / stolen laptop: Executive, Access codes, scope, Revoke (tick "Also revoke devices using this code"), Rotate, re-prepare real devices (export unsynced work first). | **VERIFIED** (documented); **OUTSTANDING** (live drill, see 5.8) | CONFERENCE_RUNBOOK.md "Incidents"; EMERGENCY_RECOVERY.md. |
| 8.10 | Abused QR link: Executive, Resolution links or Amendment links, Replace, print the new sheet. | **VERIFIED** (documented); **OUTSTANDING** (drill, STAGING_REHEARSAL E15) | EMERGENCY_RECOVERY.md. |
| 8.11 | Incident contacts, lead administrator and deputy named and filled into the runbook. | **OUTSTANDING** | Owner (OPERATIONS.md, RELEASE_CHECKLIST.md section 3). |
| 8.12 | Status-page triage first (Vercel, Supabase, Google Workspace) before rolling back. | **VERIFIED** (documented) | DEPLOYMENT.md "Rollback", EMERGENCY_RECOVERY.md. |
| 8.13 | Uptime monitor on `/api/health` (optional, one request per minute). | **OUTSTANDING** (optional) | Owner decides. |

## 9. Final production smoke tests

Run in this order, **only after** sections 1 to 8 are closed and the owner has approved cutover. Production must be on the exact verified release commit.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 9.1 | `npm run verify:deployment -- <production-url> <release-sha>` passes (see the `/projector` caveat in 3.11). | **OUTSTANDING** | Technical lead. |
| 9.2 | System health on one device reads `<version> · <sha7> · production`, Supabase `ok`, Storage `ok`, GREEN; `/api/health` agrees; the project ref reported is `kllhswucdhqqywnzxado`. | **OUTSTANDING** | Executive device. Today Production reports a demo build with Supabase `not_configured`. |
| 9.3 | Role matrix with real codes: Executive, Approval, Admins, one Chair per committee type; Chair cannot reach `/admin/health`; a revoked code is refused. | **OUTSTANDING** | Executive and technical lead. |
| 9.4 | From a normal phone on mobile data, not signed in to Vercel: the conference URL shows the staff access-code screen; one resolution QR and one amendment QR open and submit; no Vercel login prompt; remove the test records in the app. | **OUTSTANDING** | Executive or Admins. Covers 3.10 and 4.4. |
| 9.5 | Lifecycle on Production with a labelled test resolution: Chair draft, Approval review and approve, Logistics print copies, debate, scoring, vote including clear majority, Executive overview. Then clean up. | **OUTSTANDING** | Mirrors the 21 Oct browser checks, repeated on the real target. |
| 9.6 | Offline smoke: one prepared Chair laptop works offline and syncs, 0 unsynced afterwards. | **OUTSTANDING** | Part of 6.1 on the production build. |
| 9.7 | Supabase Advisors repeated; nothing beyond the accepted list. | **OUTSTANDING** | Technical lead (1.6). |
| 9.8 | Test data and test codes removed (1.10, 5.7). | **OUTSTANDING** | Owner approves; read-only count. |

## 10. Release sign-off

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 10.1 | Release candidate commit chosen: green CI, verified `main` Preview. Candidate today: `542e705` code, docs at `b123ae6`. | **OUTSTANDING** | John Paul Ribeiru approves the exact SHA; no incidental code changes. |
| 10.2 | Sections 1 to 9 ticked; evidence links recorded next to each row. | **OUTSTANDING** | Technical lead. |
| 10.3 | Cutover steps 1 to 10 each approved and logged with who and when (DEPLOYMENT.md "Single-project cutover"). Target date from the repo: early November, Small compute before 5 November. | **OUTSTANDING** | Owner. |
| 10.4 | `production` branch advanced to the verified commit (fast-forward, never force-push); Vercel build READY. | **OUTSTANDING** | Technical lead, after 10.1 and 10.3. |
| 10.5 | [RELEASES.md](RELEASES.md) entry (version, commit, immutable `*.vercel.app` URL, deployment id, latest migration `20261021130000`, verifier, date). Currently reads "No production deployment yet". | **OUTSTANDING** | Technical lead. |
| 10.6 | Known-good tag (`known-good-<conference>-<yyyy-mm-dd>`) pushed. | **OUTSTANDING** | **Owner approval required; none exists and none may be created yet.** |
| 10.7 | Version stays `0.2.0` or is bumped. | **OUTSTANDING** | Owner decides; not before sign-off. |
| 10.8 | Known-good card printed and placed in the operations folder; System health "Running version" matches it. | **OUTSTANDING** | Technical lead and Executive. |
| 10.9 | T-48h freeze set (8.1); final real data, codes, QR sheets, devices, rollback target verified, paper fallback ready, contacts filled. | **OUTSTANDING** | RELEASE_CHECKLIST.md section 3. |
| 10.10 | Release approval recorded. | **OUTSTANDING** | John Paul Ribeiru. |
| 10.11 | After the conference: all devices 0 unsynced and 0 needs review; recovery files reconciled and deleted; all codes revoked with devices; `CONFERENCE_FREEZE` removed; final export kept; Supabase compute and plan reduced if not needed. | **OUTSTANDING** | Executive and technical lead (TROUBLESHOOTING.md "After the conference"). |

## Known documentation drift to fix when the owner allows

These do not change any status above but would mislead a reader:

* [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) still carries an 8 October state paragraph and the earlier "create a separate production project" flow. The single-project cutover in DEPLOYMENT.md supersedes it for project creation.
* [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) "Open items" lists work that has since moved on, and its top status says "development role" while the dashboard still names the project "DCMUN Staging".
* [DEPLOYMENT.md](DEPLOYMENT.md) "Environments" still says removal of the leftover Preview Supabase variables is a separate owner decision; the owner has now removed them (21 Oct).
* `scripts/verify-deployment.mts` checks `/projector`; the projector feature is retired.
* Several scripts (`verify-submission-http`, `verify-stale-conflicts`, `remote-integration`, `remote-workflow`, `load-test`) rely on the former development seed (`supabase/fixture-ids.json`, `.test-sessions/*`) and on a hard-coded `http://localhost:3001`. They have not been shown to work against the current project.
