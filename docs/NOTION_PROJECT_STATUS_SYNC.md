# Free Notion project-status sync — setup and operational guide

This optional GitHub Actions workflow updates the Notion Free **Academics → Projects → GitHub Projects** database for the six tracked projects (excluding PHESMUN OS and Pseudocode Lab), without changing MUNOS production or infrastructure.

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

1. The owner has created a **Notion personal access token** under [Notion Developer tools → Personal access tokens](https://app.notion.com/developers/connections), selected `zuhayr's space`, and stored it as `NOTION_PROJECTS_API_KEY` in MUNOS Actions secrets. This setup was reported by the owner; **the credential itself has not been tested**.
2. A personal access token uses its owner's existing Notion access. **Do not attempt to add the built-in GitHub sync connection** or the custom developer connection to this database when using this personal-token setup.
3. Make sure the token is allowed to use the **Notion API** and can **read/update content** in this workspace. Personal tokens can have broader access than a connection explicitly shared to a single database, so protect or rotate the secret carefully.
4. For a narrowly scoped alternative, create an **internal API connection**, explicitly grant it access to the GitHub Projects database, and replace the Actions secret with its integration token. The internal-connection setup is **optional**, not required for the currently selected personal access token.

### B. Confirm the database and repository mappings

5. Open the [GitHub Projects database](https://app.notion.com/p/ff4ef53c5fdd4699a49e8481381b3091). It currently has **six** tracked rows with GitHub repository URLs. Do not put API tokens inside Notion.
6. The workflow uses Notion data source ID `e93b5f0c-d10b-4907-8b55-5cc2589c4542`, already defined in its YAML. **Do not create a NOTION_DATA_SOURCE_ID secret.**

### C. GitHub secrets in one repository

7. Open [MUNOS Actions secrets](https://github.com/zhrsidd/MUNOS/settings/secrets/actions). The only required Notion secret name is **NOTION_PROJECTS_API_KEY**; its value must be the **new personal access token**, replacing any earlier internal-connection token. The owner reports this was done.
8. **PROJECT_SYNC_GH_TOKEN** is a fine-grained read-only GitHub token allowing this MUNOS workflow to fetch other project repos, including private PhysicsWeekly. The owner reports this secret was also added. No secrets or workflows need to be installed in the six target repositories.
9. If creating/rotating the GitHub token, select only **MUNOS, PhysicsWeekly, CourseScope, DeutschLab, FormulaSnap, dcmun_delegates_site** under repository access; grant read-only **Metadata, Contents, Issues, Pull requests, and Actions** permissions. Do not select PHESMUNOS or CIEPseudocodeEditor. Do not use a broad classic token.
10. Secret names can be viewed on GitHub, but **their values cannot be read back**. Authentication is only proven by a successful Actions run.

### D. Keep scheduled writes off until verified

11. The workflow is **fail-closed for scheduled runs** until a repository **Actions variable** named `NOTION_PROJECTS_SYNC_ENABLED` is set to the exact string `true`. When the variable is absent or `false`, scheduled jobs are skipped.
12. During initial activation **leave this variable absent or false**. Manual `workflow_dispatch` runs remain available even while the schedule is gated.
13. After the first successful live sync, open [MUNOS Actions variables](https://github.com/zhrsidd/MUNOS/settings/variables/actions), choose **New repository variable**, set **Name** = `NOTION_PROJECTS_SYNC_ENABLED`, **Value** = `true`, and save. This enables subsequent scheduled updates.

### E. Review, test and activate

**Regression tests (no secrets or network required):** `node --test tests/notion-project-status-sync.test.mjs`. The workflow runs these before calling the real APIs. Coverage includes invalid/malformed URLs, continued processing of subsequent rows, dry-run with zero Notion writes, private-repository access failures, stale/pending CI, and paginated CI results.



14. Review and approve [PR #107](https://github.com/zhrsidd/MUNOS/pull/107) under MUNOS's normal review process. It changes only the sync script, the workflow and this guide. A merge to `main` may invoke existing deployment checks, but **scheduled Notion writes are now disabled** until the Actions variable is `true`.
15. Merge only after the PR's required reviews/checks pass. On MUNOS `main`, open **Actions → Notion project status sync → Run workflow**; leave **Preview without modifying Notion?** checked (true). GitHub manual dispatch requires the workflow on the default branch.
16. Inspect the job summary and logs. A successful **preview** should report `Previewed 6 of 6 project rows; 0 skipped, 0 errors.` It must not change Notion. A missing private repo is an **error**, not a silent skip.
17. With the same workflow, **Run workflow** again with the preview checkbox **unchecked** (false). Confirm `Updated 6 of 6 project rows; 0 skipped, 0 errors.` Then open the Notion database and verify current **Last Synced**, **Open PRs**, **Open Issues**, **Last Commit**, and **CI** properties.
18. Only **after step 17** set the repository Actions variable `NOTION_PROJECTS_SYNC_ENABLED` to `true` as in step 13. Scheduled runs then happen around **06:17 Qatar time**, subject to GitHub's best-effort scheduler.
19. CI is conservatively calculated from **push-triggered GitHub Actions runs for the latest default-branch SHA**. The script paginates matching results and excludes scheduled administrative workflows (including the frequent Codex merge gate), so those runs cannot obscure genuine CI. A failed run shows `Failing`; an untested commit, unfinished/non-success run, missing workflow history, or incomplete API response shows `Unknown`. Repositories without push-triggered Actions checks may therefore show `Unknown` even if they have external CI.

### F. Disable or rotate access

- To pause scheduled writes without disabling manual previews: set `NOTION_PROJECTS_SYNC_ENABLED` to `false` or delete that repository variable. Alternatively disable the workflow under **Actions → Notion project status sync → ••• → Disable workflow**.
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
- Scheduled job skipped: the variable `NOTION_PROJECTS_SYNC_ENABLED` is absent or not exactly `true` (intended before verification). If enabled but no runs appear, verify workflow is on the default branch and Actions scheduling is enabled.
- Missing status for a new repository: add a Notion project row with a GitHub URL.

## Ideas for a future iteration

1. Label GitHub issues by workstream and priority and link them from the Notion QA tracker.
2. Record the exact deployment SHA and reviewer approval separately from CI, without guessing release readiness.
3. Generate weekly summary digests from changed PRs and critical issues after authorising a channel.
4. Preserve all feedback on Notion until reviewed, and never automatically post raw sensitive student data into a public GitHub issue.
