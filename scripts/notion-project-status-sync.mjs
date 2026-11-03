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
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null;
  const match = /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(parsed.pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function countOpen(owner, repo, kind) {
  const query = 'repo:' + owner + '/' + repo + ' is:' + kind + ' is:open';
  const result = await github('/search/issues?q=' + encodeURIComponent(query) + '&per_page=1');
  return result.total_count;
}

async function main() {
  const pages = await allProjectPages();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const page of pages) {
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
    try {
      const info = await github(suffix, true);
      if (!info) {
        throw new Error('Cannot access ' + owner + '/' + repo + ' (GitHub 403/404). Check PROJECT_SYNC_GH_TOKEN repository permissions.');
      }
      const [prs, issues, commit] = await Promise.all([
        countOpen(owner, repo, 'pr'),
        countOpen(owner, repo, 'issue'),
        github(suffix + '/commits/' + encodeURIComponent(info.default_branch)),
      ]);
      // Query the exact latest default-branch commit, including unfinished runs.
      const workflows = await github(suffix + '/actions/runs?branch=' +
        encodeURIComponent(info.default_branch) + '&head_sha=' +
        encodeURIComponent(commit.sha) + '&per_page=100', true);
      const relevantRuns = (workflows?.workflow_runs ?? []).filter((run) =>
        run.head_sha === commit.sha && run.name !== 'Notion project status sync');
      const hasIncompleteRuns = relevantRuns.some((run) => run.status !== 'completed');
      const hasFailedRuns = relevantRuns.some((run) =>
        ['failure', 'timed_out', 'action_required'].includes(run.conclusion));
      // Never claim Passing for an untested commit, a running workflow or truncated results.
      const truncated = workflows && workflows.total_count > (workflows.workflow_runs?.length ?? 0);
      const ci = hasFailedRuns ? 'Failing'
        : relevantRuns.length > 0 && !hasIncompleteRuns && !truncated &&
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
      console.warn('A repository could not be refreshed: ' + error.message);
    }
  }
  console.log((dryRun ? 'Previewed ' : 'Updated ') + updated + ' of ' + pages.length +
    ' project rows; ' + skipped + ' skipped, ' + failed + ' errors.');
  if (failed > 0) process.exitCode = 1;
}

await main();
