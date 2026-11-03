import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Execute the actual script with injected fetch/process objects. No network calls,
// real credentials or Notion writes are made by this regression suite.
const source = await readFile(new URL('../scripts/notion-project-status-sync.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const executeSync = new AsyncFunction('process', 'fetch', 'setTimeout', 'console', 'URL', source);

const SHA = 'a'.repeat(40);
const project = (id, url) => ({
  object: 'page', id, properties: { GitHub: { url } },
});
const regularProjects = [
  project('munos', 'https://github.com/zhrsidd/MUNOS'),
  project('physics', 'https://github.com/zhrsidd/PhysicsWeekly'),
  project('course', 'https://github.com/zhrsidd/CourseScope'),
];

function apiResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

async function exercise({
  pages = regularProjects, dryRun = false, privateForbidden = false,
  commitStale = false, ciPending = false, manyPushRuns = false,
} = {}) {
  const patches = [];
  const warnings = [];
  const logs = [];
  const queriedPages = [];
  const proc = {
    env: {
      NOTION_PROJECTS_API_KEY: 'test-token',
      NOTION_DATA_SOURCE_ID: 'test-source',
      PROJECT_SYNC_GH_TOKEN: 'test-github-token',
      DRY_RUN: dryRun ? '1' : '0',
    },
    exitCode: 0,
  };

  async function fakeFetch(url, options = {}) {
    const request = new URL(url);
    if (request.hostname === 'api.notion.com') {
      if (request.pathname.endsWith('/query')) {
        return apiResponse({ results: pages, has_more: false });
      }
      if (request.pathname.startsWith('/v1/pages/') && options.method === 'PATCH') {
        patches.push({
          id: request.pathname.split('/').at(-1),
          properties: JSON.parse(options.body).properties,
        });
        return apiResponse({ object: 'page' });
      }
    }

    if (request.hostname === 'api.github.com') {
      if (request.pathname === '/search/issues') return apiResponse({ total_count: 2 });
      if (request.pathname.startsWith('/repos/')) {
        if (privateForbidden && request.pathname === '/repos/zhrsidd/PhysicsWeekly') {
          return apiResponse({ message: 'not found' }, 404);
        }
        if (/\/commits\/main$/.test(request.pathname)) return apiResponse({ sha: SHA });
        if (request.pathname.endsWith('/actions/runs')) {
          assert.equal(request.searchParams.get('head_sha'), SHA);
          assert.equal(request.searchParams.get('event'), 'push');
          const currentPage = Number(request.searchParams.get('page'));
          queriedPages.push(currentPage);
          const count = manyPushRuns ? (currentPage === 1 ? 100 : 45) : 1;
          return apiResponse({
            total_count: manyPushRuns ? 145 : 1,
            workflow_runs: Array.from({ length: count }, (_, index) => ({
              id: (currentPage - 1) * 100 + index + 1,
              event: 'push',
              head_sha: commitStale ? 'b'.repeat(40) : SHA,
              name: 'Build',
              status: ciPending ? 'in_progress' : 'completed',
              conclusion: ciPending ? null : 'success',
            })),
          });
        }
        if (request.pathname.split('/').length === 4) {
          return apiResponse({ default_branch: 'main' });
        }
      }
    }
    throw new Error('Unexpected API request in test: ' + url);
  }

  const fastTimer = (callback) => { callback(); return 0; };
  await executeSync(proc, fakeFetch, fastTimer, {
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
  }, URL);

  return { patches, warnings, logs, queriedPages, exitCode: proc.exitCode };
}

test('malformed and unsupported URLs fail per-row while valid later projects still update', async () => {
  const result = await exercise({
    pages: [
      project('bad-syntax', 'not a url'),
      project('valid-first', 'https://github.com/zhrsidd/MUNOS'),
      project('bad-path', 'https://github.com/zhrsidd'),
      project('bad-host', 'https://example.com/zhrsidd/CourseScope'),
      project('valid-last', 'https://github.com/zhrsidd/DeutschLab'),
    ],
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.patches.map((item) => item.id), ['valid-first', 'valid-last']);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /bad-syntax/);
  assert.match(result.warnings[1], /bad-path/);
  assert.match(result.warnings[2], /bad-host/);
  assert.match(result.logs.at(-1), /Updated 2 of 5 project rows; 0 skipped, 3 errors/);
  assert.deepEqual(Object.keys(result.patches[0].properties).sort(), [
    'CI', 'Last Commit', 'Last Synced', 'Open Issues', 'Open PRs',
  ]);
});

test('dry-run with a bad URL cannot write Notion but still reports an error', async () => {
  const result = await exercise({
    dryRun: true,
    pages: [
      project('bad', 'invalid'),
      project('good', 'https://github.com/zhrsidd/MUNOS'),
    ],
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.patches.length, 0);
  assert.match(result.logs.at(-1), /Previewed 1 of 2 project rows; 0 skipped, 1 errors/);
});

test('empty URL is skipped without aborting valid projects', async () => {
  const result = await exercise({ pages: [
    project('unlinked', null),
    project('linked', 'https://github.com/zhrsidd/FormulaSnap'),
  ] });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.patches.map((item) => item.id), ['linked']);
  assert.match(result.logs.at(-1), /Updated 1 of 2 project rows; 1 skipped, 0 errors/);
});

test('inaccessible private repository is reported without suppressing later updates', async () => {
  const result = await exercise({ privateForbidden: true });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.patches.map((item) => item.id), ['munos', 'course']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /PhysicsWeekly/);
});

test('latest-commit CI ignores stale results and in-progress checks', async () => {
  const good = await exercise();
  const stale = await exercise({ commitStale: true });
  const pending = await exercise({ ciPending: true });
  assert.equal(good.patches[0].properties.CI.select.name, 'Passing');
  assert.equal(stale.patches[0].properties.CI.select.name, 'Unknown');
  assert.equal(pending.patches[0].properties.CI.select.name, 'Unknown');
});

test('more than 100 push runs are paginated and can still report Passing', async () => {
  const result = await exercise({ manyPushRuns: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.patches[0].properties.CI.select.name, 'Passing');
  assert.deepEqual(result.queriedPages, [1, 2, 1, 2, 1, 2]);
});
