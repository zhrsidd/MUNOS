# Claude–Codex review automation (pilot)

This pilot automates review repairs and opt-in GitHub auto-merge into `main`. It does **not** deploy production or access hosted Supabase.

## Prerequisites (owner/admin)

1. Configure Codex GitHub automatic PR review for this repository. The reviewer must submit a **formal GitHub APPROVED or CHANGES_REQUESTED review**, not merely a comment. If the Codex integration only comments, use a separate trusted review adapter; do not spoof approval.
2. Set repository variable `CODEX_REVIEWER_LOGIN` to the exact authenticated GitHub login of that reviewer.
3. Configure `main` branch protection/ruleset: require CI's `verify` check, dismiss stale approvals on new commits, require a review, disallow bypass for automation and prohibit force pushes. Confirm auto-merge is enabled in repository settings.
4. Install and authorize Claude Code GitHub Action. Set `ANTHROPIC_API_KEY` and a least-privilege `CLAUDE_AUTOMATION_TOKEN` with permission to push PR branches and comment. Verify billing, permissions and supported authentication with the provider.
5. Restrict workflow edits and credential access to trusted maintainers. Do not run untrusted fork code with write credentials.

## Behaviour

- Codex requests changes on the **current PR head**: Claude attempts repair and commits with `fix(review):`.
- A new commit invalidates the old review; Codex must review the new SHA.
- At most three repair commits are permitted. A fourth repair attempt fails and posts NEEDS_DECISION.
- Codex formally approves the current head: auto-merge is enabled only if `main` protection is accessible. GitHub enforces required CI and branch rules before merging.
- A decision or blocked state needs a human; the workflows do not make product decisions.
- No production branch mutation, hosted database operation, or release is performed.

## Limitations and validation

These files alone do **not** establish that Codex automatically re-reviews every push or that Claude can authenticate and push. Both integrations must be configured and tested. `workflow_dispatch` can re-evaluate a PR manually if its approval arrived before the workflow was installed. GitHub Actions event/actor permissions and repository rules may prevent triggering or merging; investigate rather than weakening protections.

Acceptance test: open a disposable same-repo PR, obtain Codex CHANGES_REQUESTED on its current SHA, observe Claude's fix commit, observe a fresh Codex APPROVED review, verify CI green and automatic squash merge to `main`. Verify a failing CI check prevents merge. Verify production branch stays unchanged. Test stale review, three-repair cap and missing secrets as negative cases before enabling for real work.
