# v1 release checklist

Consolidated 21 October 2026 from the repository's own documents and scripts, revised after Codex review of PR #57. **Documentation only: this page authorises nothing.** It does not approve a migration, a tag, a version bump, a Production backend cutover, a load test or any change to Vercel or Supabase. Feature freeze applies.

It does not replace the existing gate documents; it indexes them against what is actually proven today:
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (gates, last written 8 October), [DEPLOYMENT.md](DEPLOYMENT.md) (single-project cutover, freeze, rollback), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (project record, migrations 1 to 26), [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) (load and failure plan), [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md), [RELEASES.md](RELEASES.md) and [ACCESS_CODES_DESIGN.md](ACCESS_CODES_DESIGN.md). Governance: root [AGENTS.md](../AGENTS.md). John Paul Ribeiru approves releases; Zuhayr Siddique (owner) approves product scope and Production configuration.

**Single-project lifecycle.** One hosted Supabase project (`kllhswucdhqqywnzxado`) is the preproduction database now and, after a recorded formal promotion, the production database before any real conference data is entered. The owner decision of 20 October 2026 is [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) (added to the repository verbatim, unedited). It is a set of **required changes and acceptance gates, not a description of what is built**: its own text says the current target guard, deployment pipeline and access isolation are not yet claimed to implement it, and that cutover must not happen until the gates are independently verified. This page maps its "Target safeguards" 1 to 6, every "Pre-cutover evidence" bullet, "Formal cutover" steps 1 to 8 and the "After promotion" rules to checklist rows, tagged `[LC safeguard n]`, `[LC evidence n]`, `[LC cutover n]` and `[LC after]`. Where the handoff and older docs disagree, the handoff wins and the disagreement is listed under "Conflicts the owner must decide" at the end.

## How to read this page

Items are grouped into **phases that depend only on earlier phases**. Public real-data entry stays closed until Phase 1 is complete and Phase 2 has run.

| Phase | Name | State of the project |
| --- | --- | --- |
| 1 | Preproduction prerequisites and gates (lifecycle "Development" and "Final rehearsal") | Synthetic data only. Reviewed scoped cloud-agent test access, destructive, load, rollback and write-isolation tests all happen here and finish here. |
| 2 | Ordered cutover and deployment (lifecycle "Formal cutover" steps 1 to 7) | Writes paused, public routes closed. Synthetic data removed, credentials revoked, project promoted, approved build released. |
| 3 | Post-deployment verification and sign-off | Production, no real data yet. **Human-run, non-destructive checks only.** Cloud agents no longer have hosted database access. |
| 4 | Real-data entry and T-48h preparation (lifecycle "Formal cutover" step 8) | Opens only after sign-off. Real Executive bootstrap, real data, final codes, freeze. |
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
| B2 | **Lifecycle safeguards are not implemented** [LC safeguards 2, 3, 4, 5, 6]: no owner-controlled register or server-enforced production lock/marker in the database; no production deny-list/registry beyond the hard-coded PHESMUN ref; tools and builds trust process configuration only; no production-only write gateway (`SupabaseTransport` calls the mutation RPCs directly). The lifecycle says cutover must not happen until these are independently verified. | 1.4 |
| B3 | The public submission server routes have never been run against the current project with the server-only key. | 1.5 |
| B4 | No real-device offline rehearsal on the current project. | 1.7 |
| B5 | The 110-device / 19-committee readiness run (STAGING_REHEARSAL C2) has not been run. This is the capacity gate in `AGENTS.md`. | 1.8 |
| B6 | The synthetic lifecycle, QR, scoring, voting and offline write smoke has not been run on the final candidate, and must be finished and cleaned up **before** promotion. | 1.9 |
| B7 | No rollback drill, no named rollback build and no database recovery procedure. | 1.10 |
| B8 | The release candidate SHA is not approved by John Paul Ribeiru. | 1.11 |
| B9 | Production backend cutover has not happened (Production is a demo build) and needs the owner's approval of each step. | Phase 2 |
| B10 | No known-good release is declared (no tag, `RELEASES.md` entry or printed card). Possible only after Phase 3. | Phase 3 |
| B11 | Root `AGENTS.md`, `README.md` and several docs and script comments are not aligned with the lifecycle [LC evidence 2]. | 1.12 |
| B12 | Lifecycle credential, session and token revocation has not been designed or evidenced, including waiting out token validity [LC cutover 3, 4]. | 1.4.4, 2.3, 2.4 |

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
| 1.1.13 | PR #22 reviewed at the exact SHA; CI, real PostgreSQL 17 concurrency tests, approval/scoring authorisation and durable sync/browser gates pass; session-model redesign stays draft. [LC evidence 3] | **VERIFIED** for merge and CI; **OUTSTANDING** for the independent review and browser gates | PR #22 merged as `852642c` on 20 Oct with green `main` CI ([START_HERE.md](START_HERE.md)). START_HERE.md and the [PR #22 gate](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate) still list Codex's protected-area review and the sync/browser acceptance items as open; the repository does not record them closed. Codex and the owner confirm or complete them. |
| 1.1.14 | Full migration chain replayed from empty on local disposable PostgreSQL; hosted ledger reconciled; each migration applied once to the hosted project; no applied migration edited. [LC evidence 4] | **VERIFIED** | Replay from empty: `tests/database.test.ts` and the other `*-db.test.ts` suites against PGlite and PostgreSQL 17 on every CI run. Hosted ledger and single application: 1.1.2 to 1.1.4. |
| 1.1.15 | `archive_jobs` non-empty refusal and lock-race test on disposable synthetic fixtures. [LC evidence 4] | **OUTSTANDING** | `archive_jobs` was dropped by migration 21 (`20261019100200_retire_archive_jobs`); `tests/point-adjustments-db.test.ts` and `tests/archive-concurrency.test.ts` exist. Codex confirms which test covers the lifecycle's wording, or the owner records it as superseded by the retirement. No real data may be cleared to pass any test. |
| 1.1.16 | Where the 21 Oct evidence ran: the project was on **Micro** (last recorded) and held synthetic data in two conferences. | Note | That evidence is **development evidence**, not final capacity acceptance (see 1.8). The temporary conference's records remain and are cleaned in Phase 2 (2.2).

## 1.2 Supabase Pro compute and backup / PITR verification

The Supabase connector **cannot** read the plan, compute size, backup settings or PITR state (SUPABASE_PROJECT_SETUP.md says so). Everything here needs the **owner or technical lead in the Supabase dashboard**, with a dated screenshot or note kept in the release folder.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.2.1 | Organisation is on **Pro**. | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Organisation, Billing. Last recorded as unconfirmed (20 Oct). Owner approves any upgrade and cost first. |
| 1.2.2 | Compute is **Small** (last recorded Micro). | **NOT VERIFIABLE FROM THE REPO** | Dashboard, Project Settings, Compute. Required before the capacity rehearsal and before 5 November. |
| 1.2.3 | Region ap-south-1, Postgres 17.11, `ACTIVE_HEALTHY`. | **VERIFIED** (20 Oct) | SUPABASE_PROJECT_SETUP.md, read through the connector. Vercel functions run in `bom1` (`vercel.json`). |
| 1.2.4 | Scheduled daily backups exist and the latest succeeded. | **NOT VERIFIABLE FROM THE REPO** | Owner confirms in Dashboard, Database, Backups (RELEASE_CHECKLIST.md section 2; TROUBLESHOOTING.md). |
| 1.2.5 | PITR decision. | **NOT VERIFIABLE FROM THE REPO** | No repository document mentions point-in-time recovery. Owner decides, enables it if wanted, and records retention and cost **before real data is entered**, because recovery only reaches back to when it was enabled. |
| 1.2.6 | Backup coverage reviewed (including Storage objects where needed), a restore/recovery plan written, and restores **exercised before promotion on local or disposable state**. Acceptable data loss and downtime recorded with independent approval. **No hosted restore project without the owner's approval.** [LC evidence 8] | **OUTSTANDING** | Owner and technical lead; see 1.10.6. Confirm in the dashboard whether the daily database backup covers the `resolutions` Storage bucket; if not, state how objects are protected. |
| 1.2.7 | Fallback export plan. | **OUTSTANDING** | TROUBLESHOOTING.md says to export daily. Owner names who, how, and where the file lives. |
| 1.2.8 | Auth rate limit for anonymous sign-ins per IP set from a measured value. | **OUTSTANDING** | Default 30 per hour; the venue shares one NAT. Set it after the Phase D measurement in 1.8.5. |
| 1.2.9 | Anonymous sign-ins enabled. | **VERIFIED** (20 Oct) | Works over HTTP (SUPABASE_PROJECT_SETUP.md "Behaviour"). |
| 1.2.10 | Named owner, Pro organisation, ref and Micro allocation recorded; only one hosted project exists; no paid database branch or second test database. [LC evidence 1] | **VERIFIED** for ref, region and "only organisation and project visible to the connector" (20 Oct, SUPABASE_PROJECT_SETUP.md); **NOT VERIFIABLE FROM THE REPO** for Pro, Micro and absence of branches | Owner confirms in the dashboard (Branches, Billing). The lifecycle itself establishes no ref, organisation ID or provisioning status; the record cited is the repository's own. |

## 1.3 Environment and project-target guards (configuration)

Observed 21 Oct 2026, **not yet recorded in the repository**: the Production site is a **demo-mode build serving `main` `542e705`** with Supabase `not_configured`; the owner has removed the Preview Supabase variables. Record both in [RELEASES.md](RELEASES.md) and DEPLOYMENT.md (its "Environments" paragraph still calls that removal a separate owner decision).

These guards are **evidence, not isolation**. They do not close the gates in 1.4.

| # | Item | Status | Evidence or action |
| --- | --- | --- | --- |
| 1.3.1 | Guard code: PHESMUN `gglltljhdpkfjnyjmnif` refused everywhere; Production must equal `EXPECTED_SUPABASE_REF` and the build fails if it is unset; non-Production builds and `scripts/*.mts` need the ref in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS`; one role per project; no override. | **VERIFIED** (code and CI) | `lib/platform/target-guard.ts`, `next.config.ts`, `tests/target-guard.test.ts`; DEPLOYMENT.md "Target guard". **Limit:** the guard reads only process environment (see 1.4.2). |
| 1.3.2 | Production serves `main` `542e705` as a demo build, Supabase `not_configured`. | **VERIFIED** (21 Oct, observed via Vercel and `/api/health`) | Not yet in the repo; record in RELEASES.md. |
| 1.3.3 | Preview Supabase variables removed. | **VERIFIED** (owner, 21 Oct) | Earlier, 20 Oct: Preview set to `NEXT_PUBLIC_DATA_BACKEND=local`, Preview `dpl_6Zo7x5BTfZ6Lm4bj6vRrkBtnEUtQ` (`a5975e9`) healthy with Supabase `not_configured`. This does **not** remove access from already-built deployments (step 2.5). |
| 1.3.4 | `scripts/vercel-ignore-build.sh` freeze guard. | **VERIFIED** (code) | `ignoreCommand` in `vercel.json`: with `VERCEL_ENV=production` and `CONFERENCE_FREEZE=1`, skips builds whose commit message lacks `[emergency]`. Not yet exercised on Vercel (see 4.2). |
| 1.3.5 | Operator scripts refuse Production. | **VERIFIED** (code) | `assertToolTarget` runs before any connection in `smoke-project`, `verify-submission-http`, `verify-stale-conflicts` and `remote-context` (used by `load-test`, `remote-integration`, `remote-workflow`); `scripts/rehearsal/guard.ts` also refuses custom domains. |
| 1.3.6 | `CONFERENCE_FREEZE` is unset now; Production branch is `production`; branch protection on `main` and `production`; Vercel plan. | **NOT VERIFIABLE FROM THE REPO** | Technical lead confirms in Vercel and GitHub. DEPLOYMENT.md gives `c0a6a65` for `production` on 8 Oct and says to recheck. |
| 1.3.7 | Deployment Protection plan: Previews protected, Production public for delegate phones. | **OUTSTANDING** | Owner approves; applied in Phase 2 and checked in Phase 3. |
| 1.3.8 | **Single allow-list role only** [LC safeguard 3]: the ref is listed in `DEVELOPMENT_SUPABASE_REFS` **or** `STAGING_SUPABASE_REFS`, never both, and never also as `EXPECTED_SUPABASE_REF`. | **VERIFIED** (code); **NOT VERIFIABLE FROM THE REPO** (actual values) | `targetConfig` throws if a ref appears in two roles (`tests/target-guard.test.ts`). Committed config lists nothing: `.env.example` leaves all three blank and documents `STAGING_SUPABASE_REFS` as the role while the project is in development. DEPLOYMENT.md and SUPABASE_PROJECT_SETUP.md record the intended state as `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado`, `DEVELOPMENT_SUPABASE_REFS` empty, `EXPECTED_SUPABASE_REF` absent. No repository file lists the ref under `EXPECTED_SUPABASE_REF` or `DEVELOPMENT_SUPABASE_REFS`. Operator shells, `.env.local` and Vercel variables are outside the repo: the technical lead confirms there is no second listing, and that Production has no `EXPECTED_SUPABASE_REF` until step 2.6. |
| 1.3.9 | **Register the ref explicitly; no old default** [LC safeguard 1]: no reuse of `opmydpozhdgkpcnjwpqb` or the PHESMUN ref; exact URL/ref match, no arbitrary hosts, no permissive fallback, no override flag. | **VERIFIED** (code) | `lib/platform/target-guard.ts`: `supabaseRef` accepts only `https://<20 chars>.supabase.co`; an unset allow-list allows nothing; `NEVER_SUPABASE_REFS` holds the PHESMUN ref. The old ref appears in code only inside `tests/target-guard.test.ts` and otherwise in historical docs and result files. Two script comments (`scripts/remote-context.mts`, `scripts/rehearsal-identities.mts`) still say "the DCMUN development project by default"; they are stale and belong in the alignment change (1.12). |
| 1.3.10 | Preview builds and server routes fail closed when configured for a refused ref; health does not contact the database on a refused target. [LC safeguard 5] | **VERIFIED** (build and probe, process configuration) | `targetProblem` in `next.config.ts` and the health probe; `tests/target-guard.test.ts` cases for Preview with the production ref, with no allow-list, and a refused probe. **Limit:** this reads process configuration only. Refusal driven by the database lock is OUTSTANDING (1.4.1, 1.4.2). |
| 1.3.11 | PR/branch CI is local-only and receives no production secrets. [LC safeguard 5] | **VERIFIED** (now) | `.github/workflows/ci.yml` uses a local PostgreSQL 17 on the runner and sets only `TEST_POSTGRES_URL`; no repository secrets are referenced. Re-check after any workflow change. |

## 1.4 Single-project production isolation (blocking)

These are the lifecycle's required gates ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) "Target safeguards"). The handoff states they are **not** yet implemented, and the code agrees. `checkToolTarget` in `lib/platform/target-guard.ts` trusts only process configuration: an old shell or build that lists the ref as `STAGING_SUPABASE_REFS` and omits `EXPECTED_SUPABASE_REF` is accepted. `SupabaseTransport` (`lib/supabase/repository.ts`) still calls the mutation RPCs (for example `apply_conference_mutation`) directly with the publishable key and the user's session. The existing guard tests in CI and the removal of Preview variables do **not** close any row below. Every row must be closed, or carry an explicit owner decision recording an accepted scope change, before real data is entered. Closing them needs code, migrations or configuration: that is an owner-approval gate with independent Codex review (`AGENTS.md` protected areas 1, 3, 4).

| # | Gate | Status | Evidence or owner decision required |
| --- | --- | --- | --- |
| 1.4.1 | **Owner-controlled lifecycle register plus a server-enforced production lock/marker in the database, inaccessible to test roles.** A phase name or allow-list supplied by an agent or process is not authority to demote production. [LC safeguard 2] | **OUTSTANDING** (not implemented) | No such table, marker or control path exists in `supabase/migrations`; the lifecycle says not to invent one. Needs a reviewed committed migration (a migration 27, approval gate) and an owner-controlled register outside the database. Evidence: the migration, its replay, the register's current value and last change. |
| 1.4.2 | **Production deny-list/registry available to tools without database access**, so a known-production ref is refused before any connection; the database lock also rejects stale or misclassified test credentials. [LC safeguards 3, 4] | **OUTSTANDING** (not implemented) | Today only the hard-coded PHESMUN ref is denied before connection. After promotion nothing refuses the promoted ref except the operator removing it from the allow-list; the lifecycle says an old allow-list must not re-authorise tests. |
| 1.4.3 | **Load, fixture, reset and destructive tools fail closed** for production, a missing or unknown phase, contradictory refs, a stale lifecycle check or unavailable verification; after promotion they hold no credentials for the ref. [LC safeguard 4] | **OUTSTANDING** | Contradictory refs, PHESMUN, unset and malformed lists already fail closed (1.3.1). Missing or unknown phase and stale lifecycle checks do not exist yet because there is no phase to check. |
| 1.4.4 | **Production-only write gateway or capability; direct bypass denied.** Writes are accepted only through the approved Production app, with per-user, conference, committee, revocation and mutation checks preserved. A browser Origin/Referer, CORS, a public API key or a client-side phase flag is not proof. A Preview holding a valid production session must not be able to write. The gateway must authenticate the actual actor and session, reject cross-site and CSRF attempts, bind any write proof to the intended operation, refuse proof minted by a Preview, never place a service key in the browser, never replace actor checks with blanket privileged writes, and keep durable-outbox and idempotent semantics. [LC safeguard 6] | **OUTSTANDING** (not implemented) | Not met today: `SupabaseTransport` calls the RPCs directly. Needs an independently reviewed design and implementation; **under the feature freeze this is an owner scope decision**, and the timeline in the conflicts list applies. Real staff sessions must not be reused in Preview browsers. |
| 1.4.5 | **Revocation design:** immediate grant and session denial in every RPC, read and write path; legacy key invalidation handled separately; the remaining validity of already-issued access tokens known. [LC cutover 3, 4] | **OUTSTANDING** | `user_access` grants and revocation are enforced by RLS and RPCs (1.6), but the repository does not show that a revoked session's still-valid JWT is refused everywhere, and token lifetime is a Supabase Auth setting. Owner records the JWT expiry setting and the longest time an old token could work; if immediate rejection cannot be proved, Phase 2 must wait it out (2.4). |
| 1.4.6 | **Prove the lock and deny-list** against missing or wrong phases, conflicting refs, PHESMUN, stale allow-lists and attempted demotion; rehearse cutover and rollback on disposable or synthetic preproduction state. [LC evidence 6] | **OUTSTANDING** | Depends on 1.4.1 to 1.4.3. Evidence: dated test run recorded in `docs/VERIFICATION.md`. |
| 1.4.7 | **Prove Preview, server and direct-RPC denial and the gateway** with production-classified **synthetic** state before formal promotion, including old cached bundles, pre-issued sessions and keys. All destructive, load and write-isolation testing finishes before actual conference data exists. [LC evidence 7] | **OUTSTANDING** | Depends on 1.4.4. |
| 1.4.8 | Environment guards, committed config and Preview-variable removal are recorded as evidence only. | **VERIFIED** (that they exist) | See 1.3. They do not satisfy 1.4.1 to 1.4.7. |

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
| 1.6.10 | First-Executive bootstrap procedure. | **OUTSTANDING** | [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) was tested 8 Oct on the former development project. The 21 Oct session used a short-lived hash-bootstrapped Executive, not the documented script. Repeat the documented script on a labelled TEST conference now; the production run is 4.1, after sign-off. |

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
| 1.8.1 | This same project upgraded Micro to Small (no new project), the actual configuration recorded, **before** the readiness run. [LC evidence 5] | **NOT VERIFIABLE FROM THE REPO** | Owner confirms Pro and Small in the dashboard (1.2.1, 1.2.2). Do not run the load phases on Micro. |
| 1.8.2 | Harness supports the 19-committee / 110-device shape. | **OUTSTANDING** | Docs and the `rehearsal-run.mts` header still show 14 committees and 50/100 staff. Claude checks `rehearsal-fixture.mts`, `rehearsal-identities.mts` (25 anonymous sign-ins per run, one per 20 s: run the day before) and `rehearsal-run.mts`, with Codex review. A change is a code change needing owner approval. |
| 1.8.3 | Preparation and run. | **OUTSTANDING** | `npm run rehearsal:identities`, `npx tsx scripts/rehearsal-fixture.mts ...`, `npm run rehearsal:plan` (dry run), `npm run rehearsal:run -- --app <preview-url> --identities ... --fixture ...`. The app URL must be a `*.vercel.app` deployment or localhost; protected Previews need the automation bypass secret. Owner approves running. Fresh synthetic fixture per run. |
| 1.8.4 | `READINESS RUN` passes: error rate under 1% (conflicts excluded); write p95 at most 1.5 s; read p95 at most 2.5 s; zero unexplained 5xx, `PGRST003`, `40001` loops, statement timeouts, lost or duplicate writes, rate-limit responses; delegate page p95 at most 2 s with no Auth activity; at most 18 real submissions per link. | **OUTSTANDING** | Attach harness report plus Supabase Logs/Observability and Vercel Logs for the run window. |
| 1.8.5 | Burst start of prepared devices GREEN within 3 minutes; fresh code entry from one NAT at N = 10, 25, 40 (Phase D). | **OUTSTANDING** | Ideally on venue Wi-Fi; feeds 1.2.8. |
| 1.8.6 | Realtime loss never stops core operations (E2). | **OUTSTANDING** | |
| 1.8.7 | The full set at Small: 110-device / 19-committee readiness run, separate delegate bursts and shared-NAT enrollment, offline/reconnect/restart, overload, role and revocation, failure and rollback rehearsals, all on **synthetic** data and finished before promotion. [LC evidence 5] | **OUTSTANDING** | Phases C to F of STAGING_REHEARSAL.md. Micro-tier results (including everything run to date) are development evidence, not final capacity acceptance. |
| 1.8.8 | Existing evidence. | Not sufficient | `npm run test:load` (`docs/load-test-results.json`): 150 clients on **one** identity, zero errors, but burst-read p95 13,093 ms, on the deleted Nano project. VERIFICATION.md says it does not justify capacity acceptance. |

## 1.9 Synthetic lifecycle tests and cleanup (before promotion)

Everything that creates, changes or deletes records belongs here: the lifecycle forbids rehearsal, destructive and synthetic-write suites after promotion [LC cutover 7]. After promotion the only checks are the human-run non-destructive ones in Phase 3.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.9.1 | Synthetic QR checks from a phone on mobile data (not signed in to Vercel) on a **preproduction deployment with the server key**: resolution QR and amendment QR open and submit; then remove the records in the app. | **OUTSTANDING** | Executive or Admins. Needs 1.3.7 applied to that deployment for the "no Vercel login" part. |
| 1.9.2 | Labelled-resolution lifecycle: Chair draft, Approval review and approve, Logistics print copies, debate, scoring, vote including clear majority, Executive overview. | **OUTSTANDING** | Repeat of the 21 Oct checks on the final candidate (21 Oct run is **VERIFIED** for `542e705` only). |
| 1.9.3 | Scoring and voting edge cases: Main Submitter points, stale ballot revision, Divide the House. | **OUTSTANDING** (final SHA) | Same. |
| 1.9.4 | Related offline write smoke. | **OUTSTANDING** | 1.7.4. |
| 1.9.5 | Plan the cleanup that Phase 2 step 2.2 will perform: the two `DCMUN Development Test` conferences (original `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`, and the 21 Oct temporary conference in the same project), TEST committee `TST`, smoke-test replay schools, test delegates, submission link, resolution `TST / 01`, every synthetic Storage object, test auth users and refresh sessions. **Already done on 21 Oct for the temporary conference:** its 4 credentials and 36 device grants were *revoked*, but the rows, its TEST records and the Executive hash-bootstrapped for it **remain**; revoked rows are not removal. The original test conference's two active credentials, 8 active grants and Draft document also remain. | **OUTSTANDING** | A reviewed, guarded cleanup script or procedure with a read-only before/after count, run on the verified preproduction target. Owner approves. Do not run it before the last synthetic test in 1.7 to 1.9. |

## 1.10 Freeze, rollback and incident recovery (procedures prepared and rehearsed)

The repository has **no switch that freezes data writes**. `CONFERENCE_FREEZE` is a build-time flag that stops deployments, not edits.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 1.10.1 | Change-freeze procedure: `CONFERENCE_FREEZE=1`; nobody advances `production`; no migrations; emergency fixes only, narrow, CI-green, previewed, with `[emergency]` in the commit that lands on `production`. | **VERIFIED** (documented) | DEPLOYMENT.md "Production freeze". It is applied in Phase 4. |
| 1.10.2 | Rollback procedure documented. | **VERIFIED** (documented) | DEPLOYMENT.md "Rollback"; EMERGENCY_RECOVERY.md. |
| 1.10.3 | Rollback drilled and timed under 5 minutes, **before promotion**. | **OUTSTANDING** | STAGING_REHEARSAL Phase F on an optional second *Vercel* project (Instant Rollback exists only for a project's production deployments), pointed at the synthetic preproduction database; that Vercel project and its deployments are then retired at cutover (2.5). The older docs' "rollback drill once on Production" conflicts with the lifecycle (no rehearsal after promotion) and is not part of this checklist; see the conflicts list. Vercel plan (Hobby returns only to the previous production deployment; DEPLOYMENT.md recommends Pro): **NOT VERIFIABLE FROM THE REPO**. |
| 1.10.4 | A **named rollback build** exists and is verified (see 1.10.5). Today there is none: the only production deployment is the demo build. | **OUTSTANDING** | Technical lead names the Vercel deployment id and commit. |
| 1.10.5 | App rollback is **not automatically safe** because no migrations are added during the freeze. The named rollback build must be checked against (a) the applied migration ledger (compatible with the schema the database actually has), (b) the **current production configuration and rotated credentials** (a rollback restores that deployment's own build-time environment, so a deployment built with development configuration or old test credentials must never be revived), and (c) the durable-client contract (outbox, mutation receipts, optimistic fingerprints, PT409/40001 handling: an older client must still replay saved actions exactly once against the current database). Record the check next to the card. A Vercel rollback never reverts the database or demotes the project [LC after]; it never resurrects a connected Preview, revoked test credentials, a development marker or an old allow-list. (DEPLOYMENT.md) | **OUTSTANDING** | Technical lead with an independent reviewer. Prefer a rollback build created after the credential rotation in Phase 2, not before it. |
| 1.10.6 | Database recovery procedure (restore from backup or PITR, who decides, what is lost), exercised on local or disposable state; no hosted restore project without owner approval. [LC evidence 8] | **OUTSTANDING** | **Nothing exists in the repository.** Write it after 1.2.4 to 1.2.6 and add it to EMERGENCY_RECOVERY.md. It must name the decision-maker (Zuhayr Siddique during a live problem), state that a restore discards everything after the restore point including work already synced, and that devices with unsynced work export first and re-sync after. |
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

## 1.12 Repository alignment with the lifecycle [LC evidence 2]

The lifecycle requires root `AGENTS.md`, its thin `CLAUDE.md` pointer, README and code/config examples to be aligned, "replacing \"no production exists\" / separate hosted staging assumptions without weakening protected-area rules", through an independently reviewed repository change. State on `b123ae6`:

| # | File | Status | What it says now |
| --- | --- | --- | --- |
| 1.12.1 | `CLAUDE.md` | **VERIFIED** aligned | Thin pointer to `AGENTS.md` plus Graphify guidance; nothing to change except via `AGENTS.md`. |
| 1.12.2 | `AGENTS.md` | **OUTSTANDING** | Protected area 1 says "No production Supabase project exists yet" and speaks of load tests "not listed as staging or development"; area 3 says migrations are "replayed on a staging project"; the closing bullet puts conference-week validation and rollback drills on "Supabase Pro with Small compute". None describes one project that is promoted, the post-promotion ban on cloud-agent hosted access, or the lifecycle gates. |
| 1.12.3 | `README.md` | **OUTSTANDING** | Calls the repo "a development baseline", points to "Production Supabase setup" and a "Supabase Pro/Small" rehearsal as remaining work, and describes `main` Previews and the guarded `rehearsal:run` without the lifecycle's Preview rule (new Previews local/demo after cutover). |
| 1.12.4 | `.env.example`, `INTEGRATION.md` | **VERIFIED** largely aligned | Both describe one DCMUN project that becomes production at cutover. `.env.example` still tells operators to keep the project in `STAGING_SUPABASE_REFS` until cutover, which is compatible with LC safeguard 3. |
| 1.12.5 | `docs/DEPLOYMENT.md`, `docs/RELEASE_CHECKLIST.md`, `docs/STAGING_REHEARSAL.md`, `docs/SUPABASE_PROJECT_SETUP.md`, script comments | **OUTSTANDING** | Differences are listed under "Conflicts the owner must decide". Script comments claiming "the DCMUN development project by default" are stale (1.3.9). |
| 1.12.6 | The alignment change itself | **OUTSTANDING** | A reviewed repository change, authored by Claude and independently reviewed by Codex; owner approves wording. Not done by this page. |

# Phase 2. Ordered cutover and deployment

Lifecycle "Formal cutover" steps 1 to 7, human controlled and recorded, in order, in a **write-pause window with public routes closed until the production build and access boundary pass**. A failure leaves the project closed to real-data entry and requires correction, never a temporary test-access exception. Runs only after 1.11.2. Each step needs explicit owner approval; record who and when. All rows are **OUTSTANDING**. Target window from the repository: early November, Small compute before 5 November (the conference is 5 to 7 November).

| Step | Action | Notes |
| --- | --- | --- |
| 2.1 | [LC cutover 1] Freeze the candidate SHA and migration ledger. Reconcile synthetic work and device outboxes and retain the evidence needed. **Inventory** old Previews and aliases, functions, cron jobs and hooks, tests, agent connectors, organisation/API/database credentials and staff/rehearsal identities. Record the named rollback build (1.10.4). | CI green on the SHA; ledger equals the repository (26 files). Includes the optional second Vercel project from 1.10.3. |
| 2.2 | [LC cutover 2] Safely remove the synthetic records and Storage objects with the reviewed, guarded cleanup of 1.9.5 on the verified preproduction target; keep migration history and approved configuration. Confirm no real conference data has entered. Retire synthetic submission and amendment links, access codes and grants. Clear test-device state only after its outbox is reconciled; keep UUID/idempotency protections. | Removes the two test conferences' rows (revoked credentials and grants stay as rows until now), `TST` data and test auth users. DEPLOYMENT.md calls this step 2. |
| 2.3 | [LC cutover 3] Disable cloud-agent Supabase/SQL/MCP/Management API test access, Vercel credential access and hosted-test CI or jobs. Revoke agent and test PATs, database roles and passwords, the API secret/service-role keys and refresh sessions; remove test `user_access` grants and QR credentials. If a connector's organisation-level access cannot exclude this project, disconnect or revoke that connection. Replacement production credentials go only to trusted human operators and the Production runtime; **agents are not given the new values**. | The Supabase and Vercel connectors used on 20 and 21 Oct are such agent access. After this step cloud agents cannot perform any hosted check, so every later row is human-run. |
| 2.4 | [LC cutover 4] Enforce immediate grant and session denial in all relevant RPC, read and write paths (1.4.5), handle legacy key invalidation separately, and **wait out any remaining access-token validity** before real-data entry if immediate rejection cannot be proved. Real production user access is bootstrapped later (4.1). | Owner records the longest remaining validity and the time it elapses. |
| 2.5 | [LC cutover 5] Remove all hosted values and secrets from Preview, Development and branch overrides, integration injection, PR CI and agent environments; rebuild new Previews in local/demo mode. **Retire or delete every old connected Preview and candidate deployment, immutable URL and alias**, because changing defaults does not update a built deployment; none may keep a valid server credential, a public write proxy or a usable production write capability. Remove the ref from every `STAGING_SUPABASE_REFS` and `DEVELOPMENT_SUPABASE_REFS`, including operator shells. | The Preview variables are already removed (1.3.3); built deployments are the open part. Record the URLs for 3.3. |
| 2.6 | [LC cutover 6] While writes remain closed, change the owner-controlled lifecycle register and the server lock (1.4.1) to production, remove every test allow-list entry and install the exact Production-only `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`, Supabase URL and publishable key, `NEXT_PUBLIC_DATA_BACKEND=supabase`, the real `NEXT_PUBLIC_CONFERENCE_ID`, `SUPABASE_SECRET_KEY` (Sensitive) and `NEXT_PUBLIC_CONFERENCE_TIMEZONE=Asia/Qatar`; apply the Deployment Protection plan (1.3.7). Record timestamp, operator, approvals, ref, Small size, candidate SHA, ledger, backup and access-revocation evidence. Confirm plan, Small compute and backups (1.2) and the passed readiness run (1.8). | This is the formal promotion. It creates no project and replays no migration. Steps 2.5 and 2.6 are one role change: the ref never holds production and test roles at once. |
| 2.7 | [LC cutover 7] Release the approved production build from the exact verified revision with new Production-scoped secrets (`production` fast-forwarded, never force-pushed; a merge commit has a different SHA and must itself be verified). Do not reuse a preproduction build whose embedded target, keys or access boundary differs. | Verification is Phase 3. No rehearsal, destructive or synthetic-write suite runs after this step. |

---

# Phase 3. Post-deployment verification and sign-off

**Human-run, non-destructive checks only** [LC cutover 7, LC after]: target, SHA, health and access. No test submissions, no labelled resolutions, no scoring, no voting and no cleanup, because test data is gone and cloud agents have no hosted database access. Anything that writes belongs in Phase 1.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 3.1 | `npm run verify:deployment -- <production-url> <release-sha>` passes (read-only requests). | **OUTSTANDING** | Technical lead (human). Caveat: the script still requests `/projector`, a retired feature with no `app/projector` route; confirm that check passes or is understood first. |
| 3.2 | System health on one device reads `<version> · <sha7> · production`, Supabase `ok`, Storage `ok`, GREEN; `/api/health` agrees and reports project `kllhswucdhqqywnzxado`. | **OUTSTANDING** | Human operator with a real staff device. Today Production reports a demo build with Supabase `not_configured`. Real access is only available after 4.1, so before it only `/api/health` and the access-code screen can be checked. |
| 3.3 | Old agent access, old Previews and new Previews remain **denied**: an old Preview or alias recorded in 2.5 is gone ("deployment not found"); a newly built Preview does not reach the project (refused build, "Wrong Supabase project", or the local demo); revoked agent credentials are refused. | **OUTSTANDING** | Human-run, read-only. |
| 3.4 | Stale-configuration and direct-RPC denial hold on Production (1.4.2, 1.4.4). | **OUTSTANDING** | Proven in Phase 1 (1.4.6, 1.4.7). Here only a human, non-destructive confirmation if the owner wants one. |
| 3.5 | Public pages from a normal phone on mobile data, not signed in to Vercel: the conference URL shows the staff access-code screen; the resolution and amendment QR pages **open** (view only; nothing submitted); no real QR exists until 4.1. | **OUTSTANDING** | Human operator. |
| 3.6 | Supabase Advisors repeated; nothing beyond the accepted list. | **OUTSTANDING** | Technical lead (dashboard). |
| 3.7 | Named rollback build (1.10.4, 1.10.5) still present and compatible with the promoted lifecycle and rotated credentials. | **OUTSTANDING** | Technical lead. |
| 3.8 | Target, SHA, ledger (26 migrations, latest `20261021130000`), backup and revocation evidence recorded with timestamp and operator [LC cutover 6]. [RELEASES.md](RELEASES.md) entry: version, commit, immutable `*.vercel.app` URL, deployment id, latest migration, verifier, date. Currently "No production deployment yet". | **OUTSTANDING** | Technical lead. |
| 3.9 | Release sign-off recorded. | **OUTSTANDING** | John Paul Ribeiru approves the release; the owner approves infrastructure and configuration. After 3.1 to 3.8. |
| 3.10 | Known-good tag `known-good-<conference>-<yyyy-mm-dd>` pushed; known-good card printed; version stays `0.2.0` or is bumped. | **OUTSTANDING** | **Owner approval required; no tag exists, none may be created and no version bump made before 3.9.** |

## After promotion: standing rules [LC after]

These apply from Phase 2 step 2.3 onward and are not one-off checks. Each is **OUTSTANDING** until the owner records adherence at sign-off.

| # | Rule | Status |
| --- | --- | --- |
| R1 | Cloud agents review source and run **local synthetic tests only**: no live database reads or writes, no data exports, no hosted migration, reset or load tooling, no retrieval of production credentials. | **OUTSTANDING** |
| R2 | Human operators keep legitimate conference access and an approved emergency and release process. | **OUTSTANDING** |
| R3 | New migrations are reviewed, replayed locally, checked for backward compatibility and applied by an authorised human-controlled release, without re-enabling hosted agent testing. | **OUTSTANDING** |
| R4 | Any need for remote rehearsal waits for an owner-approved separate test environment. Re-run load and destructive tests only on local disposable data or such a target. | **OUTSTANDING** |
| R5 | The 48-hour pre-conference freeze and production/`main` separation stay in force (4.2). | **OUTSTANDING** |
| R6 | Rollback only to a build and configuration compatible with the promoted lifecycle and credential rotation (1.10.5). Application rollback does not undo schema changes or demote the project. | **OUTSTANDING** |
| R7 | Ending the conference does not automatically demote production or re-enable agent access (Phase 5). | **OUTSTANDING** |

---

# Phase 4. Real-data entry and T-48 hours preparation

Opens **only after** Phase 3 sign-off (3.9). Human operators only.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 4.1 | [LC cutover 8] Permit actual conference data entry; bootstrap the real Executive with [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) (a human, in person, no hand-inserted `user_access` rows); issue real grants, codes and QR links under the approved procedure; record the known-good application build and compatible ledger. | **OUTSTANDING** | Executive and technical lead. DEPLOYMENT.md places the bootstrap before the deployment; the lifecycle places it after sign-off, and the lifecycle governs. |
| 4.2 | Set `CONFERENCE_FREEZE=1` on Production at T-48h (3 November for a 5 November start); no pushes to `production` except `[emergency]`; no migrations. | **OUTSTANDING** | Technical lead; owner approves the Production variable change. |
| 4.3 | Real conference data final: committees, rooms, delegates, schools, staff, contacts, session schedule, group photos. | **OUTSTANDING** | Executive. |
| 4.4 | Final real access codes (one per Chair committee, Approval, Admins, Executive), expiry at the end of the conference, handed out privately. | **OUTSTANDING** | Executive. |
| 4.5 | Final QR sheets printed with saved PDFs; staff and spare devices prepared, each showing the right role and 0 unsynced. A human walks the real QR pages once from a phone (view, per policy of the owner) as the only production check of them. | **OUTSTANDING** | Executive, Admins, Chairs. |
| 4.6 | Paper fallback walked through with every Chair; contact table filled; lead administrator and deputy named. | **OUTSTANDING** | Executive. |
| 4.7 | Known-good card matches System health; rollback build still listed. | **OUTSTANDING** | Technical lead. |

---

# Phase 5. Post-conference closure

Ending the conference does **not** demote production or re-enable cloud-agent access [LC after]; any later hosted testing needs a separate owner-approved decision.

| # | Item | Status | Action |
| --- | --- | --- | --- |
| 5.1 | Every device 0 unsynced and 0 needs review; recovery files reconciled then deleted. | **OUTSTANDING** | Executive. |
| 5.2 | Data write freeze: revoke all access codes with "Also revoke devices using this code" (the only repository-supported control; 1.10.9). | **OUTSTANDING** | Executive, after 5.1. |
| 5.3 | Final database export kept per the retention decision. | **OUTSTANDING** | Owner. |
| 5.4 | Remove `CONFERENCE_FREEZE`; reduce Supabase compute if not needed. | **OUTSTANDING** | Technical lead and owner. |
| 5.5 | Browser data cleared on shared laptops after the Executive confirms. | **OUTSTANDING** | Executive. |

---

## Coverage map for the lifecycle handoff

| Lifecycle item | Rows |
| --- | --- |
| Target safeguards 1 / 2 / 3 / 4 / 5 / 6 | 1.3.9 / 1.4.1 / 1.3.8, 1.4.2 / 1.4.3 / 1.3.10, 1.3.11 / 1.4.4 |
| Pre-cutover evidence 1 to 8 | 1.2.10 / 1.12 / 1.1.13 / 1.1.14, 1.1.15 / 1.2.2, 1.8.1, 1.8.7 / 1.4.6 / 1.4.7 / 1.2.6, 1.10.6, 1.1.6 |
| Formal cutover 1 to 8 | 2.1 / 2.2 / 2.3 / 2.4 / 2.5 / 2.6 / 2.7 with Phase 3 / 4.1 |
| After promotion | Rules R1 to R7, 1.10.5, Phase 5 |

## Conflicts the owner must decide

Where the repository's current state or older documents differ from the lifecycle. The lifecycle is the owner's later decision; these need an explicit ruling or a reviewed document change.

1. **Gates not built.** The register and lock, deny-list, fail-closed phase handling and production write gateway (1.4.1 to 1.4.4) do not exist. They need migrations and code under a feature freeze, with the conference on 5 to 7 November, T-48h on 3 November, and Small compute plus the readiness run and the isolation proofs (1.4.6, 1.4.7) still to do first. Decide: implement now and accept the timeline, or record an explicit accepted scope change. The page does not drop any gate.
2. **Bootstrap order.** DEPLOYMENT.md cutover step 8 bootstraps the first Executive and then deploys; the lifecycle deploys, verifies and signs off, then bootstraps (4.1). This checklist follows the lifecycle.
3. **Rehearsals on Production.** DEPLOYMENT.md and RELEASE_CHECKLIST.md section 2 call for a rollback drill and one real QR submission on Production with test-record removal. The lifecycle forbids rehearsal and synthetic writes after promotion. Those checks are moved to Phase 1 (1.9.1, 1.10.3) and Phase 3 is view-only.
4. **Separate production project.** RELEASE_CHECKLIST.md section 2 still says "Create the production project". The lifecycle and DEPLOYMENT.md's single-project cutover supersede it.
5. **Second Vercel project for the rollback drill.** STAGING_REHEARSAL.md Phase F suggests `munos-staging` pointed at the same Supabase project. The lifecycle bars a second *Supabase* project only; if the owner allows this Vercel project, it is a connected preproduction deployment that must be retired at 2.5.
6. **Cloud-agent connector scope.** The Supabase and Vercel connectors were used on 20 and 21 Oct (development phase, allowed by "reviewed scoped cloud-agent test access"). The Supabase connector shows every project in the organisation; per the lifecycle, if its access cannot exclude this project the connection must be revoked at 2.3. Decide who then performs hosted verification (humans only).
7. **Temporary test conferences in the same project.** The 21 Oct isolated conference, created with a hash-bootstrapped Executive credential, fits the development phase, but its rows, the original test conference, replay schools, TEST documents and anonymous auth users all remain and must be removed at 2.2. Revoked credentials and grants are not removal. Decide who runs the guarded cleanup and who approves it.
8. **Micro-tier evidence.** The 21 Oct smoke test and browser checks ran with the project on Micro (last recorded). They are valid functional evidence for `542e705` but are development evidence for capacity. The lifecycle requires everything destructive, load and rollback at Small before promotion (1.8.7).
9. **Production variables vs `EXPECTED_SUPABASE_REF`.** Production is a demo build with no Supabase variables, so the guard has nothing to check until 2.6. Setting those variables is a Production configuration change needing owner approval.
10. **Allow-list actual state.** The repository lists the ref nowhere, docs say `STAGING_SUPABASE_REFS`, and the guard rejects a double listing; whether any shell or Vercel variable also lists it as `DEVELOPMENT_SUPABASE_REFS` or `EXPECTED_SUPABASE_REF` cannot be seen from the repo (1.3.8).
11. **AGENTS.md, README.md** and script comments say things the lifecycle replaces (1.12); a reviewed change is needed.
12. **Token validity.** Whether a revoked session's access token can still be used is unproven and depends on the Supabase JWT expiry setting; the owner must accept a wait-out period or require immediate rejection (1.4.5, 2.4).
13. **PR #22 independent review.** Records still list parts as open (1.1.13).

## Known documentation drift to fix when the owner allows

* [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) carries an 8 October state paragraph and the earlier "create a separate production project" flow.
* [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) "Open items" is stale, and the dashboard still names the project "DCMUN Staging".
* [DEPLOYMENT.md](DEPLOYMENT.md) "Environments" still calls Preview-variable removal a separate owner decision; the owner has done it (21 Oct). Its "Rollback" text does not yet require the checks in 1.10.5, and its cutover order differs from the lifecycle (conflicts 2 and 3).
* `scripts/verify-deployment.mts` checks `/projector`, a retired feature.
* Several scripts (`verify-submission-http`, `verify-stale-conflicts`, `remote-integration`, `remote-workflow`, `load-test`) rely on the former development seed (`supabase/fixture-ids.json`, `.test-sessions/*`) and a hard-coded `http://localhost:3001`; they have not been shown to work against the current project.
