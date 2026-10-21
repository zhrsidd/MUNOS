# v1 release checklist

Consolidated 21 October 2026 from the repository's own documents and scripts, revised after Codex review of PR #57. **Documentation only: this page authorises nothing.** It does not approve a migration, a tag, a version bump, a Production backend cutover, a load test or any change to Vercel or Supabase. Feature freeze applies.

It does not replace the existing gate documents; it indexes them against what is actually proven today:
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (gates, last written 8 October), [DEPLOYMENT.md](DEPLOYMENT.md) (single-project cutover, freeze, rollback), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (project record, migrations 1 to 26), [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) (load and failure plan), [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md), [RELEASES.md](RELEASES.md) and [ACCESS_CODES_DESIGN.md](ACCESS_CODES_DESIGN.md). Governance: root [AGENTS.md](../AGENTS.md). John Paul Ribeiru approves releases; Zuhayr Siddique (owner) approves product scope and Production configuration.

**Single-project lifecycle.** One Supabase project (`kllhswucdhqqywnzxado`) is the preproduction database now and the production database after promotion. The owner-approved 20 October single-project lifecycle handoff (referred to in review as `docs/INFRASTRUCTURE_LIFECYCLE.md`) governs it. That file was **not present** on `origin/main`, on this branch or on the other remote branches inspected when this page was revised, so it is not linked and nothing below is quoted from it. The isolation gates in Phase 1, section 4 are taken from the review findings and the code; the owner must confirm they match the handoff.

## How to read this page

Items are grouped into **phases that depend only on earlier phases**. Public real-data entry stays closed until Phase 1 is complete and Phase 2 has run.

| Phase | Name | State of the project |
| --- | --- | --- |
| 1 | Preproduction prerequisites and gates | Test data only. Synthetic tests, rehearsals and cloud-agent access are allowed (with approval). |
| 2 | Ordered cutover and deployment | The one-way step. Credentials are revoked, test data removed, Production pointed at the project. |
| 3 | Post-deployment verification and sign-off | Production, no real data entered yet by the public. Human-run, **non-destructive** checks only. |
| 4 | T-48h preparation | Real data, final codes, freeze. |
| 5 | Post-conference closure | Conference over. |

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Evidence exists. The date, commit or PR, and the place it is recorded are cited. |
| **OUTSTANDING** | Not done. The exact owner action or command is stated. |
| **NOT VERIFIABLE FROM THE REPO** | Lives in the Supabase or Vercel dashboard, or in someone's hands. The named person must confirm it; nothing in the repository can prove it. |

Baseline: `origin/main` = `b123ae6` (PR #56, docs only), whose code is the `542e705` release candidate. `package.json` version is `0.2.0`. No git tag exists.

## Release blockers (summary)

Each blocker lists only earlier phases or earlier items as its prerequisites. Nothing here depends on sign-off.

| # | Blocker | Where |
| --- | --- | --- |
| B1 | Supabase plan (Pro), compute (Small) and backups/PITR are unverified. The record says Micro compute and an unconfirmed plan. | 1.2 |
| B2 | **Single-project production isolation is not established:** no owner-controlled lifecycle register or server lock, no server-side denial of stale or misclassified test configuration, no production-only write enforcement (direct-RPC bypass denied), no revocation of cloud-agent and test credentials before promotion. | 1.4 |
| B3 | The public submission server routes have never been run against the current project with the server-only key. | 1.5 |
| B4 | No real-device offline rehearsal on the current project. | 1.7 |
| B5 | The 110-device / 19-committee readiness run (STAGING_REHEARSAL C2) has not been run. This is the capacity gate in `AGENTS.md`. | 1.8 |
| B6 | The synthetic lifecycle, QR, scoring, voting and offline write smoke has not been run on the final candidate, and must be finished and cleaned up **before** promotion. | 1.9 |
| B7 | No rollback drill, no named rollback build and no database recovery procedure. | 1.10 |
| B8 | The release candidate SHA is not approved by John Paul Ribeiru. | 1.11 |
| B9 | Production backend cutover has not happened (Production is a demo build) and needs the owner's approval of each step. | Phase 2 |
| B10 | No known-good release is declared (no tag, `RELEASES.md` entry or printed card). Possible only after Phase 3. | Phase 3 |

## Owner-approval gates

Nothing below happens without the named approval, recorded next to the step. Claude proposes; these are not delegated.

| Gate | Needs | Why / source |
| --- | --- | --- |
| Any new migration (27 or later) | Owner approval, independent (Codex) review, replay on the preproduction project, then apply once. **None is planned; feature freeze.** | `AGENTS.md` protected area 3; DEPLOYMENT.md "Normal workflow" |
| Any code, migration or policy change needed to close the isolation gates (1.4) | Explicit owner decision either to approve that change or to record an accepted scope change. A gate is never silently dropped. | Review of PR #57; `AGENTS.md` protected areas 1, 3, 4 |
| Version bump from `0.2.0` | Owner approval. Not part of this task. | `package.json` |
| Git tag (for example `known-good-<conference>-<yyyy-mm-dd>`) | John Paul Ribeiru approves the release, owner approves the tag. **No tag may be created before Phase 3 sign-off.** | DEPLOYMENT.md "Known-good conference release" |
| Production backend cutover (Phase 2) | Explicit approval **per step**, who and when recorded. | DEPLOYMENT.md "Single-project cutover" |
| Any Vercel Production configuration change (env vars, Deployment Protection, `production` branch) | Owner approval. | `AGENTS.md` protected area 1 |
| Supabase upgrade to Pro / Small compute / PITR add-on | Owner approval of organisation and cost before the resource change. | RELEASE_CHECKLIST.md header; `AGENTS.md` |
| Load test and the 110-device rehearsal | Owner approval to run; runs only against the project while it holds test data and is listed in `STAGING_SUPABASE_REFS`. | `AGENTS.md`; STAGING_REHEARSAL.md |
| Running anything with the server-only `SUPABASE_SECRET_KEY` | Owner supplies the key in an ignored local environment. It is never pasted into chat, a doc or a ticket. | `AGENTS.md` protected area 2 |
| Release sign-off | John Paul Ribeiru, recorded in RELEASES.md. | `AGENTS.md`; DEPLOYMENT.md "Releasing to Production" |

---

# Phase 1. Preproduction prerequisites and gates

Everything in this phase happens while the project holds **test data only** and the public cannot enter real data. After promotion, cloud agents lose hosted database access under the agreed lifecycle, so every synthetic or destructive test belongs here. Phase 2 may start only when every item is VERIFIED, or carries a recorded owner decision.

## 1.1 Database and migration verification

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.1.1 | Repository holds 26 committed migrations, latest `20261021130000_identity_projection.sql`. | **VERIFIED** | `ls supabase/migrations` on `b123ae6` returns 26 files. |
| 1.1.2 | Project `kllhswucdhqqywnzxado` has exactly those 26 migrations; ledger versions and names equal the filenames. | **VERIFIED** | 21 Oct 2026, [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) "Migrations 22 to 26" (PR #56 / `e3e33f8`, `bc6dc9f`). Migrations 1 to 21 applied 20 Oct with the CLI after PR #22 (`852642c`). |
| 1.1.3 | Applied SQL equals the repository files. | **VERIFIED** | 22 to 26: stored statements compared with the files by trimmed MD5, all identical (21 Oct). 1 to 21: files compared byte for byte before apply; schema fingerprint matched a local PostgreSQL 17 rebuild (20 Oct). That fingerprint predates 22 to 26 and was not repeated. |
| 1.1.4 | Dry run of 22 to 26 on the live database before applying. | **VERIFIED** | 21 Oct: one transaction, aborted on purpose; ledger still 21 rows afterwards. |
| 1.1.5 | Grants and RLS after the new migrations. | **VERIFIED** | 21 Oct "Grants (live)"; baseline 20 Oct: RLS on all 41 tables, `anon` has no table or function privileges. |
| 1.1.6 | Security advisors show nothing new. | **VERIFIED** | 21 Oct: only the accepted findings in RELEASE_CHECKLIST.md section 2. **Repeat if any schema changes**, and once more in Phase 2 before promotion. |
| 1.1.7 | App-level smoke test on the migrated project. | **VERIFIED** | 21 Oct: `npm run smoke:project` 15/15 and signed-in Chromium checks of scoring, photos, voting, Approval and Logistics on an isolated temporary conference, against `main` at `542e705`. |
| 1.1.8 | CI green on the release candidate. | **VERIFIED** for `542e705`; **OUTSTANDING** for the final SHA | `ci.yml` runs typecheck, lint, tests against PostgreSQL 17 and build. Re-confirm on the exact commit to be released. |
| 1.1.9 | Migration list frozen at 26. | **OUTSTANDING** | Owner decision. Any later migration goes through the approval gate above. |
| 1.1.10 | Final `npm run smoke:project` regression on the release SHA. | **OUTSTANDING** | Needs `SMOKE_EXECUTIVE_CODE` for a TEST conference and `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado`. Must run **before** Phase 2, because cutover removes the ref and the tool then refuses the project. |
| 1.1.11 | Dashboard project renamed from "DCMUN Staging" to a production-safe name. | **OUTSTANDING** | Owner, in the dashboard, before cutover (SUPABASE_PROJECT_SETUP.md "Naming"). |
| 1.1.12 | Stale "Open items" in SUPABASE_PROJECT_SETUP.md (PR #25 review, `rls_auto_enable()`). | **NOT VERIFIABLE FROM THE REPO** | Owner and Codex say which still apply. |

## 1.2 Supabase Pro compute and backup / PITR verification

The Supabase connector **cannot** read the plan, compute size, backup settings or PITR state (SUPABASE_PROJECT_SETUP.md says so). Everything here needs the **owner or technical lead in the Supabase dashboard**, with a dated screenshot or note kept in the release folder.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.2.1 | Organisation is on **Pro**. | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Organisation, Billing. Last recorded as unconfirmed (20 Oct). Owner approves any upgrade and cost first. |
| 1.2.2 | Compute is **Small** (last recorded Micro). | **NOT VERIFIABLE FROM THE REPO** | Dashboard, Project Settings, Compute. Required before the capacity rehearsal and before 5 November. |
| 1.2.3 | Region ap-south-1, Postgres 17.11, `ACTIVE_HEALTHY`. | **VERIFIED** (20 Oct) | SUPABASE_PROJECT_SETUP.md, read through the connector. Vercel functions run in `bom1` (`vercel.json`). |
| 1.2.4 | Scheduled daily backups exist and the latest succeeded. | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Database, Backups (RELEASE_CHECKLIST.md section 2; TROUBLESHOOTING.md). |
| 1.2.5 | PITR decision. | **NOT VERIFIABLE FROM THE REPO** | No repository document mentions point-in-time recovery. Owner decides, enables it if wanted, and records retention and cost **before real data is entered**, because recovery only reaches back to when it was enabled. |
| 1.2.6 | A restore has been read through, ideally rehearsed, on a non-live target. | **OUTSTANDING** | Owner or technical lead records expected time and what a restore discards (see 1.10.6). |
| 1.2.7 | Fallback export plan. | **OUTSTANDING** | TROUBLESHOOTING.md says to export daily. Owner names who, how, and where the file lives. |
| 1.2.8 | Auth rate limit for anonymous sign-ins per IP set from a measured value. | **OUTSTANDING** | Default 30 per hour; the venue shares one NAT. Set it after the Phase D measurement in 1.8.5. |
| 1.2.9 | Anonymous sign-ins enabled. | **VERIFIED** (20 Oct) | Works over HTTP (SUPABASE_PROJECT_SETUP.md "Behaviour"). |

## 1.3 Environment and project-target guards (configuration)

Observed 21 Oct 2026, **not yet recorded in the repository**: the Production site is a **demo-mode build serving `main` `542e705`** with Supabase `not_configured`; the owner has removed the Preview Supabase variables. Record both in [RELEASES.md](RELEASES.md) and DEPLOYMENT.md (its "Environments" paragraph still calls that removal a separate owner decision).

These guards are **evidence, not isolation**. They do not close the gates in 1.4.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.3.1 | Guard code: PHESMUN `gglltljhdpkfjnyjmnif` refused everywhere; Production must equal `EXPECTED_SUPABASE_REF` and the build fails if it is unset; non-Production builds and `scripts/*.mts` need the ref in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS`; one role per project; no override. | **VERIFIED** (code and CI) | `lib/platform/target-guard.ts`, `next.config.ts`, `tests/target-guard.test.ts`; DEPLOYMENT.md "Target guard". **Limit:** the guard reads only process environment (see 1.4.2). |
| 1.3.2 | Production serves `main` `542e705` as a demo build, Supabase `not_configured`. | **VERIFIED** (21 Oct, observed via Vercel and `/api/health`) | Not yet in the repo; record in RELEASES.md. |
| 1.3.3 | Preview Supabase variables removed. | **VERIFIED** (owner, 21 Oct) | Earlier, 20 Oct: Preview set to `NEXT_PUBLIC_DATA_BACKEND=local`, Preview `dpl_6Zo7x5BTfZ6Lm4bj6vRrkBtnEUtQ` (`a5975e9`) healthy with Supabase `not_configured`. This does **not** remove access from already-built deployments (1.4.4 and Phase 2 step 3). |
| 1.3.4 | `scripts/vercel-ignore-build.sh` freeze guard. | **VERIFIED** (code) | `ignoreCommand` in `vercel.json`: with `VERCEL_ENV=production` and `CONFERENCE_FREEZE=1`, skips builds whose commit message lacks `[emergency]`. Not yet exercised on Vercel (see 4.1). |
| 1.3.5 | Operator scripts refuse Production. | **VERIFIED** (code) | `assertToolTarget` runs before any connection in `smoke-project`, `verify-submission-http`, `verify-stale-conflicts` and `remote-context` (used by `load-test`, `remote-integration`, `remote-workflow`); `scripts/rehearsal/guard.ts` also refuses custom domains. |
| 1.3.6 | `CONFERENCE_FREEZE` is unset now; Production branch is `production`; branch protection on `main` and `production`; Vercel plan. | **NOT VERIFIABLE FROM THE REPO** | Technical lead confirms in Vercel and GitHub. DEPLOYMENT.md gives `c0a6a65` for `production` on 8 Oct and says to recheck. |
| 1.3.7 | Deployment Protection plan: Previews protected, Production public for delegate phones. | **OUTSTANDING** | Owner approves; applied in Phase 2 and checked in Phase 3. |

## 1.4 Single-project production isolation (blocking)

Current code and configuration are **not sufficient**. `checkToolTarget` in `lib/platform/target-guard.ts` trusts only process configuration: a shell or build whose old environment lists the project as `STAGING_SUPABASE_REFS` and omits `EXPECTED_SUPABASE_REF` is accepted. `SupabaseTransport` (`lib/supabase/repository.ts`) still calls the mutation RPCs (for example `apply_conference_mutation`) directly with the publishable key and a grant. Neither the existing guard tests in CI nor the removal of Preview variables changes that. **All four gates must be closed, or carry an explicit owner decision recording an accepted scope change, before any real data is entered.** Changing code, a migration or Supabase policy to close them is an owner-approval gate and needs independent review.

| # | Gate | Status | Evidence or owner decision required |
| --- | --- | --- | --- |
| 1.4.1 | **Owner-controlled lifecycle register / server lock.** A record that is authoritative on the server side, controlled by the owner, saying which role the project currently has (preproduction or production) and who changed it. | **OUTSTANDING** | No such register exists in the repository or database. Owner decides the mechanism (the handoff defines it) and who may flip it. Evidence needed: the register, its current value, an audit of its last change. |
| 1.4.2 | **Denial of stale or misclassified test configuration.** After promotion, an old `.env`, shell, Preview or script that still lists the project as staging/development must be refused by something other than its own environment. | **OUTSTANDING** | Today `checkToolTarget` accepts such a configuration. Needs a server-side check against 1.4.1 or equivalent. Evidence: a negative test run against the hosted project showing a stale-staging configuration is refused, recorded by date and operator. |
| 1.4.3 | **Production-only write enforcement; direct-RPC bypass denied.** Once the project is production, writes are accepted only through the production deployment path, and a client calling `apply_conference_mutation` or other write RPCs directly with a valid grant but outside that path is refused. | **OUTSTANDING** | Not true today: any holder of a grant can call the RPCs directly, and Preview or local builds pointed at the project reach it the same way. Needs a reviewed design (server-side). Evidence: a direct-RPC attempt from a non-production origin or credential is denied while the production app writes normally, with `npm test` and the PostgreSQL 17 DB tests extended accordingly. |
| 1.4.4 | **Revocation of non-production access before promotion:** cloud-agent connectors (Supabase and Vercel MCP) and personal access tokens, database and API credentials (including the secret key and the database password), all test access codes and `user_access` grants, anonymous test users and their **refresh sessions**, and remaining JWT access until expiry. | **OUTSTANDING** | Owner revokes and records each item with date. Old Preview deployments keep the credentials they were built with and are deleted (Phase 2 step 3). Whether existing JWTs can be cut off before their expiry depends on Supabase settings: owner records what was done and the latest time any old token can still work. Cloud agents must have no hosted database access afterwards. |
| 1.4.5 | Environment guards and Preview-variable removal are recorded as evidence only. | **VERIFIED** (that they exist) | See 1.3. They are not accepted as closing 1.4.1 to 1.4.4. |

## 1.5 Public submission HTTP verification

Proven: the database path as `service_role` (`submission_link_info`, `submit_resolution` created `TST / 01`, replay returned `replayed`, 20 Oct) and the SQL boundary in PGlite and PostgreSQL 17 tests. **Not** proven: the Next.js routes `/api/submissions`, `/api/amendments`, `/submit/<token>`, `/amend/<token>` against the current project with the server-only key. `docs/submission-http-results.json` is from **6 October on the deleted development project** (`opmydpozhdgkpcnjwpqb`) and predates Google-Docs-only submissions; it is not v1 evidence.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.5.1 | Run `scripts/verify-submission-http.mts` against the current project. | **OUTSTANDING** | **Who:** the owner provides `SUPABASE_SECRET_KEY` in an ignored `.env.local`; the technical lead or Claude runs it with owner approval. It was **not run** on 21 Oct because the key is not available to the agent. Never paste the key anywhere. |
| 1.5.2 | What the script needs and checks (from its source). | n/a | `.env.local` with Supabase URL, publishable key, `SUPABASE_SECRET_KEY`, `STAGING_SUPABASE_REFS`; an app running at the **hard-coded** `http://localhost:3001` (for example `next start -p 3001`: a local server against the staging database, not the deployed URL); `.test-sessions/integration.json` with a live link `token`; `supabase/fixture-ids.json` submitter id. Checks: page 200 and no key in the HTML, create 201, three concurrent retries replayed once, duplicate source, legacy title accepted, changed payload 409 `idempotency_conflict`, bad host/submitter/token refused, files refused (`docs_only`), no auth cookie for delegates. |
| 1.5.3 | Caveats before running. | **OUTSTANDING** | (a) `fixture-ids.json` and `integration.json` come from the former development seed (`scripts/remote-integration.mts`); the current test conference has other ids, so a fixture and link for it must be prepared. (b) The script **overwrites** the tracked `docs/submission-http-results.json` and writes `.test-sessions/http-browser.json`: run from a scratch checkout or discard the change. (c) Changing the script is a code change: ask the owner. |
| 1.5.4 | Amendment QR end to end, rate limits (20 per link per 10 minutes; amendments also 5 per delegation), link replacement. | **OUTSTANDING** | STAGING_REHEARSAL Phase A and E15, on the preproduction deployment with the server key. |
| 1.5.5 | Storage check in `/api/health` reads `ok` with the server key. | **OUTSTANDING** | TROUBLESHOOTING.md "Reading System health". |

## 1.6 Access-code authentication and role permissions

Design: a code redeems into an ordinary `public.user_access` grant; role and committee come from the code; RLS and the SQL RPCs are the authority ([ACCESS_CODES_DESIGN.md](ACCESS_CODES_DESIGN.md), `AGENTS.md` protected area 4).

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.6.1 | Redemption, rotation and role boundaries on the hosted project. | **VERIFIED** | 21 Oct: `smoke:project` 15/15. |
| 1.6.2 | Anonymous callers cannot read or write. | **VERIFIED** | 20 Oct HTTP checks (no session 401; no-grant anonymous reads empty, insert 403, wrong code `invalid`). |
| 1.6.3 | Role simulation on the hosted database: Executive, Approval, Logistics, Chair, Photos, Scoring, Voting. | **VERIFIED** | 21 Oct, rolled-back transactions; Approval sees no Draft and no delegates; Chair cannot read `public.staff`; stale ballot revision refused with PT409. |
| 1.6.4 | Signed-in browser checks across roles, no page errors. | **VERIFIED** | 21 Oct, Chromium, real access-code sign-in. |
| 1.6.5 | Automated coverage in CI. | **VERIFIED** | `tests/access*.test.ts`, `access-codes-db.test.ts`, `access-codes-concurrency.test.ts`, `chair-redemption-db.test.ts`, `approval-decisions-db.test.ts`, `signout-recovery.test.ts`, `bootstrap-first-executive.test.ts`. |
| 1.6.6 | Archiving a committee revokes its Chair codes and grants; no unarchive. | **VERIFIED** (documented, TROUBLESHOOTING.md); not re-tested on the hosted project | |
| 1.6.7 | Offline access lease: earlier of 48 hours after last access check or grant expiry. | **VERIFIED** (documented; lease logic unit-tested in `tests/access.test.ts`) | Not yet observed on real devices; see 1.7. |
| 1.6.8 | Revocation drill with "Also revoke devices using this code": unsynced work kept, sign-out refused until a recovery export. | **OUTSTANDING** | STAGING_REHEARSAL E14, on the preproduction project, test conference. |
| 1.6.9 | Full role matrix with test codes on the final candidate: Chair cannot reach `/admin/health`; revoked code refused. | **OUTSTANDING** | Executive and technical lead, preproduction. |
| 1.6.10 | First-Executive bootstrap procedure. | **OUTSTANDING** | [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) was tested 8 Oct on the former development project. The 21 Oct session used a short-lived hash-bootstrapped Executive, not the documented script. Repeat the documented script on a labelled TEST conference now; the production run is Phase 2 step 9. |

## 1.7 Real-device offline synchronization rehearsal

**No real-device offline rehearsal has been done on the current project.** Existing evidence is simulated or historical: PGlite and fake-IndexedDB tests (`tests/offline.test.ts`, `sync-resilience.test.ts`, `service-worker.test.ts`, `pending.test.ts`), the 6 Oct remote workflow results, the 16 Oct incident ([INCIDENT_2026-10-16_SYNC.md](INCIDENT_2026-10-16_SYNC.md), PHESMUN history). PR #22's sync items in [REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate) are the functional prerequisite.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.7.1 | STAGING_REHEARSAL "Offline / reconnect rehearsal" steps 1 to 12: three attendance changes, two speakers, two participation points offline; reload offline; reconnect; second device matches exactly; network drop **during** a sync; conflict on the same delegate. | **OUTSTANDING** | Executive plus two Chairs and a note-taker on real laptops, technical lead observing, on a `main` build against the test conference. Record in `docs/VERIFICATION.md`. |
| 1.7.2 | One `PT409` "needs review" with recovery export and *Keep conference value*. | **OUTSTANDING** | E13. |
| 1.7.3 | Failure injections E1 to E15. | **OUTSTANDING** | Phase E; with background devices only once approved. |
| 1.7.4 | Offline write smoke on the **final candidate build** (write offline, reconnect, 0 unsynced, no duplicates). | **OUTSTANDING** | Required here, in preproduction, because it writes records. |
| 1.7.5 | Offline shell reloads staff and health pages with the network cut. | **VERIFIED** (8 Oct, PRs #15, #16 on development); **OUTSTANDING** on the final build | Approval inbox and Print queue are not in the offline set by design. |
| 1.7.6 | Replacement and dead-laptop recovery per the runbook. | **OUTSTANDING** | STAFF_REHEARSAL.md. |
| 1.7.7 | `scripts/verify-stale-conflicts.mts`. | **OUTSTANDING** | Needs an existing GA1-only Chair session file and the former seed ids; last recorded in `docs/stale-conflict-remote-results.json` against the deleted project. Adapt or skip by owner decision. |

## 1.8 Conference-scale performance testing

Gate (`AGENTS.md`): **110 devices across 19 real committees on Pro / Small**, profile of 57 Chairs, about 10 Approval, 5 to 6 printing, Executive and spares, 1 to 2 active Chairs per committee, plus separate delegate public-form traffic (STAGING_REHEARSAL C2). **Not run.**

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.8.1 | Pro and Small confirmed (1.2.1, 1.2.2). | **NOT VERIFIABLE FROM THE REPO** | Do not run on Micro. |
| 1.8.2 | Harness supports the 19-committee / 110-device shape. | **OUTSTANDING** | Docs and the `rehearsal-run.mts` header still show 14 committees and 50/100 staff. Claude checks `rehearsal-fixture.mts`, `rehearsal-identities.mts` (25 anonymous sign-ins per run, one per 20 s: run the day before) and `rehearsal-run.mts`, with Codex review. A change is a code change needing owner approval. |
| 1.8.3 | Preparation and run. | **OUTSTANDING** | `npm run rehearsal:identities`, `npx tsx scripts/rehearsal-fixture.mts ...`, `npm run rehearsal:plan` (dry run), `npm run rehearsal:run -- --app <preview-url> --identities ... --fixture ...`. The app URL must be a `*.vercel.app` deployment or localhost; protected Previews need the automation bypass secret. Owner approves running. Fresh synthetic fixture per run. |
| 1.8.4 | `READINESS RUN` passes: error rate under 1% (conflicts excluded); write p95 at most 1.5 s; read p95 at most 2.5 s; zero unexplained 5xx, `PGRST003`, `40001` loops, statement timeouts, lost or duplicate writes, rate-limit responses; delegate page p95 at most 2 s with no Auth activity; at most 18 real submissions per link. | **OUTSTANDING** | Attach harness report plus Supabase Logs/Observability and Vercel Logs for the run window. |
| 1.8.5 | Burst start of prepared devices GREEN within 3 minutes; fresh code entry from one NAT at N = 10, 25, 40 (Phase D). | **OUTSTANDING** | Ideally on venue Wi-Fi; feeds 1.2.8. |
| 1.8.6 | Realtime loss never stops core operations (E2). | **OUTSTANDING** | |
| 1.8.7 | Existing evidence. | Not sufficient | `npm run test:load` (`docs/load-test-results.json`): 150 clients on **one** identity, zero errors, but burst-read p95 13,093 ms, on the deleted Nano project. VERIFICATION.md says it does not justify capacity acceptance. |

## 1.9 Synthetic lifecycle tests and cleanup (before promotion)

Everything that creates, changes or deletes records belongs here. After promotion the only checks are the human-run non-destructive ones in Phase 3.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.9.1 | Synthetic QR checks from a phone on mobile data (not signed in to Vercel) on a **preproduction deployment with the server key**: resolution QR and amendment QR open and submit; then remove the records in the app. | **OUTSTANDING** | Executive or Admins. Needs 1.3.7 applied to that deployment for the "no Vercel login" part. |
| 1.9.2 | Labelled-resolution lifecycle: Chair draft, Approval review and approve, Logistics print copies, debate, scoring, vote including clear majority, Executive overview. | **OUTSTANDING** | Repeat of the 21 Oct checks on the final candidate (21 Oct run is **VERIFIED** for `542e705` only). |
| 1.9.3 | Scoring and voting edge cases: Main Submitter points, stale ballot revision, Divide the House. | **OUTSTANDING** (final SHA) | Same. |
| 1.9.4 | Related offline write smoke. | **OUTSTANDING** | 1.7.4. |
| 1.9.5 | Cleanup: delete the `DCMUN Development Test` conferences (original `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb` and the 21 Oct temporary one), TEST committee `TST`, records, test auth users, grants and codes; confirm with a read-only count that nothing test-labelled remains. | **OUTSTANDING** | Owner approves. This is cutover step 2 (DEPLOYMENT.md); do it last in Phase 1, after all synthetic tests, and re-run advisors (1.1.6). |

## 1.10 Freeze, rollback and incident recovery (procedures prepared and rehearsed)

The repository has **no switch that freezes data writes**. `CONFERENCE_FREEZE` is a build-time flag that stops deployments, not edits.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.10.1 | Change-freeze procedure: `CONFERENCE_FREEZE=1`; nobody advances `production`; no migrations; emergency fixes only, narrow, CI-green, previewed, with `[emergency]` in the commit that lands on `production`. | **VERIFIED** (documented) | DEPLOYMENT.md "Production freeze". It is applied in Phase 4. |
| 1.10.2 | Rollback procedure documented. | **VERIFIED** (documented) | DEPLOYMENT.md "Rollback"; EMERGENCY_RECOVERY.md. |
| 1.10.3 | Rollback drilled and timed under 5 minutes. | **OUTSTANDING** | Before promotion, on a project where it is safe: STAGING_REHEARSAL Phase F (optional second Vercel project, because Instant Rollback exists only for a project's production deployments). A repeat on the real Production project after cutover is a human-run check in Phase 3, only if the owner approves. Vercel plan (Hobby returns only to the previous production deployment; DEPLOYMENT.md recommends Pro): **NOT VERIFIABLE FROM THE REPO**. |
| 1.10.4 | A **named rollback build** exists and is verified (see 1.10.5). Today there is none: the only production deployment is the demo build. | **OUTSTANDING** | Technical lead names the Vercel deployment id and commit. |
| 1.10.5 | App rollback is **not automatically safe** because no migrations are added during the freeze. The named rollback build must be checked against (a) the applied migration ledger (compatible with the schema the database actually has), (b) the **current production configuration and rotated credentials** (a rollback restores that deployment's own build-time environment, so a deployment built with development configuration or old test credentials must never be revived), and (c) the durable-client contract (outbox, mutation receipts, optimistic fingerprints, PT409/40001 handling: an older client must still replay saved actions exactly once against the current database). Record the check next to the card. A Vercel rollback never reverts the database (DEPLOYMENT.md). | **OUTSTANDING** | Technical lead with an independent reviewer. Prefer a rollback build created after the credential rotation in Phase 2, not before it. |
| 1.10.6 | Database recovery procedure (restore from backup or PITR, who decides, what is lost). | **OUTSTANDING** | **Nothing exists in the repository.** Write it after 1.2.4 to 1.2.6 and add it to EMERGENCY_RECOVERY.md. It must name the decision-maker (Zuhayr Siddique during a live problem), state that a restore discards everything after the restore point including work already synced, and that devices with unsynced work export first and re-sync after. |
| 1.10.7 | Devices are the safety net: Chairs keep working offline; unsynced changes never leave a device by themselves. | **VERIFIED** (documented, tested) | TROUBLESHOOTING.md, EMERGENCY_RECOVERY.md. |
| 1.10.8 | Access-code revocation, leaked code, stolen laptop, abused QR link. | **VERIFIED** (documented); drills **OUTSTANDING** | CONFERENCE_RUNBOOK.md "Incidents"; EMERGENCY_RECOVERY.md; drills 1.6.8 and E15. |
| 1.10.9 | Write-freeze mechanism for the end of the conference. | **OUTSTANDING** | Owner decides. The only repository-supported control is revoking every access code with devices (see Phase 5). A read-only mode would be a code change and is out of scope. |
| 1.10.10 | Status-page triage first; incident contacts and lead administrator and deputy filled into the runbook. | **VERIFIED** (triage documented); contacts **OUTSTANDING** | Owner. |

## 1.11 Release candidate approval

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.11.1 | Candidate commit chosen: green CI and verified `main` Preview. Code candidate today: `542e705`; docs at `b123ae6`. | **OUTSTANDING** | John Paul Ribeiru approves the **exact SHA**; no incidental code changes. |
| 1.11.2 | Every Phase 1 item is VERIFIED or carries a recorded owner decision. | **OUTSTANDING** | Technical lead compiles evidence links next to each row. |

---

# Phase 2. Ordered cutover and deployment

Runs only after 1.11.2. Each step needs explicit owner approval, with who and when recorded. Source: [DEPLOYMENT.md](DEPLOYMENT.md) "Single-project cutover". Target window from the repository: early November, Small compute before 5 November. All steps are **OUTSTANDING**.

| Step | Action | Notes |
| --- | --- | --- |
| 2.1 | Freeze the release: record the release `main` SHA and the rollback target (1.10.4); CI green; ledger matches the repository. | |
| 2.2 | Confirm test data is gone (1.9.5) and advisors are clean (1.1.6). | Read-only counts. |
| 2.3 | Delete every old Preview/Development deployment built while Preview pointed at the project; record their URLs for 3.3. | Required: each keeps the URL, publishable key and server key it was built with. Removing variables, aliases, Deployment Protection or rotating the secret key is **not** a substitute. |
| 2.4 | Cut Preview off from the project (done as variables, 1.3.3) and remove the ref from `STAGING_SUPABASE_REFS` in **every** environment including operator shells. | Scripts then refuse the project, by design. |
| 2.5 | Revoke non-production access (1.4.4): cloud-agent connectors and tokens, database password and API/secret keys rotated, test codes, grants and refresh sessions. | Set the new secret key only as a **Sensitive Production** variable. |
| 2.6 | Close or record the owner decision for each isolation gate (1.4.1 to 1.4.3) and flip the lifecycle register to production, if that is the agreed mechanism. | Owner. |
| 2.7 | Point Production at the project (owner approval): `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`, Supabase URL and publishable key, `NEXT_PUBLIC_DATA_BACKEND=supabase`, real `NEXT_PUBLIC_CONFERENCE_ID`, `SUPABASE_SECRET_KEY` (Sensitive), `NEXT_PUBLIC_CONFERENCE_TIMEZONE=Asia/Qatar`. Apply Deployment Protection (1.3.7). | No development value in Production. Steps 2.4 and 2.7 are one change: a project has one role at a time. |
| 2.8 | Confirm plan, Small compute and backups/PITR in the dashboard (1.2) and that the 110-device rehearsal passed (1.8.4). | |
| 2.9 | Create the real conference and bootstrap the first Executive with [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) (a human, in person). | No hand-inserted `user_access` rows. |
| 2.10 | Advance `production` to the approved SHA (fast-forward, never force-push; a merge commit has a different SHA and must be verified instead) and wait for READY. | |

---

# Phase 3. Post-deployment verification and sign-off

Human-run, **non-destructive** checks only: target, SHA, health and access. No test submissions, no labelled resolutions, no scoring, no voting and no cleanup, because test data has been removed and cloud agents no longer have hosted database access. Anything that writes belongs in Phase 1.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 3.1 | `npm run verify:deployment -- <production-url> <release-sha>` passes (read-only requests). | **OUTSTANDING** | Technical lead. Caveat: the script still requests `/projector`, a retired feature with no `app/projector` route; confirm that check passes or is understood first. |
| 3.2 | System health on one device reads `<version> · <sha7> · production`, Supabase `ok`, Storage `ok`, GREEN; `/api/health` agrees and reports project `kllhswucdhqqywnzxado`. | **OUTSTANDING** | Executive device. Today Production reports a demo build with Supabase `not_configured`. |
| 3.3 | Isolation: an old Preview URL recorded in 2.3 is gone; a newly built Preview does not reach the project (refused build, "Wrong Supabase project", or local demo). | **OUTSTANDING** | DEPLOYMENT.md cutover step 9. |
| 3.4 | Stale-configuration check: a shell with the old staging configuration is refused (1.4.2), and a direct RPC attempt from a non-production credential is refused (1.4.3). | **OUTSTANDING** | Only if the owner has chosen a non-destructive form of this check; otherwise it is proven in Phase 1. |
| 3.5 | Access with the real Executive code and read-only navigation of each role's pages; a Chair is sent away from `/admin/health`; an invalid code is refused. | **OUTSTANDING** | Executive and technical lead. Real codes are issued after sign-in (Phase 4); use the bootstrap Executive first. |
| 3.6 | Public pages from a normal phone on mobile data, not signed in to Vercel: the conference URL shows the staff access-code screen; the resolution and amendment QR pages **open** (view only, nothing submitted). | **OUTSTANDING** | Executive or Admins. |
| 3.7 | Supabase Advisors repeated; nothing beyond the accepted list. | **OUTSTANDING** | Technical lead. |
| 3.8 | Named rollback build (1.10.4, 1.10.5) still present and matches the card. | **OUTSTANDING** | Technical lead. |
| 3.9 | [RELEASES.md](RELEASES.md) entry: version, commit, immutable `*.vercel.app` URL, deployment id, latest migration `20261021130000`, verifier, date. Currently "No production deployment yet". | **OUTSTANDING** | Technical lead. |
| 3.10 | Release sign-off recorded. | **OUTSTANDING** | John Paul Ribeiru, after 3.1 to 3.9. |
| 3.11 | Known-good tag `known-good-<conference>-<yyyy-mm-dd>` pushed; known-good card printed; version stays `0.2.0` or is bumped. | **OUTSTANDING** | **Owner approval required; no tag exists and none may be created, and no version bump, before 3.10.** |

---

# Phase 4. T-48 hours preparation

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 4.1 | Set `CONFERENCE_FREEZE=1` on Production; no pushes to `production` except `[emergency]`; no migrations. Optionally confirm the ignore-build guard by watching a non-emergency commit be skipped. | **OUTSTANDING** | Technical lead; owner approves the Production variable change. |
| 4.2 | Real conference data final: committees, rooms, delegates, schools, staff, contacts, session schedule, group photos. | **OUTSTANDING** | Executive. |
| 4.3 | Final real access codes (one per Chair committee, Approval, Admins, Executive), expiry at end of conference, handed out privately; any remaining test codes revoked. | **OUTSTANDING** | Executive. |
| 4.4 | Final QR sheets printed with saved PDFs; staff and spare devices prepared, each showing the right role and 0 unsynced. | **OUTSTANDING** | Executive, Admins, Chairs. |
| 4.5 | Paper fallback walked through with every Chair; contact table filled; lead administrator and deputy named. | **OUTSTANDING** | Executive. |
| 4.6 | Known-good card matches System health; rollback build still listed. | **OUTSTANDING** | Technical lead. |

---

# Phase 5. Post-conference closure

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 5.1 | Every device 0 unsynced and 0 needs review; recovery files reconciled then deleted. | **OUTSTANDING** | Executive. |
| 5.2 | Data write freeze: revoke all access codes with "Also revoke devices using this code" (the only repository-supported control; 1.10.9). | **OUTSTANDING** | Executive, after 5.1. |
| 5.3 | Final database export kept per the retention decision. | **OUTSTANDING** | Owner. |
| 5.4 | Remove `CONFERENCE_FREEZE`; reduce Supabase compute/plan if not needed. | **OUTSTANDING** | Technical lead and owner. |
| 5.5 | Browser data cleared on shared laptops after the Executive confirms. | **OUTSTANDING** | Executive. |

---

## Known documentation drift to fix when the owner allows

* [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) carries an 8 October state paragraph and the earlier "create a separate production project" flow; the single-project cutover in DEPLOYMENT.md supersedes it for project creation.
* [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) "Open items" is stale, and the dashboard still names the project "DCMUN Staging".
* [DEPLOYMENT.md](DEPLOYMENT.md) "Environments" still calls Preview-variable removal a separate owner decision; the owner has done it (21 Oct). Its "Rollback" text does not yet require the checks in 1.10.5.
* `scripts/verify-deployment.mts` checks `/projector`, a retired feature.
* Several scripts (`verify-submission-http`, `verify-stale-conflicts`, `remote-integration`, `remote-workflow`, `load-test`) rely on the former development seed (`supabase/fixture-ids.json`, `.test-sessions/*`) and a hard-coded `http://localhost:3001`; they have not been shown to work against the current project.
* The single-project lifecycle handoff referenced in review was not found in the repository when this page was revised.
