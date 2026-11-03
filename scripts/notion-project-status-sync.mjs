// Free, read-only GitHub inventory -> Notion factual status fields.
// Requires NOTION_PROJECTS_API_KEY and NOTION_DATA_SOURCE_ID.
// Optional PROJECT_SYNC_GH_TOKEN grants read-only access to private repos.
// Never updates human-owned Stage, Needs Attention, Summary or feedback.

const notionToken = process.env.NOTION_PROJECTS_API_KEY;
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
const githubToken = process.env.PROJECT_SYNC_GH_TOKEN || process.env.GITHUB_TOKEN;
const dryRun = process.env.DRY_RUN === '1';
if (!notionToken || !dataSourceId || !githubToken) {
  throw new Error('Missing Notion Projects API key, data source ID, or GitHub read token.');
}

const notionHeaders = {
  Authorization: 'Bearer ' + notionToken,
  'Notion-Version': '2026-03-11',
  'Content-Type': 'application/json',
};
const githubHeaders = {
  Authorization: 'Bearer ' + githubToken,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonRequest(url, options = {}) {
  const { allowMissing = false, ...fetchOptions } = options;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, fetchOptions);
    if (response.ok) return response.json();
    if (allowMissing && [403, 404].includes(response.status)) return null;
    if ([429, 529].includes(response.status)) {
      const after = Number(response.headers.get('retry-after'));
      await sleep((Number.isFinite(after) && after >= 0 ? after : 2 ** attempt) * 1000 + 250);
      continue;
    }
    throw new Error('Request failed, HTTP ' + response.status + ', target ' + new URL(url).host);
  }
  throw new Error('API throttled repeatedly.');
}

function notion(path, method = 'GET', body) {
  return jsonRequest('https://api.notion.com/v1' + path, {
    method, headers: notionHeaders,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function github(path, allowMissing = false) {
  return jsonRequest('https://api.github.com' + path, {
    headers: githubHeaders, allowMissing,
  });
}

async function allProjectPages() {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const response = await notion('/data_sources/' + dataSourceId + '/query', 'POST', body);
    results.push(...response.results.filter((row) => row.object === 'page'));
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  return results;
}

function readRepositoryUrl(page) {
  const raw = page.properties?.GitHub?.url;
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Malformed GitHub repository URL in Notion project ' + page.id);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' ||
      parsed.search || parsed.hash) {
    throw new Error('Invalid GitHub repository URL in Notion project ' + page.id);
  }
  const match = /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(parsed.pathname);
  if (!match) {
    throw new Error('Invalid GitHub repository URL in Notion project ' + page.id);
  }
  return { owner: match[1], repo: match[2] };
}

async function countOpen(owner, repo, kind) {
  const query = 'repo:' + owner + '/' + repo + ' is:' + kind + ' is:open';
  const result = await github('/search/issues?q=' + encodeURIComponent(query) + '&per_page=1');
  return result.total_count;
}

// Only push-triggered runs represent default-branch CI here. In particular, scheduled
// administrative workflows (such as Codex's ten-minute merge gate) must not crowd
// successful build checks out of a 100-run API response.
async function latestCommitCiRuns(suffix, branch, commitSha) {
  const runs = [];
  let seen = 0;
  const perPage = 100;
  const maxPages = 10; // GitHub lists at most 1,000 matching workflow runs.

  for (let page = 1; page <= maxPages; page += 1) {
    const query = '?branch=' + encodeURIComponent(branch) +
      '&head_sha=' + encodeURIComponent(commitSha) +
      '&event=push&per_page=' + perPage + '&page=' + page;
    const response = await github(suffix + '/actions/runs' + query, true);
    if (!response) return { runs, complete: false };

    const pageRuns = response.workflow_runs ?? [];
    seen += pageRuns.length;
    runs.push(...pageRuns.filter((run) =>
      run.event === 'push' && run.head_sha === commitSha &&
      run.name !== 'Notion project status sync'));

    if (seen >= response.total_count) return { runs, complete: true };
    if (pageRuns.length < perPage) return { runs, complete: false };
  }

  // Fail closed if GitHub truncated an unusually large result set.
  return { runs, complete: false };
}

async function main() {
  const pages = await allProjectPages();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const page of pages) {
    try {
      // Parse and validate inside this row's error boundary so one bad URL cannot
      // abort the remaining projects or prevent the final nonzero error status.
      const target = readRepositoryUrl(page);
      if (!target) { skipped += 1; continue; }
      // Explicitly excluded from this Notion portfolio, even if an archived card is restored.
      const excludedRepos = new Set(['phesmunos', 'ciepseudocodeeditor']);
      if (target.owner.toLowerCase() === 'zhrsidd' && excludedRepos.has(target.repo.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const { owner, repo } = target;
      const suffix = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
      const info = await github(suffix, true);
      if (!info) {
        throw new Error('Cannot access ' + owner + '/' + repo + ' (GitHub 403/404). Check PROJECT_SYNC_GH_TOKEN repository permissions.');
      }
      const [prs, issues, commit] = await Promise.all([
        countOpen(owner, repo, 'pr'),
        countOpen(owner, repo, 'issue'),
        github(suffix + '/commits/' + encodeURIComponent(info.default_branch)),
      ]);
      // Scope to push-triggered CI for this exact SHA; paginate without counting noisy schedules.
      const { runs: relevantRuns, complete } = await latestCommitCiRuns(
        suffix, info.default_branch, commit.sha);
      const hasIncompleteRuns = relevantRuns.some((run) => run.status !== 'completed');
      const hasFailedRuns = relevantRuns.some((run) =>
        ['failure', 'timed_out', 'action_required'].includes(run.conclusion));
      // Never claim Passing for an untested SHA, an unfinished run or truncated results.
      const ci = !complete ? 'Unknown'
        : hasFailedRuns ? 'Failing'
        : relevantRuns.length > 0 && !hasIncompleteRuns &&
          relevantRuns.every((run) => run.conclusion === 'success') ? 'Passing' : 'Unknown';

      const properties = {
        'Open PRs': { number: prs },
        'Open Issues': { number: issues },
        'Last Commit': { rich_text: [{ type: 'text', text: { content: commit.sha.slice(0, 8) } }] },
        'Last Synced': { date: { start: new Date().toISOString() } },
        CI: { select: { name: ci } },
      };
      if (!dryRun) await notion('/pages/' + page.id, 'PATCH', { properties });
      updated += 1;
      await sleep(350); // keep below free Notion per-connection request rate
    } catch (error) {
      failed += 1;
      console.warn('Notion project ' + page.id + ' could not be refreshed: ' + error.message);
    }
  }
  console.log((dryRun ? 'Previewed ' : 'Updated ') + updated + ' of ' + pages.length +
    ' project rows; ' + skipped + ' skipped, ' + failed + ' errors.');
  if (failed > 0) process.exitCode = 1;
}

await main();
