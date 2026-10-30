#!/usr/bin/env bash
# Behavioural tests for the repair workflow's push job. Extracts its real "Apply the patch and check every changed file" and
# "Push the checked repair" steps, then runs them against a local bare repository standing in for GitHub, with patches built
# the way the repair job builds them. A refusal must leave the remote branch untouched and come from the step's own check.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
workflow=${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0
branch=automation/x
ident=(-c user.name=test -c user.email=test@example.invalid)

extract_step() { # $1 step name, $2 destination file
  python3 - "$workflow" "$1" "$2" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if step.get("name") == sys.argv[2]:
            open(sys.argv[3], "w").write(step["run"])
            sys.exit(0)
sys.exit("step not found: " + sys.argv[2])
PY
}
extract_step "Apply the patch and check every changed file" "$scratch/apply.sh"
extract_step "Push the checked repair" "$scratch/push.sh"

# The reviewed commit, with one file in each protected class and some ordinary ones.
origin="$scratch/origin.git"
seed="$scratch/seed"
git init -q --bare "$origin"
git init -q "$seed"
(
  cd "$seed"
  mkdir -p app docs .github/workflows supabase/migrations lib/platform config scripts/isolation-inventory scripts
  echo "export const page = 1;" > app/page.ts
  echo "readme" > README.md
  echo "notes" > docs/notes.md
  echo "claude" > CLAUDE.md
  echo "agents" > AGENTS.md
  echo "automation" > docs/AGENT_AUTOMATION.md
  echo "name: CI" > .github/workflows/ci.yml
  echo '{"name":"x"}' > package.json
  echo '{"lock":1}' > package-lock.json
  echo '{}' > vercel.json
  echo '{}' > tsconfig.json
  echo "export default {};" > next.config.ts
  echo "export default [];" > eslint.config.mjs
  echo '{}' > .mcp.json
  echo "select 1;" > supabase/migrations/001.sql
  echo "[api]" > supabase/config.toml
  echo "export const guard = 1;" > lib/platform/target-guard.ts
  echo '{}' > config/project-lifecycle.json
  echo '{}' > scripts/isolation-inventory/policy-allowlist.json
  echo "#!/bin/sh" > scripts/vercel-ignore-build.sh
  git add -A
  git "${ident[@]}" commit -q -m reviewed
  git push -q "$origin" "HEAD:refs/heads/$branch"
)
base=$(git -C "$seed" rev-parse HEAD)

# Mutators run inside a clone of the reviewed commit and stand in for Claude's edits.
m_allowed()          { echo "// fix" >> app/page.ts; }
m_allowed_new()      { echo "hello" > docs/new-note.md; }
m_lookalikes()       { echo x > docs/not-claude.md; echo y > app/claude.mdx; mkdir -p docs/github; echo z > docs/github/readme.md; }
m_github_edit()      { echo "# x" >> .github/workflows/ci.yml; }
m_github_new()       { echo "name: evil" > .github/workflows/evil.yml; }
m_github_scripts()   { mkdir -p .github/scripts; echo "exit 0" > .github/scripts/codex-review-gate.sh; }
m_github_upper()     { mkdir -p .GITHUB/workflows; echo x > .GITHUB/workflows/x.yml; }
m_claude()           { echo x >> CLAUDE.md; }
m_agents()           { echo x >> AGENTS.md; }
m_nested_claude()    { echo x > docs/CLAUDE.md; }
m_case_claude()      { echo x > Claude.MD; }
m_nested_agents()    { mkdir -p app/api; echo x > app/api/agents.md; }
m_dot_claude()       { mkdir -p .claude; echo '{}' > .claude/settings.json; }
m_mcp()              { echo ' ' >> .mcp.json; }
m_env()              { echo "A=1" > .env.local; }
m_gitattributes()    { echo "* text=auto" > .gitattributes; }
m_package()          { echo ' ' >> package.json; }
m_lock()             { echo ' ' >> package-lock.json; }
m_shrinkwrap()       { echo '{"lockfileVersion":3}' > npm-shrinkwrap.json; }
m_yarn_lock()        { echo "# yarn" > yarn.lock; }
m_pnpm_lock()        { echo "lockfileVersion: 9" > pnpm-lock.yaml; }
m_bun_lock()         { echo "x" > bun.lockb; }
m_vercel()           { echo ' ' >> vercel.json; }
m_tsconfig()         { echo ' ' >> tsconfig.json; }
m_eslint()           { echo "// x" >> eslint.config.mjs; }
m_next()             { echo "// x" >> next.config.ts; }
m_supabase_new()     { echo "select 2;" > supabase/migrations/002.sql; }
m_supabase_config()  { echo "# x" >> supabase/config.toml; }
m_target_guard()     { echo "// x" >> lib/platform/target-guard.ts; }
m_lifecycle()        { echo ' ' >> config/project-lifecycle.json; }
m_policy()           { echo ' ' >> scripts/isolation-inventory/policy-allowlist.json; }
m_vercel_ignore()    { echo "exit 0" >> scripts/vercel-ignore-build.sh; }
m_doc_automation()   { echo x >> docs/AGENT_AUTOMATION.md; }
m_delete_protected() { git rm -q AGENTS.md; }
m_rename_out()       { git mv AGENTS.md docs/agents-copy.txt; }
m_rename_in()        { git mv app/page.ts .github/page.ts; }
m_symlink()          { ln -s ../.github docs/link; }
m_symlink_safe()     { ln -s page.ts app/alias.ts; }
m_exec_bit()         { chmod +x app/page.ts; }
m_exec_new()         { printf '#!/bin/sh\n' > app/run.sh; chmod +x app/run.sh; }
m_submodule()        { mkdir sub; git -C sub init -q; git -C sub "${ident[@]}" commit -q --allow-empty -m s; git add sub 2>/dev/null; }
m_mixed()            { echo "// fix" >> app/page.ts; echo x >> CLAUDE.md; }
m_oversize()         { head -c 2100000 /dev/urandom | base64 > docs/big.txt; }
m_traversal()        { printf 'diff --git a/../outside.txt b/../outside.txt\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/../outside.txt\n@@ -0,0 +1 @@\n+x\n' > "$PATCH_FILE"; }

# Runs one case through both steps. $1 name, $2 want pushed|refused, $3 mutator, $4 option (-|moved|main), $5 expected pushed files.
run_case() {
  local name=$1 want=$2 mutator=$3 option=${4:--} files=${5:-}
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" apply_rc=0 push_rc=0 out="" tip="" got other
  mkdir -p "$dir"
  git -C "$origin" update-ref "refs/heads/$branch" "$base"
  git clone -q -b "$branch" "$origin" "$dir/edit"
  export PATCH_FILE="$dir/repair.patch"
  if [ "$mutator" != m_traversal ]; then
    (cd "$dir/edit" && "$mutator" && git add -A && git diff --cached --binary --no-renames "$base" > "$PATCH_FILE")
  else
    m_traversal
  fi
  git clone -q -b "$branch" "$origin" "$dir/work"
  : > "$dir/out"
  out=$(cd "$dir/work" && BASE="$base" PATCH="$PATCH_FILE" GITHUB_OUTPUT="$dir/out" bash -e "$scratch/apply.sh" 2>&1) || apply_rc=$?
  if [ "$apply_rc" -eq 0 ] && grep -q '^changed=true$' "$dir/out"; then
    if [ "$option" = moved ]; then
      git clone -q -b "$branch" "$origin" "$dir/other"
      (cd "$dir/other" && echo "someone else" > docs/other.md && git add -A && git "${ident[@]}" commit -q -m other && git push -q origin "HEAD:refs/heads/$branch")
    fi
    local head_ref=$branch
    if [ "$option" = main ]; then head_ref=main; fi
    out+=$'\n'$(cd "$dir/work" && BASE="$base" HEAD_REF="$head_ref" GH_TOKEN=tok GITHUB_REPOSITORY=o/r \
      GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$origin.insteadOf" \
      GIT_CONFIG_VALUE_0="https://x-access-token:tok@github.com/o/r.git" bash -e "$scratch/push.sh" 2>&1) || push_rc=$?
  fi
  tip=$(git -C "$origin" rev-parse "refs/heads/$branch")
  got=refused
  if [ "$tip" != "$base" ] && [ "$option" != moved ]; then got=pushed; fi

  local ok=1 why=""
  if [ "$got" != "$want" ]; then ok=0; why="got $got, want $want"; fi
  if [ "$want" = pushed ]; then
    if [ "$ok" -eq 1 ] && [ "$(git -C "$origin" rev-parse "$tip^")" != "$base" ]; then ok=0; why="pushed commit is not a child of the reviewed commit"; fi
    if [ "$ok" -eq 1 ] && [[ "$(git -C "$origin" log -1 --format=%s "$tip")" != "fix(review):"* ]]; then ok=0; why="pushed subject lacks the fix(review): prefix"; fi
    if [ "$ok" -eq 1 ]; then
      other=$(git -C "$origin" diff --name-only "$base" "$tip" | sort | tr '\n' ' ')
      if [ "$other" != "$files " ]; then ok=0; why="pushed files '$other', want '$files '"; fi
    fi
  else
    # A refusal leaves the branch where it was, apart from the case where someone else moved it, and must be the step's own error.
    if [ "$option" = moved ]; then
      if [ "$tip" = "$base" ] || [ "$push_rc" -eq 0 ]; then ok=0; why="a moved branch must make the push fail and keep the other commit"; fi
    elif [ "$tip" != "$base" ]; then ok=0; why="the remote branch changed"; fi
    if [ "$ok" -eq 1 ] && ! grep -q '::error::' <<<"$out"; then ok=0; why="refused without the step's own ::error::"; fi
  fi
  if [ "$ok" -eq 1 ]; then
    echo "ok    $name"
  else
    echo "FAIL  $name: $why"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

# Allowed edits still go through, including lookalikes that must not be mistaken for protected paths.
run_case "ordinary edit is pushed as a fix(review) commit" pushed m_allowed - "app/page.ts"
run_case "new ordinary file is pushed" pushed m_allowed_new - "docs/new-note.md"
run_case "lookalike names (not-claude.md, claude.mdx, docs/github/) are not protected" pushed m_lookalikes - "app/claude.mdx docs/github/readme.md docs/not-claude.md"

# Every protected class is refused.
run_case "edit under .github/ is refused" refused m_github_edit
run_case "new workflow under .github/ is refused" refused m_github_new
run_case "new gate script under .github/scripts is refused" refused m_github_scripts
run_case "upper-case .GITHUB/ is refused" refused m_github_upper
run_case "CLAUDE.md is refused" refused m_claude
run_case "AGENTS.md is refused" refused m_agents
run_case "nested docs/CLAUDE.md is refused" refused m_nested_claude
run_case "case variant Claude.MD is refused" refused m_case_claude
run_case "nested lower-case agents.md is refused" refused m_nested_agents
run_case ".claude/ settings are refused" refused m_dot_claude
run_case ".mcp.json is refused" refused m_mcp
run_case ".env.local is refused" refused m_env
run_case ".gitattributes is refused" refused m_gitattributes
run_case "package.json is refused" refused m_package
run_case "package-lock.json is refused" refused m_lock
run_case "a new npm-shrinkwrap.json, which npm prefers over package-lock.json, is refused" refused m_shrinkwrap
run_case "a new yarn.lock is refused" refused m_yarn_lock
run_case "a new pnpm-lock.yaml is refused" refused m_pnpm_lock
run_case "a new bun.lockb is refused" refused m_bun_lock
run_case "vercel.json is refused" refused m_vercel
run_case "tsconfig.json is refused" refused m_tsconfig
run_case "eslint.config.mjs is refused" refused m_eslint
run_case "next.config.ts is refused" refused m_next
run_case "a new Supabase migration is refused" refused m_supabase_new
run_case "supabase/config.toml is refused" refused m_supabase_config
run_case "lib/platform/target-guard.ts is refused" refused m_target_guard
run_case "config/project-lifecycle.json is refused" refused m_lifecycle
run_case "the isolation policy allowlist is refused" refused m_policy
run_case "scripts/vercel-ignore-build.sh is refused" refused m_vercel_ignore
run_case "docs/AGENT_AUTOMATION.md is refused" refused m_doc_automation

# Shapes of change that could smuggle a protected edit past a name check.
run_case "deleting a protected file is refused" refused m_delete_protected
run_case "renaming a protected file out is refused" refused m_rename_out
run_case "renaming a file into a protected path is refused" refused m_rename_in
run_case "a symlink into .github is refused" refused m_symlink
run_case "a symlink to an ordinary file is refused" refused m_symlink_safe
run_case "an executable-bit change is refused" refused m_exec_bit
run_case "a new executable file is refused" refused m_exec_new
run_case "a submodule is refused" refused m_submodule
run_case "an ordinary edit together with a protected one is refused whole" refused m_mixed
run_case "a patch over the size limit is refused" refused m_oversize
run_case "a path that escapes the repository is refused" refused m_traversal

# Push-time refusals.
run_case "a branch that moved since the review is not overwritten" refused m_allowed moved
run_case "pushing to main is refused" refused m_allowed main

if [ "$failures" -ne 0 ]; then
  echo "$failures repair push check(s) failed"
  exit 1
fi
echo "all repair push checks passed"
