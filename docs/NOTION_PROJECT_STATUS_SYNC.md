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

## Precise one-time setup (Notion Free + GitHub)

### A. Make a Notion API connection

1. Open [Notion Developer connections](https://app.notion.com/developers/connections) directly in your web browser, logged into the account that owns the Notion workspace. Or open **Notion → Settings → Connections**, enable **Developer Mode** in Settings, and choose **Personal access tokens** in the developer sidebar. **Do not use Workspace → SSO/SAML/SCIM setup information**: those are identity-management settings, not the Notion content API.
2. Click **+ New connection**, name it **GitHub Project Status**, and select the same Notion workspace that contains the Academics → Projects page. You may need workspace-owner permission.
3. Give the connection permission to **read content and update existing pages**. Do not grant user-information access. Do not enable unrelated privileges.
4. Open **Connections**, locate the new connection, and use its **••• menu → Retrieve internal connection token** (or the token/secret field in its detail). Copy the token into a password manager for the next step. Keep it out of notes, issues, pull requests, code, and chat.

### B. Grant access to one database

5. Open [GitHub Projects](https://app.notion.com/p/ff4ef53c5fdd4699a49e8481381b3091) in Notion (the actual database, not the Projects landing page).
6. At the top right select **••• → More → Connections → Add connections**. Search for **GitHub Project Status**, select it, and approve the access prompt. The label may appear directly as **Connections** depending on layout.
7. Check the database is connected. Avoid granting access to Student OS or Academics as a whole, since those contain unrelated records.

### C. Store the Notion token securely on GitHub

8. Open [MUNOS Actions secrets](https://github.com/zhrsidd/MUNOS/settings/secrets/actions) (or GitHub repository → **Settings → Secrets and variables → Actions**).
9. In the **Secrets** tab choose **New repository secret**. Set **Name** to **NOTION_PROJECTS_API_KEY** and **Secret** to the Notion token from step 4. Click **Add secret**.
10. **Do not create a NOTION_DATA_SOURCE_ID secret.** The workflow already sets it to e93b5f0c-d10b-4907-8b55-5cc2589c4542. This ID is not secret.

### D. Optional: allow access to private PhysicsWeekly

11. Open GitHub **Profile → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
12. Set **Token name** to **Notion Projects Read Only**, **Resource owner** to **zhrsidd**, choose an expiration you will remember to renew, and **Repository access → Only select repositories**. Select these seven repositories: **MUNOS, PhysicsWeekly, CourseScope, DeutschLab, FormulaSnap, CIEPseudocodeEditor, dcmun_delegates_site**. Do **not** select PHESMUNOS.
13. Under **Repository permissions**, choose **read-only** for **Contents, Issues, Pull requests, and Actions**; **Metadata** read access is typically added automatically. No write permissions. Generate and copy the token.
14. Return to MUNOS **Settings → Secrets and variables → Actions → New repository secret**. Set **Name** to **PROJECT_SYNC_GH_TOKEN**, paste the fine-grained token as **Secret**, then click **Add secret**.
15. If you skip steps 11–14, the workflow falls back to GitHub's built-in token and may leave the private PhysicsWeekly row unsynced. Do not use a broad classic token.

### E. Review, test and activate

16. Review [draft PR #107](https://github.com/zhrsidd/MUNOS/pull/107) under the normal MUNOS release process. It changes only the synchronization script, GitHub Actions workflow, and documentation. **Do not merge without code/security review.** A merge to main may trigger your ordinary MUNOS deployment pipeline.
17. After approval, **merge PR #107**. In MUNOS open **Actions → Notion project status sync → Run workflow**. Leave the **Preview without modifying Notion?** checkbox **enabled** for the first run.
18. Open the workflow run, check that it completed and that the expected projects were visible. It must not write to Notion in preview mode. Troubleshoot any 401/403/404 errors before proceeding.
19. Choose **Run workflow** again and switch **Preview without modifying Notion?** to **disabled**. Check the [GitHub Projects table](https://app.notion.com/p/ff4ef53c5fdd4699a49e8481381b3091) for updated **Last Synced**, **Open PRs**, **Open Issues**, **Last Commit** and **CI** fields on the seven remaining cards.
20. The workflow then runs daily at approximately **06:17 Qatar time**. GitHub schedules are best effort, so check the Actions run history and Notion's Last Synced field if a refresh appears late.

### F. Disable or rotate access

- To pause: GitHub **Actions → Notion project status sync → ••• → Disable workflow**.
- To revoke Notion writes: delete or rotate **NOTION_PROJECTS_API_KEY** in repository secrets and disconnect the Notion connection from the GitHub Projects database.
- If the fine-grained GitHub token expires, create a new token with the same **read-only / seven-repository** scope and replace **PROJECT_SYNC_GH_TOKEN**.
- PHESMUNOS is explicitly excluded by the script even if its old Notion page is restored.

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
