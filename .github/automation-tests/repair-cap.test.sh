#!/usr/bin/env bash
# Behavioural tests for the repair job's "Enforce the five-repair cap" step. Extracts the real step and runs it against a
# fake gh that serves a pull request's commits. The cap counts `fix(review):` commits on the pull request, so up to four
# existing ones let a repair run and five stop it with a NEEDS_DECISION comment and a failing step; other commits, and
# commit messages that only mention the prefix, do not count. The fake refuses every other request, so a count taken from
# workflow runs (failed attempts) instead of commits would fail these cases.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
workflow=${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0

python3 - "$workflow" "$scratch/cap.sh" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if step.get("id") == "cap":
            open(sys.argv[2], "w").write(step["run"])
            sys.exit(0)
sys.exit("cap step not found")
PY

# $1 repair commits, $2 other commits, $3 commits that mention the prefix without starting with it.
commits() {
  jq -nc --argjson r "$1" --argjson o "$2" --argjson m "${3:-0}" '
    [range($r)     | {sha: "r\(.)", commit: {message: "fix(review): apply the automated Codex review repair\n\nbody"}}]
    + [range($o)   | {sha: "o\(.)", commit: {message: "feat: ordinary change \(.)"}}]
    + [range($m)   | {sha: "m\(.)", commit: {message: "chore: reverts fix(review): something"}}]'
}

# $1 name, $2 commits json, $3 want proceed|stop
run_case() {
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" rc=0 out ok=1 why="" posted
  mkdir -p "$dir"
  printf '%s' "$2" > "$dir/commits.json"
  : > "$dir/comments.log"
  out=$(FAKE_DIR="$dir" PATH="$here/fake-gh-cap:$PATH" GITHUB_REPOSITORY=o/r GH_TOKEN=tok PR=79 bash -e "$scratch/cap.sh" 2>&1) || rc=$?
  posted=$(wc -l < "$dir/comments.log")
  if [ "$3" = proceed ]; then
    if [ "$rc" -ne 0 ]; then ok=0; why="the cap stopped a repair that was under the limit"; fi
    if [ "$ok" -eq 1 ] && [ "$posted" -ne 0 ]; then ok=0; why="a comment was posted under the limit"; fi
  else
    if [ "$rc" -eq 0 ]; then ok=0; why="the cap let a repair through at the limit"; fi
    if [ "$ok" -eq 1 ] && [ "$posted" -ne 1 ]; then ok=0; why="$posted comments, want exactly one"; fi
    if [ "$ok" -eq 1 ] && ! grep -q 'NEEDS_DECISION: five automated review-repair commits' "$dir/comments.log"; then ok=0; why="the comment is not the five-commit NEEDS_DECISION notice"; fi
  fi
  if [ "$ok" -eq 1 ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: $why"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

run_case "no repair commits yet: a repair runs" "$(commits 0 6)" proceed
run_case "one repair commit: a repair runs" "$(commits 1 3)" proceed
run_case "three repair commits (the old limit): a repair still runs" "$(commits 3 4)" proceed
run_case "four repair commits: the fifth repair runs" "$(commits 4 4)" proceed
run_case "five repair commits: stops with NEEDS_DECISION" "$(commits 5 2)" stop
run_case "six repair commits: still stops" "$(commits 6 0)" stop
run_case "many ordinary commits do not count toward the limit" "$(commits 2 80)" proceed
run_case "commit messages that only mention the prefix do not count" "$(commits 4 2 10)" proceed
run_case "four repair commits among many others still allow one more" "$(commits 4 120)" proceed

if [ "$failures" -ne 0 ]; then
  echo "$failures repair cap check(s) failed"
  exit 1
fi
echo "all repair cap checks passed"
