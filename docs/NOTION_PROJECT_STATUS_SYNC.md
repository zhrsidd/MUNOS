# Free Notion project-status sync — setup and operational guide

This activated GitHub Actions workflow updates the Notion Free **Academics → Projects → GitHub Projects** database for the six tracked projects (excluding PHESMUN OS and Pseudocode Lab), without changing MUNOS production or infrastructure.

- [Projects home](https://app.notion.com/p/40dd6f67939b8189811ad3755792d632)
- [Projects database](https://app.notion.com/p/ff4ef53c5fdd4699a49e8481381b3091)
- Data source ID: e93b5f0c-d10b-4907-8b55-5cc2589c4542
- Workflow: .github/workflows/notion-project-status.yml
- Script: scripts/notion-project-status-sync.mjs

## What changes automatically

Daily at **06:17 Qatar time / 03:17 UTC**, or on manual Actions dispatch:
- Open PR count, open issue count, latest default-branch commit SHA
- Push-triggered GitHub Actions CI runs for the latest default-branch commit, classified as Passing, Failing or Unknown; scheduled administrative workflows are intentionally excluded
- Last Synced timestamp
- Per-row validation of GitHub repository URLs: malformed or non-GitHub URLs fail that row, log its Notion page ID, and **do not stop subsequent projects**. Any such errors make the overall run fail; blank GitHub fields remain skipped

The workflow updates **existing project rows only**. It explicitly skips `zhrsidd/PHESMUNOS` and `zhrsidd/CIEPseudocodeEditor`, even if their Notion cards are restored later. It does not change project Stage, Summary, Needs Attention, feedback, checklists, issues, deployments, production settings or secrets. New repositories need to be entered into the Notion database first. A merged PR is not an automatic release approval.

## Precise one-time setup (Notion Free + GitHub)

### A. Notion API authorization — current setup

1. The owner has created a **Notion personal access token** under [Notion Developer tools → Personal access tokens](https://app.notion.com/developers/connections), selected `zuhayr's space`, and stored it as `NOTION_PROJECTS_API_KEY` in MUNOS Actions secrets. The token was successfully exercised by the authenticated preview and live sync on 3 November 2026.
2. A personal access token uses its owner's existing Notion access. **Do not attempt to add the built-in GitHub sync connection** or the custom developer connection to this database when using this personal-token setup.
3. Make sure the token is allowed to use the **Notion API** and can **read/update content** in this workspace. Personal tokens can have broader access than a connection explicitly shared to a single database, so protect or rotate the secret carefully.
4. For a narrowly scoped alternative, create an **internal API connection**, explicitly grant it access to the GitHub Projects database, and replace the Actions secret with its integration token. The internal-connection setup is **optional**, not required for the currently selected personal access token.

### B. Confirm the database and repository mappings

5. Open the [GitHub Projects database](https://app.notion.com/p/ff4ef53c5fdd4699a49e8481381b3091). It currently has **six** tracked rows with GitHub repository URLs. Do not put API tokens inside Notion.
6. The workflow uses Notion data source ID `e93b5f0c-d10b-4907-8b55-5cc2589c4542`, already defined in its YAML. **Do not create a NOTION_DATA_SOURCE_ID secret.**

### C. GitHub secrets in one repository

7. Open [MUNOS Actions secrets](https://github.com/zhrsidd/MUNOS/settings/secrets/actions). The only required Notion secret name is **NOTION_PROJECTS_API_KEY**; its value must be the **new personal access token**, replacing any earlier internal-connection token. The owner reports this was done.
8. **PROJECT_SYNC_GH_TOKEN** is a fine-grained read-only GitHub token allowing this MUNOS workflow to fetch other project repos, including private PhysicsWeekly. The six-repository authenticated preview succeeded using the configured GitHub token. No secrets or workflows need to be installed in the six target repositories.
9. If creating/rotating the GitHub token, select only **MUNOS, PhysicsWeekly, CourseScope, DeutschLab, FormulaSnap, dcmun_delegates_site** under repository access; grant read-only **Metadata, Contents, Issues, Pull requests, and Actions** permissions. Do not select PHESMUNOS or CIEPseudocodeEditor. Do not use a broad classic token.
10. Secret names can be viewed on GitHub, but **their values cannot be read back**. Authentication is only proven by a successful Actions run.

### D. Enabled schedule and preview-first protection

11. **Activated on 3 November 2026.** The daily schedule is now enabled in `.github/workflows/notion-project-status.yml`. The former `NOTION_PROJECTS_SYNC_ENABLED` repository variable is no longer used or required.
12. Each scheduled run performs the syntax check, six regression tests, and a **read-only preview of all tracked projects before writing**. If preview fails, the subsequent live-refresh step never runs.
13. Manual runs remain available through **Actions → Notion project status sync → Run workflow**; the preview option is checked by default. Unchecking it runs the validation preview followed by live updates. A workflow-file-only `push` trigger was used to bootstrap and verify activation; unrelated application pushes do not trigger the sync.

### E. Verified activation and troubleshooting

**Regression tests:** `node --test tests/notion-project-status-sync.test.mjs`. The workflow runs them automatically before accessing either API. They cover malformed URLs, subsequent-row recovery, dry-run safety, private-repository access failures, pending/stale CI, and paginated results.

14. [PR #107](https://github.com/zhrsidd/MUNOS/pull/107) was merged on 3 November 2026. The first [authenticated preview run](https://github.com/zhrsidd/MUNOS/actions/runs/41612284225) succeeded: **6 of 6 projects, 0 skipped, 0 errors**. No Notion rows were modified during this preview.
15. The subsequent [live activation run](https://github.com/zhrsidd/MUNOS/actions/runs/41612425793) also succeeded, with `Previewed 6 of 6 ... 0 errors` followed by `Updated 6 of 6 ... 0 errors`. All six Notion rows were independently confirmed to have refreshed `Last Synced`, `Open PRs`, `Open Issues`, `Last Commit` and `CI`.
16. Future automated runs occur at approximately **06:17 Qatar time (03:17 UTC)**, subject to GitHub's best-effort scheduler. Check **Actions → Notion project status sync** if updates seem late or a row reports an error.
17. CI evaluates **push-triggered GitHub Actions runs for the latest default-branch commit**, excluding high-frequency scheduled administration. Untested commits, incomplete Actions history, or pending/non-success checks may legitimately display `Unknown`.

### F. Disable or rotate access

- To pause automatic synchronization: open GitHub **Actions → Notion project status sync → ••• → Disable workflow**. This pauses manual runs too; select **Enable workflow** to resume. The old `NOTION_PROJECTS_SYNC_ENABLED` variable does not affect this activated workflow.
- To revoke Notion writes: delete or rotate **NOTION_PROJECTS_API_KEY** in repository secrets. For an internal connection, also remove its database access; for a personal token, revoke it under Notion Developer tools → Personal access tokens.
- If the fine-grained GitHub token expires, create a new token with the same **read-only / six-repository** scope and replace **PROJECT_SYNC_GH_TOKEN**.
- PHESMUNOS and CIEPseudocodeEditor are explicitly excluded by the script even if their old Notion cards are restored.

## Costs and limits

- Notion Public API works on Free; Business-only managed GitHub sync is not used.
- Standard GitHub-hosted runners on public repositories are free; MUNOS is public.
- Free Notion API connections have per-connection and workspace rate limits. This script paginates, writes sequentially, and honours 429/529 Retry-After.
- A manual reviewer still approves production readiness, security changes, sensitive feedback, and external release communications.

## Troubleshooting

- Notion 401: inspect connection token and Actions secret.
- Notion 403 / 404: for the selected personal access token, check workspace, API capability and user permissions on the Projects database; for an internal connection, check that the integration was explicitly shared to the database.
- Private repository access failure: the run now fails; check the fine-grained token's selected repositories and read permissions.
- Invalid GitHub repository URL: inspect the affected Notion page ID in the warning, correct that row's GitHub property to `https://github.com/OWNER/REPO`, then rerun. Other valid project rows continue updating; the run exits nonzero so errors cannot pass silently.
- CI Unknown: no push-triggered Actions check on the latest default-branch SHA, an unfinished/non-success run, insufficient Actions permissions, unavailable history, or an incomplete API response. Scheduled/manual-only and third-party checks are not counted as passing push CI.
- Scheduled run missing or skipped: ensure the workflow is enabled on `main` and Actions scheduling is enabled; GitHub cron is best effort and may be delayed.
- Missing status for a new repository: add a Notion project row with a GitHub URL.

## Ideas for a future iteration

1. Label GitHub issues by workstream and priority and link them from the Notion QA tracker.
2. Record the exact deployment SHA and reviewer approval separately from CI, without guessing release readiness.
3. Generate weekly summary digests from changed PRs and critical issues after authorising a channel.
4. Preserve all feedback on Notion until reviewed, and never automatically post raw sensitive student data into a public GitHub issue.
