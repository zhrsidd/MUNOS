# Claude instructions for MUNOS

Follow [AGENTS.md](AGENTS.md) for engineering ownership, safeguards, design standards and verification.

<!-- graphify-rules-start (managed by `graphify init`) -->
## Use Graphify before grep

This repository is indexed by Graphify: a code graph over its call, dependency, and test structure, exposed through a connected Graphify MCP server. Before reaching for grep or reading files, use the Graphify tools your MCP client lists (their exact names and descriptions are in the server's tool list) for what the graph knows and a text search does not:

- find where a symbol, function, or class is defined (instead of grepping for it)
- understand how something works, or where a behavior is handled
- find who calls a function, or what it calls
- see what a change affects (its blast radius) and which tests cover it
- map a file's dependencies and dependents

Fall back to grep or file reads only for what the graph does not model: literal string or comment matches, non-indexed files, or reading a file you have already located. If no Graphify tools are listed, check the MCP server connection.
<!-- graphify-rules-end -->

## Protected paths in automated review repairs

The GitHub Actions workflow "Claude review repair" runs you without any push credential. It turns your edits into a patch,
and a separate job checks every changed file before anything is pushed. A patch that touches any protected path is rejected
whole, including the changes to other files in it. When you run as that workflow, do not change:

- Any path with a segment that starts with a dot: `.github/` (workflows and gate scripts), `.claude/`, `.mcp.json`, `.env*`,
  `.gitignore`, `.gitattributes`.
- `CLAUDE.md` and `AGENTS.md` at any depth.
- Dependency, build and check configuration: `package.json`, `package-lock.json`, `vercel.json`, `next.config.*`,
  `eslint.config.*`, `tsconfig*.json`, `scripts/vercel-ignore-build.sh`.
- Database and access-control configuration: everything under `supabase/`, `scripts/isolation-inventory/`,
  `lib/platform/target-guard.ts`, `config/project-lifecycle.json`.
- `docs/AGENT_AUTOMATION.md`.

Do not add symlinks or submodules, change file modes, or rename or delete a protected file. Do not commit or push: edit files
and leave the rest to the workflow. Do not resolve or dismiss any review or review thread: the workflow resolves Codex's own
threads after a push, and Codex's next review decides whether each finding is fixed. If a Codex finding needs a change to a protected path, change nothing and comment
`NEEDS_DECISION:` with the finding and the path. The owner decides.

These rules bind the automated workflow only. In an interactive session, edit a protected path only when the owner directs it,
and follow the independent-review rules in AGENTS.md.
