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
   threads, Claude edits files to fix what is actionable. Claude cannot push and cannot resolve threads. A separate job
   checks the changed files, makes one `fix(review):` commit (at most three per PR), pushes it, requests a fresh Codex
   review with `@codex review` once per new head, and resolves Codex's own open threads. See "Write safety for repairs".
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
   - Require **only** those two checks. Cloudflare Pages and Workers Builds serve the separate `munos.pages.dev` preview and
     are intentionally not required merge checks.
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
     and Issues set to read and write. Only the `push` job uses it: it pushes the checked repair commit, which triggers CI,
     and posts `@codex review`, which Codex acts on. The job that runs Claude never sees it. Keep its scope minimal and
     never give it access to other repositories.
5. **Workflow token:** the gate reads `repos/{repo}/rules/branches/main` with the workflow's `GITHUB_TOKEN`. If that call
   returns 403, the gate fails closed and the run fails. Fix the repository's token permissions. Do not weaken the gate.
   This read has not been verified against the live API from the authoring environment.

## Write safety for repairs

Claude runs with a shell, so the safety of its edits cannot rest on instructions alone. The workflow keeps the push
credential out of its reach and checks the result before anything is pushed. `CLAUDE.md` tells Claude the same rules, but
the workflow enforces them even if Claude ignores `CLAUDE.md`.

1. **`repair` job (runs Claude).** It holds only the workflow token, with `contents: read`, `pull-requests: read` and
   `issues: write` (for `NEEDS_DECISION` comments). Without `pull-requests: write` Claude cannot resolve a human's review
   thread or dismiss a review, both of which the gate relies on. The job has no `id-token: write`, so the action cannot
   obtain the write-capable Claude App token, and the action is also given the workflow token explicitly.
   `CLAUDE_AUTOMATION_TOKEN` is never referenced in this job. Claude edits files only; the job collects the edits as a
   patch and uploads it. `git push` and the action's file-commit tools are also disallowed, as defence in depth.
   The action restores `CLAUDE.md`, `.claude`, `.mcp.json` and similar files from `main` and writes `.claude-pr/` before
   Claude runs, so the patch step drops every protected path from the patch with a `::warning::`. This filter is a
   convenience, not the guard: Claude has a shell in this job, so the next job does not trust it.
2. **`push` job (fresh runner).** It applies the patch to the reviewed commit and judges the result, not the patch headers.
   It is the real guard: a protected path that still reaches it is not dropped but refused.
   It reads every changed path from `git diff --cached --raw -z --no-renames`, so a rename counts as a delete plus an add
   and both paths are checked. It refuses the whole patch, with an `::error::` that names the path, on any of:
   - a protected path (table below), compared case-insensitively;
   - a symlink, a submodule, an executable file, or any file mode change;
   - a patch over 2 MB, a patch that does not apply cleanly (including paths outside the repository), or a checkout that is
     not the reviewed commit.
3. **Push.** Only after that check passes, one step holds `CLAUDE_AUTOMATION_TOKEN`. The job itself makes the single
   `fix(review):` commit, so Claude cannot choose the message that the three-repair cap counts. It confirms the branch is
   still at the reviewed commit, then pushes without force, so a moved branch fails closed.
4. **Threads.** After a successful push, the `push` job resolves the open review threads whose first comment was written by
   the pinned Codex App (matched by numeric ID, login and type, as the gate does). Human threads and impostors stay open.
   It resolves nothing if the thread query fails or there are more than 100 threads. Resolving does not decide anything:
   Codex's fresh review of the new head still has to come back clean before the gate clears it, and an unfixed finding is
   raised again as a new thread.

Protected paths (the `protected()` function in the `push` job; keep this table and `CLAUDE.md` in step with it):

| Path | Why |
| --- | --- |
| Any path with a segment starting with a dot: `.github/`, `.claude/`, `.mcp.json`, `.env*`, `.gitattributes`, `.gitignore` | Automation, agent configuration, secrets and git behaviour |
| `CLAUDE.md`, `AGENTS.md` at any depth | The instructions that steer Claude and Codex |
| `package.json`, every lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock*`), `vercel.json`, `next.config.*`, `eslint.config.*`, `tsconfig*.json`, `scripts/vercel-ignore-build.sh` | Dependencies, build, deploy and check configuration: supply chain, and the ability to weaken `verify`. `npm ci` prefers `npm-shrinkwrap.json` over `package-lock.json`, so every lockfile is protected |
| `supabase/`, `scripts/isolation-inventory/`, `lib/platform/target-guard.ts`, `config/project-lifecycle.json` | Schema, access control and production-target guards (the protected areas in `AGENTS.md`) |
| `docs/AGENT_AUTOMATION.md` | This document |

If a finding needs a change to one of these paths, Claude is told to change nothing and comment `NEEDS_DECISION:`. The
owner decides.

Residual risks:

- The `repair` job's token can still write issues, so Claude can post a comment (a misleading one, for example). The gate
  does not read comments as clearance.
- After any successful push, every open Codex thread is resolved, including one that Claude chose not to fix. Codex's next
  review of the new head decides: an unfixed finding comes back as a new thread and blocks the gate.
- The check is path-based. It does not judge whether an allowed change is correct; Codex's review and `verify` do.
- The workflow files themselves still come from the pull request head, as for any pull request (see the bootstrap trust
  limits). Someone with write access can edit this guard in a PR, so changes under `.github/` need the owner's review.
- Not proven live: that the action runs with the read-only token and the tool list in `claude_args`, and that it cannot push
  with it. The action's documentation does not say how it pushes, so the guarantee rests on the token and permissions,
  not on the action's internals. Run the acceptance test before relying on this.
- `git add -A` in the `repair` job collects whatever the action or `npm` writes into the checkout. A stray file under a
  protected path, such as a `.claude/` file, would make every repair fail closed. That is safe but would stop the feature
  working, so check the patch artifact's file list on the first live run.

## One-time bootstrap (before the gate is on main)

The workflows read the gate from `main`. Until this pull request merges, `main` has no gate, so both workflows fail closed.
A bootstrap lets this pull request supply the gate from its own head, under three conditions, and only once:

1. The repository variable `CODEX_GATE_BOOTSTRAP_PR` is set to the pull request number (`79`).
2. The repository variable `CODEX_GATE_BOOTSTRAP_TREE` is set to the git tree of `.github/scripts` at the commit the
   owner has reviewed. Any later change to the gate changes the tree, and the workflow refuses to run.
3. `main` still lacks `.github/scripts/codex-review-gate.sh`. Once main carries the gate, the head path is unreachable.

Verification steps for the owner, in order:

1. Confirm the reviewed tree: `git rev-parse <reviewed-commit>:.github/scripts`. Set both variables under Settings →
   Secrets and variables → Actions → Variables. Variables are not secrets, but the owner should still set them.
2. Confirm the secrets exist: `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_AUTOMATION_TOKEN`. The repair workflow reads only
   these, and no workflow reads `ANTHROPIC_API_KEY`. A secret's value cannot be read back from the repository, so the
   OAuth token is proven only by a repair run that authenticates.
3. Confirm the `main` ruleset requires `verify` and `codex-review-gate`, and that auto-merge is enabled.
4. Keep the pull request as a draft. Let the gate run on the head, and check that `evaluate` reports the gate
   status without enabling auto-merge. Then check that the merge workflow still refuses while the PR is a draft.
5. Do not mark the PR ready or merge it until steps 1–4 pass and the owner approves the merge.

After this pull request merges, delete `CODEX_GATE_BOOTSTRAP_PR` and `CODEX_GATE_BOOTSTRAP_TREE`. The head path in
`stage-gate.sh` then has no effect. Remove that path in a follow-up change so no bootstrap code remains.

Trust limits of the bootstrap: the workflow files still come from the pull request head, as they do for any pull
request. The workflow checks the pinned tree before it runs any script from the head, so editing the staging script
cannot skip the check. The pinned tree stops drift in the gate scripts after review. It does not stop someone with write access
from editing the workflows, which is the trust model the rest of this document already assumes.

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
- Bootstrap staging: `bash .github/scripts/test/stage-gate.test.sh` and `bash .github/automation-tests/stage-step.test.sh`
  (the second runs each workflow's real staging step).
- Repair write safety: `bash .github/automation-tests/repair-push.test.sh` runs the `push` job's real check and push steps
  against a local bare repository. It covers an edit in every protected class, renames, deletions, symlinks, submodules,
  executable bits, path traversal, an oversized patch, a moved branch, pushing to `main`, and ordinary edits that must still
  go through. `bash .github/automation-tests/repair-resolve.test.sh` runs the thread-resolution step against a fake `gh`:
  only Codex's own open threads are resolved. `bash .github/automation-tests/repair-rereview.test.sh` runs the re-review
  request against a fake `gh` that serves a stale pull request head, as GitHub does for a moment after a push: a push that
  created a commit yields exactly one `@codex review` for that commit, and nothing else yields one. The push step reports the
  pushed commit and the request uses it, because reading the pull request's head right after a push once skipped the
  request. `bash .github/automation-tests/repair-patch.test.sh` runs the patch step in a
  workspace that looks like the action left it: protected paths are dropped and real edits kept.
  `bash .github/automation-tests/repair-invariants.test.sh` checks that the job
  running Claude holds no push credential or pull-request write access, that no job can request an OIDC token, and that only
  the guarded steps use the push token. Each suite was mutation-tested: weakening the guard makes the matching cases fail.
- Workflow syntax and expressions: `actionlint .github/workflows/*.yml`.

## Acceptance test (required before enabling for real work)

Use a disposable same-repository PR, not a production change.

1. Codex posts `COMMENTED` findings on the current head. Claude pushes `fix(review):` commits and resolves the threads it fixed.
2. Codex re-reviews the new head with no findings. `verify` passes. Auto-merge squash-merges into `main`.
3. With an unresolved human thread open, the PR must not merge, and auto-merge must not be enabled.
4. Enabling auto-merge, then pushing a new commit, must cancel auto-merge.
5. A fourth repair request must post `NEEDS_DECISION` and stop.
6. Confirm `main` and the hosted Supabase project were not changed by any run.
7. Make a Codex finding that can only be fixed by editing a protected path, such as `.github/workflows/ci.yml`. The `push`
   job must refuse the patch with an `::error::` naming the path, nothing may be pushed, and Claude should have commented
   `NEEDS_DECISION:`.
8. In the `repair` run, confirm Claude's own attempts to push (if any) fail, and that the action authenticates with
   `CLAUDE_CODE_OAUTH_TOKEN` and the read-only workflow token.
9. Open the `repair-patch` artifact on the first live run and check its file list contains only the intended edits.
10. Leave a human review thread open during a repair. After the push, only Codex's threads must be resolved, and the
    human thread must still be open.
