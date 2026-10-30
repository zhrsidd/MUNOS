#!/usr/bin/env bash
# Tests the repair job's "Collect Claude's edits as a patch" step. The claude-code-action restores CLAUDE.md, .claude, .mcp.json
# and similar files from main and writes .claude-pr/ before Claude runs, so the workspace is already "dirty" with protected
# paths. The step must drop every protected path (with a warning), keep Claude's real edits, and leave anything else unsafe,
# such as a symlink, for the push job to refuse. The patch it produces must still pass the push job's check.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
workflow=${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0
ident=(-c user.name=test -c user.email=test@example.invalid)

python3 - "$workflow" "Collect Claude's edits as a patch" "$scratch/patch-step.sh" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if step.get("name") == sys.argv[2]:
            open(sys.argv[3], "w").write(step["run"])
            sys.exit(0)
sys.exit("step not found: " + sys.argv[2])
PY

# The reviewed commit.
seed="$scratch/seed"
git init -q "$seed"
(
  cd "$seed"
  mkdir -p app docs .github/workflows
  echo "export const page = 1;" > app/page.ts
  echo "notes" > docs/notes.md
  echo "claude on the PR head" > CLAUDE.md
  echo "agents" > AGENTS.md
  echo '{"mcpServers":{}}' > .mcp.json
  echo "name: CI" > .github/workflows/ci.yml
  git add -A
  git "${ident[@]}" commit -q -m reviewed
)
base=$(git -C "$seed" rev-parse HEAD)

# What the action leaves behind before Claude runs.
action_restores() { echo "claude on main" > CLAUDE.md; echo '{"mcpServers":{"x":{}}}' > .mcp.json; mkdir -p .claude-pr; echo "preserved" > .claude-pr/CLAUDE.md; }

m_none()          { :; }
m_allowed()       { echo "// fix" >> app/page.ts; }
m_allowed_two()   { echo "// fix" >> app/page.ts; echo "new" > docs/new.md; }
m_workflow()      { echo "# x" >> .github/workflows/ci.yml; }
m_agents()        { echo "x" >> AGENTS.md; }
m_symlink()       { ln -s page.ts app/alias.ts; }
m_special_name()  { echo x > "docs/it's a name.md"; }
m_delete_ok()     { git rm -q docs/notes.md; }

# $1 name, $2 mutator, $3 want has_patch (true|false), $4 files the patch must touch (space separated, sorted), $5 warnings wanted (count)
run_case() {
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" out="" rc=0 got_files got_warn has
  # The workspace is $dir/work; the runner's temp directory and output file live outside it, as they do on a runner.
  mkdir -p "$dir/tmp"
  git clone -q "$seed" "$dir/work"
  (cd "$dir/work" && action_restores && "$2")
  : > "$dir/out"
  out=$(cd "$dir/work" && BASE="$base" RUNNER_TEMP="$dir/tmp" GITHUB_OUTPUT="$dir/out" bash -e "$scratch/patch-step.sh" 2>&1) || rc=$?
  has=$(sed -n 's/^has_patch=//p' "$dir/out")
  got_files=""
  if [ -s "$dir/tmp/repair.patch" ]; then
    got_files=$(git -C "$dir/work" apply --numstat -z "$dir/tmp/repair.patch" | tr '\0' '\n' | awk -F'\t' 'NF>=3{print $3}' | sort | tr '\n' ' ')
  fi
  got_warn=$(grep -c '^::warning::Dropped' <<<"$out" || true)
  local ok=1 why=""
  if [ "$rc" -ne 0 ]; then ok=0; why="step failed ($rc)"; fi
  if [ "$ok" -eq 1 ] && [ "$has" != "$3" ]; then ok=0; why="has_patch=$has, want $3"; fi
  if [ "$ok" -eq 1 ] && [ "${got_files% }" != "$4" ]; then ok=0; why="patch touches '${got_files% }', want '$4'"; fi
  if [ "$ok" -eq 1 ] && [ "$got_warn" != "$5" ]; then ok=0; why="$got_warn dropped-path warnings, want $5"; fi
  if [ "$ok" -eq 1 ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: $why"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

# Only the action's own restores: nothing to publish, and the restores are reported as dropped.
run_case "the action's restores alone leave no patch" m_none false "" 3
run_case "Claude's edit is kept and the action's restores are dropped" m_allowed true "app/page.ts" 3
run_case "several edits are kept" m_allowed_two true "app/page.ts docs/new.md" 3
run_case "a deletion of an ordinary file is kept" m_delete_ok true "docs/notes.md" 3
run_case "a name with a quote and spaces is kept" m_special_name true "docs/it's a name.md" 3
run_case "Claude's edit to a workflow is dropped, not pushed" m_workflow false "" 4
run_case "Claude's edit to AGENTS.md is dropped, its real edit is kept" m_agents false "" 4
# Not a protected path, so the push job is left to refuse it.
run_case "a symlink is left in the patch for the push job to refuse" m_symlink true "app/alias.ts" 3

if [ "$failures" -ne 0 ]; then
  echo "$failures patch-step check(s) failed"
  exit 1
fi
echo "all patch-step checks passed"
