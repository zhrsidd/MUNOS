# Claude–Codex review automation (pilot)

This pilot repairs Codex findings with Claude and enables auto-merge into `main` only when Codex's own review state is
clear for the current head. It does **not** deploy production, touch the production branch, or access hosted Supabase.

Status: **not yet proven end to end.** The decision logic and the shell wrapper are tested offline. The live loop
(Codex → Claude → Codex → merge) has not run against this repository. Run the acceptance test below before relying on it.

## How the loop works

1. **Codex reviews the pull request.** It posts a `COMMENTED` review with inline threads for each finding and keeps a
   summary comment whose machine-readable state (`codex-review-state:v1`) names the reviewed commit, the status and
   whether findings remain. When it finds nothing, it reacts with a thumbs-up instead of approving. So a clean head is
   read from that summary state, never from a single comment or reaction.
2. **`claude-review-repair.yml` (Claude repair).** After a Codex review on the current head that leaves unresolved Codex
   threads, Claude fixes what is actionable, commits with `fix(review):` (at most three such commits per PR), resolves the
   threads it fixed, and requests a fresh Codex review with `@codex review`, once per new head.
3. **`codex-reviewed-automerge.yml` (gate).** Enables squash auto-merge only when **all** of these hold:
   - the head branch is in this repository, the base is `main`, and the PR is not a draft;
   - Codex's summary is `completed` for the current head, with no findings and no unresolved findings;
   - no Codex security review reports unresolved findings on the current head;
   - no review thread from anyone is unresolved, and no reviewer's latest review requests changes;
   - a repository ruleset on `main` requires both the `verify` and `codex-review-gate` checks.

   It publishes the decision as a **`codex-review-gate` commit status** on the head. The ruleset requires that status, so
   GitHub itself blocks any head Codex has not cleared, even if a new commit lands before the workflow cancels anything.
   Otherwise it **cancels** auto-merge. Re-evaluation runs on PR open, new commits, marking ready, and Codex's reviews and
   summary updates.
4. **Identity.** Codex is trusted only as its GitHub App: numeric ID `199175422`, login `chatgpt-codex-connector[bot]`
   and type `Bot`, all together. Any other account with the same name, or a copy of Codex's summary text, is ignored.
   The ID is pinned in `.github/scripts/codex-review-gate.jq` and both workflows; the test checks all three agree.
5. **Gate logic comes from `main`.** Both workflows check out `.github/scripts` from `main` and run it from there, so a
   pull request cannot weaken the gate that merges it. A gate change takes effect only after it lands on `main`.

## Setup (owner or admin)

1. **Codex:** enable automatic pull request review for `zhrsidd/MUNOS` in the Codex settings for this repository.
2. **Ruleset on `main`:** create a repository **ruleset** (not classic branch protection). The gate reads rulesets with the
   workflow token; classic protection can only be read with administration access, which this design avoids.
   - Require the status checks **`verify`** (from `ci.yml`) and **`codex-review-gate`** (published by the gate; add it
     by name once the first gate run has reported it). The gate refuses to merge if either is missing.
   - Require pull requests before merging; block force pushes and deletions.
   - Add no bypass actors for automation.
   - Optional: require one human approval if the owner wants a person to approve every merge. The gate does not depend
     on approvals.
3. **Repository settings:** enable **Allow auto-merge**.
4. **Actions secrets** (secrets, not variables; no repository variable is needed):
   - `CLAUDE_CODE_OAUTH_TOKEN` for the Claude Code action (`claude_code_oauth_token` input). Create it by running the
     Claude Code OAuth token setup for the account that owns the Claude subscription, then paste the value into this
     secret. The action's documentation does not describe how to generate it, so confirm the procedure in the Claude Code
     docs before relying on it. The value is never printed in logs or documents. Remove any older `ANTHROPIC_API_KEY`
     secret once this one works, since the workflow no longer reads it.
   - `CLAUDE_AUTOMATION_TOKEN`: a fine-grained personal access token limited to `zhrsidd/MUNOS` with Contents, Pull requests
     and Issues set to read and write. It pushes repair commits, which trigger CI, and posts `@codex review`, which Codex
     acts on. Keep its scope minimal and never give it access to other repositories.
5. **Workflow token:** the gate reads `repos/{repo}/rules/branches/main` with the workflow's `GITHUB_TOKEN`. If that call
   returns 403, the gate fails closed and the run fails. Fix the repository's token permissions. Do not weaken the gate.
   This read has not been verified against the live API from the authoring environment.

## Behaviour and limits

- At most three `fix(review):` commits are created per PR. A fourth request posts `NEEDS_DECISION` and stops.
- A repair runs only for a review on the **current** head. A review for an older commit is skipped.
- Until the required `codex-review-gate` status exists on a head, GitHub blocks that head. A new PR therefore needs its
  first gate run before it can merge, which the `opened` trigger provides.
- Resolving the last open thread does not re-run the gate by itself. The next Codex summary update, a new commit, or a
  manual `workflow_dispatch` (input: pull request number) re-evaluates it. Until then auto-merge stays off.
- Human inline threads block auto-merge until resolved, even when they are not Codex's. A human must decide them.
- The gate never auto-merges on a comment, reaction or review alone; it always re-reads the structured state for the head.
- Changing the Codex App ID requires updating the three pinned copies together; the test fails until they agree.

## Tests

- Offline (also run by `codex-review-gate-tests.yml` on any change to the automation):
  `bash .github/scripts/test/codex-review-gate.test.sh`. It runs 15 decision cases against a snapshot of PR #79 captured
  from the GitHub API on 2026-10-29, plus the shell wrapper through a fake `gh`, plus the pinned-identity checks.
- Workflow syntax and expressions: `actionlint .github/workflows/*.yml`.

## Acceptance test (required before enabling for real work)

Use a disposable same-repository PR, not a production change.

1. Codex posts `COMMENTED` findings on the current head. Claude pushes `fix(review):` commits and resolves the threads it fixed.
2. Codex re-reviews the new head with no findings. `verify` passes. Auto-merge squash-merges into `main`.
3. With an unresolved human thread open, the PR must not merge, and auto-merge must not be enabled.
4. Enabling auto-merge, then pushing a new commit, must cancel auto-merge.
5. A fourth repair request must post `NEEDS_DECISION` and stop.
6. Confirm `main` and the hosted Supabase project were not changed by any run.
