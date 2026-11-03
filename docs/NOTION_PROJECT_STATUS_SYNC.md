# Free Notion project-status sync — setup and operational guide

This optional GitHub Actions workflow updates the Notion Free **Academics → Projects → GitHub Projects** database for the seven tracked projects (excluding PHESMUN OS), without changing MUNOS production or infrastructure.

- [Projects home](https://app.notion.com/p/40dd6f67939b8189811ad3755792d632)
- [Projects database](https://app.notion.com/p/ff4ef53c5fdd4699a49e8481381b3091)
- Data source ID: e93b5f0c-d10b-4907-8b55-5cc2589c4542
- Workflow: .github/workflows/notion-project-status.yml
- Script: scripts/notion-project-status-sync.mjs

## What changes automatically

Daily at **06:17 Qatar time / 03:17 UTC**, or on manual Actions dispatch:
- Open PR count, open issue count, latest default-branch commit SHA
- Latest completed non-sync GitHub Actions result, classified as Passing, Failing or Unknown
- Last Synced timestamp

The workflow updates **existing project rows only**. It explicitly skips `zhrsidd/PHESMUNOS`, even if that Notion page is restored later. It does not change project Stage, Summary, Needs Attention, feedback, checklists, issues, deployments, production settings or secrets. New repositories need to be entered into the Notion database first. A merged PR is not an automatic release approval.

## One-time authorisation steps

1. In Notion **Settings → Connections**, enable Developer Mode if required and create an internal connection named **GitHub Project Status**. Give it read and update-content capabilities; no user-information capabilities.
2. Grant the connection access **only to the GitHub Projects database** via the page's Connections menu, not the whole workspace.
3. In GitHub **zhrsidd/MUNOS → Settings → Secrets and variables → Actions**, create secret **NOTION_PROJECTS_API_KEY** containing the internal connection token. Never put the token in commits, chats, issues or PRs.
4. For comprehensive access (including private PhysicsWeekly), create a fine-grained **read-only** GitHub token covering exactly the seven tracked repositories (explicitly **exclude PHESMUNOS**), and add it as **PROJECT_SYNC_GH_TOKEN**. Needed read permissions: repository metadata, contents, issues, pull requests and Actions. If you omit this token, the workflow uses its scoped built-in GITHUB_TOKEN; inaccessible private repositories are skipped.
5. Review and merge this draft PR under your normal MUNOS change-control process. The workflow is triggered by schedules or manual dispatch, never by pull requests.
6. Open **Actions → Notion project status sync → Run workflow**. The manual run defaults to **Preview without modifying Notion = true**. Inspect its output for errors or private repositories skipped (the logs deliberately avoid private repository names). Rerun with preview set to **false** to write the actual Notion values, then verify Last Synced, counts and CI.
7. Check its first scheduled run. GitHub schedules may be delayed; on inactive public repositories, scheduled workflows can be automatically disabled after 60 days.

## Costs and limits

- Notion Public API works on Free; Business-only managed GitHub sync is not used.
- Standard GitHub-hosted runners on public repositories are free; MUNOS is public.
- Free Notion API connections have per-connection and workspace rate limits. This script paginates, writes sequentially, and honours 429/529 Retry-After.
- A manual reviewer still approves production readiness, security changes, sensitive feedback, and external release communications.

## Troubleshooting

- Notion 401: inspect connection token and Actions secret.
- Notion 403 / 404: connect the integration to the Projects database and permit content updates.
- Private repository skipped: check fine-grained token repository selection and read permissions.
- CI Unknown: no completed run, insufficient Actions permissions, or unavailable history.
- Daily schedule missing: ensure workflow exists on default branch and Actions scheduling is enabled.
- Missing status for a new repository: add a Notion project row with a GitHub URL.

## Ideas for a future iteration

1. Label GitHub issues by workstream and priority and link them from the Notion QA tracker.
2. Record the exact deployment SHA and reviewer approval separately from CI, without guessing release readiness.
3. Generate weekly summary digests from changed PRs and critical issues after authorising a channel.
4. Preserve all feedback on Notion until reviewed, and never automatically post raw sensitive student data into a public GitHub issue.
