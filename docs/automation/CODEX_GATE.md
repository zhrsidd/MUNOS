# Codex gate reconciliation

The gate keeps immediate PR, review, review-comment and trusted Codex summary events. Manual dispatch takes a string PR identifier, validates ASCII digits in GraphQL's positive signed-Int range, and normalizes leading zeros before any PR API call or concurrency grouping. Decimal identifiers such as `84.0` are rejected.

## Resolution detection

GitHub documents a [`pull_request_review_thread` webhook](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request_review_thread) with resolved/unresolved actions, but it is not a supported [Actions workflow trigger](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). No webhook receiver or additional credential is needed here. The existing workflow also runs at minutes 7, 17, 27, 37, 47 and 57 each hour.

Scheduled discovery paginates open PRs targeting main and excludes drafts, forks and deleted head repositories. Each candidate runs the same evaluator as events. Checkout and executable scripts always come from main; no PR-head code is executed. Every evaluation re-reads the current head, pinned Codex App summary, review standing, all review threads and main's required checks/protection. A clean summary alone cannot clear unresolved threads, missing required checks or another reviewer's change request.

## Concurrency and failure handling

Selection produces normalized integer matrix entries. Scheduled and event jobs share `codex-merge-gate-<number>` with cancellation disabled. Each queued evaluation reads fresh data after acquiring the lock; it never carries a discovery-time decision forward. GitHub may replace a pending job with a newer pending job; both read current state. No secondary workflow dispatches or recursive status triggers are generated.

The head is checked before status publication and again before auto-merge; enabling also uses `--match-head-commit`. A status is always attached to the evaluated SHA, never copied to a new SHA. GitHub required checks protect a newly pushed head. Identical existing gate statuses are not reposted; existing auto-merge enablement is not repeated. Failure cleanup attempts a failing status on the current head and cancels auto-merge. Errors in either cleanup operation are surfaced explicitly.

Actions summaries list blocking reasons. Pending reviews, outstanding findings, unresolved Codex/human threads and missing repository requirements remain blocking. Invalid input fails selection before a PR lookup. API/evaluation errors and enable/cancel errors fail the job with diagnostics.

## Limits and safe verification

Schedules execute only after this workflow lands on the default branch. GitHub can delay scheduled runs; ten minutes is the configured frequency, not an SLA. All eligible PRs are re-read, including green ones, to detect reopened threads or dismissed reviews; API cost grows with eligible PR count and conversation pagination. Complete API/authentication outages can prevent revoking a previously published status or cancelling existing auto-merge; the job reports this for owner intervention. GitHub does not provide an atomic transaction covering review state, status publication and auto-merge; native protection and required statuses remain essential.

Offline tests exercise valid/invalid dispatch values, existing event payloads, discovery eligibility, API failure, thread-resolution transitions, stale heads, shared concurrency and guarded enabling. Live branch dispatch on a draft verifies normalization without permitting merge. Read-only live discovery validates the scheduled selector without evaluating or modifying production-impacting PRs. A real cron-triggered recovery cannot be verified before merge to main.
