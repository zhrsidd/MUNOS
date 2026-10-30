#!/usr/bin/env bash
# Offline tests for stage-gate.sh. Builds throwaway git repositories and checks each rule in the staging decision:
# main wins when it has the gate; the head is used only for the pinned pull request at the pinned tree; anything else fails.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
stage="$here/../stage-gate.sh"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0

# A repository whose only content is the given gate marker under .github/scripts.
make_repo() { # $1 directory, $2 marker text
  mkdir -p "$1/.github/scripts"
  printf '%s\n' "$2" > "$1/.github/scripts/codex-review-gate.sh"
  git -C "$1" init -q
  git -C "$1" add -A
  git -C "$1" -c user.name=test -c user.email=test@example.invalid commit -q -m marker
}

make_repo "$scratch/main" "MAIN GATE"
make_repo "$scratch/head" "HEAD GATE"
empty="$scratch/empty-main"
mkdir -p "$empty"
head_tree=$(git -C "$scratch/head" rev-parse "HEAD:.github/scripts")

# Runs stage-gate.sh with the given trusted checkout, pull number and bootstrap variables, and checks the outcome.
expect() { # $1 name, $2 want (ok|fail), $3 want marker or -, $4 trusted dir, $5 pr, $6 bootstrap pr, $7 bootstrap tree
  local dest="$scratch/dest-$RANDOM" rc=0
  CODEX_GATE_BOOTSTRAP_PR="$6" CODEX_GATE_BOOTSTRAP_TREE="$7" \
    bash "$stage" "$4" "$scratch/head" "$5" "$dest" >/dev/null 2>&1 || rc=$?
  local got=fail marker=-
  if [ "$rc" -eq 0 ]; then
    got=ok
    marker=$(sed -n 1p "$dest/codex-review-gate.sh")
  fi
  if [ "$got" = "$2" ] && { [ "$2" = fail ] || [ "$marker" = "$3" ]; }; then
    echo "ok    $1"
  else
    echo "FAIL  $1: got $got (marker $marker), want $2 (marker $3)"
    failures=$((failures + 1))
  fi
}

expect "main has the gate: uses main even when a bootstrap is pinned" ok "MAIN GATE" \
  "$scratch/main" 79 79 "$head_tree"
expect "main has the gate and no bootstrap is set: uses main" ok "MAIN GATE" \
  "$scratch/main" 79 "" ""
expect "no gate on main, pinned PR at pinned tree: bootstraps from head" ok "HEAD GATE" \
  "$empty" 79 79 "$head_tree"
expect "no gate on main, wrong tree: refuses" fail - \
  "$empty" 79 79 "0000000000000000000000000000000000000000"
expect "no gate on main, different PR number: refuses" fail - \
  "$empty" 80 79 "$head_tree"
expect "no gate on main, no bootstrap variables: refuses" fail - \
  "$empty" 79 "" ""
expect "no gate on main, bootstrap PR set but no tree: refuses" fail - \
  "$empty" 79 79 ""

# A later commit that edits the gate must change the tree, so the old pin no longer matches.
printf '%s\n' "EDITED" > "$scratch/head/.github/scripts/codex-review-gate.sh"
git -C "$scratch/head" -c user.name=test -c user.email=test@example.invalid commit -q -am edit
expect "gate edited after the pin: refuses even with the old tree" fail - \
  "$empty" 79 79 "$head_tree"

if [ "$failures" -ne 0 ]; then
  echo "$failures stage-gate check(s) failed"
  exit 1
fi
echo "all stage-gate checks passed"
