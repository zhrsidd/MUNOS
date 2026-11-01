# Full Claude handoff — MUNOS / DCMUN Conference OS

**1 November 2026 update:** The operator reports the single hosted project has been promoted to Production and the real conference shell created. GitHub confirms the release SHA and CI; see the [activation record](cutover/2026-11-01/EXECUTION.md). Earlier development, staging and rehearsal directions below are historical for this project. Do not reconnect cloud agents, run hosted rehearsals, or use synthetic fixtures on Production.

Updated 20 October 2026 against the owner's supplied **MUNOS repository analysis — 20 October 2026** from “continued consult”. This package updates documentation only. It does not authorise a merge, hosted migration, resource purchase, production configuration change or deployment.

## Status update — 20 October 2026, after this package was written

Recorded when the package was added to the repository; it supersedes the dated observations below where they differ.

- **PR #22 merged** to `main` as `852642c`, on the owner's authorisation; `main` CI was green. Its 21 committed migrations (18 earlier plus the 3 in PR #22) were applied once, in order, with the Supabase CLI to the single DCMUN project `kllhswucdhqqywnzxado`. The ledger matches the filenames, and the live schema fingerprint matches a local rebuild. Live RLS, grants, anonymous sign-in, access-code redemption and RPC permissions were verified. A labelled test conference exists. Evidence: [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md).
- **One project, not separate staging and production.** The deleted development project is gone. `kllhswucdhqqywnzxado` is the development target until early November and then becomes production ([single-project cutover](DEPLOYMENT.md#single-project-cutover)). The PR #22 gate's "disposable staging" replay and staging rollback rehearsal therefore run against the future production database while it holds only test data; see the note in the [gate](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate).
- **Graphify** indexed `main` at `852642c` (verified with `graph_stats`). Spot checks found `lib/sync/backoff.ts`, the approval-history symbols (`decisionFor`, `DocumentDecision`, `decisionLabel`) and the point-adjustment symbols (`adjustmentTotal`, `AdjustmentHistory`). Later merges re-index automatically; check `graph_stats` for the covered commit. Handoff context was added as Graphify workspace memory and awaits acceptance in Memory → Needs review.
- **Still open from this package:** independent (Codex) review of PR #22's protected areas and of the target-guard change; the sync/browser acceptance items in the PR #22 gate; the 110-device, 19-committee rehearsal; release approval. Owner priority 1 (Google Docs-only submissions) is in progress; see [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md).

## Current baseline and reading order

The supplied review records `main` at `d651d97`, open [PR #22](https://github.com/zhrsidd/MUNOS/pull/22) with 118 changed files, and a [passing CI run](https://github.com/zhrsidd/MUNOS/actions/runs/39406429300). These are **dated review observations**, not a fresh check of GitHub. Recheck the PR head/base, review disposition and CI on the exact candidate before acting. Branch implementations are not established `main` or production behavior.

Read the repository's root `AGENTS.md` first, then [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md), [UI_OVERHAUL.md](UI_OVERHAUL.md), [BRAND.md](BRAND.md) and [SESSION_MODEL.md](SESSION_MODEL.md). Use [BACKLOG.md](BACKLOG.md) for remaining scope. For PR #22 acceptance, read the [migration and sync gate](REVIEW_APPROVAL_DECISIONS_AND_ADJUSTMENTS.md#pr-22--staging-migration-and-sync-acceptance-gate). Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for releases. [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) is the current status-by-status v1 checklist (verified, outstanding, owner-approval gates and release blockers). [HANDOFF_REVIEW.md](HANDOFF_REVIEW.md) records coverage, changes and the complete original file inventory.

The archive keeps the uploaded flat layout. Its original documents normally live under `docs/` in MUNOS. Root `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONFERENCE_RUNBOOK.md`, application source, scripts, migrations and ignored verification artifacts are **not included**. Links to those files require the checkout. Do not replace the whole repository or its governance files with this document-only ZIP.

## Engineering governance

The repository's `AGENTS.md` is authoritative: **Claude is primary engineer across the whole application**, including schema/migrations, RLS, sync, reliability and platform work; **Codex supplies independent review, verification and specialist support**. Authorship is not an ownership restriction. Serialize shared architecture under one named integration owner and independently review protected changes; nobody self-approves their own protected work.

Zuhayr Siddique decides product scope; John Paul Ribeiru approves releases; Zuhayr leads live conference incidents. Keep the existing production, secrets, committed-migration, authorization and durable-outbox safeguards. Do not widen permissions or bypass the outbox to make a staging test pass.

## Shared agent context and Graphify

Use the MUNOS clone (`zhrsidd/MUNOS`) as the shared source of truth for local and cloud work. Keep engineering policy in root `AGENTS.md`, with `CLAUDE.md` pointing to it and retaining its Graphify guidance. Keep decisions, status and verification evidence in the linked tracked roadmap documents; do not create separate competing copies in agent memory, old ChatGPT mirrors or an Obsidian vault. Obsidian may be an optional reader, never a prerequisite or a second policy source. Local App/CLI and cloud work should name their checkout branch and commit; they do not share an automatic live working tree.

The supplied review says Graphify indexes **`main` at `d651d97`**, not PR #22. Use Graphify for symbols, callers, dependencies, impact and test discovery when its indexed revision covers the question. For newer PR code, inspect the actual branch/diff and identified files; never treat a stale graph as evidence that new code is absent. If Graphify is unavailable or stale, record that limitation and use focused reads/searches.

**After an authorised PR #22 merge**, update a clean local checkout to the resulting `main` commit and refresh Graphify using the installed integration's supported indexing workflow. Record the indexed commit and verify it equals the merged commit; spot-check new sync/backoff, approval-history and point-adjustment symbols/dependencies. If more commits land, record which revision the graph actually covers. Updating the graph is follow-up work, not something completed by this handoff edit. Do not invent an indexing command or use Graphify as a source of product approval.

## Status and scope boundaries

- The session model remains **draft, unimplemented and not approved for schema work**. PR #22 approval does not approve it. Keep the four proposed timing settings unconfirmed, its separate contract/test/sign-off gate, and approved-but-deferred optional queue clearing.
- Contribution-ranked Participation and net-points Debate ranking remain distinct. Preserve original score events, audited adjustments/restores and exactly-once behavior.
- Keep all current owner UI requests and priorities, including Google Docs-only new submissions, passed-amendment history, global visual cleanup, general clear-majority voting, configurable credits, Chair-school photo matching, Felix, About/parity and restrained loading/motion. Local implementation evidence is not authenticated staging acceptance.
- Do not restore Drive mirroring, award discussion, projector functionality or the removed SC/HSC clause-by-clause / informal P5-outcome proposal. Preserve historical records, ordinary working-Doc links and the local speaker timer. Existing retirement checks remain pending where their source document says so.
- Historical reports retain their original evidence, counts and decisions. Their old feature deferrals, authorship labels, environments and 50-device load assumptions do not override the active roadmap, current governance or current release gate. The October 16 incident is PHESMUN history used to explain MUNOS reliability work, not authority to access PHESMUN production.

## Production isolation and controlled release

Keep Preview/staging on explicitly allowed non-production Supabase targets. PHESMUN production is forbidden for MUNOS. Preserve the exact expected-production-project guard, server-only secrets and development/production separation. Existing “no production project/deployment” statements are dated documentation snapshots; no known-good MUNOS release is established by this package.

Finish PR review and authenticated staging acceptance, including migrations, sync, scoring, permissions and rollback compatibility. The conference-week Pro/Small **110-device, 19-committee** rehearsal remains a separate release gate. Obtain the owner's organisation/cost approval before hosted resources or upgrades; obtain the recorded release approval before production changes. Release only the exact verified commit, with compatible migrations applied once under the reviewed release plan. Keep `main` and Production separate, record the known-good version and rollback path, and remember an app rollback does not undo database migrations.
