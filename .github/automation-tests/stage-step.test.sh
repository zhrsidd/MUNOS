#!/usr/bin/env bash
# Runs the real "Stage gate scripts outside the workspace" step from each workflow, extracted with its own env, against
# throwaway trusted and head checkouts. Checks that no head-supplied script runs unless the owner-pinned bootstrap tree
# matches, including when the head's stager itself was edited to skip the check. Lives outside .github/scripts so that
# test changes do not alter the pinned gate tree.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
real_scripts="$repo/.github/scripts"
workflows=("$repo/.github/workflows/claude-review-repair.yml" "$repo/.github/workflows/codex-reviewed-automerge.yml")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0

# Writes the step's run block from a workflow to $2.
extract_run() { # $1 workflow, $2 destination
  python3 - "$1" "$2" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if step.get("name") == "Stage gate scripts outside the workspace":
            open(sys.argv[2], "w").write(step["run"])
            sys.exit(0)
sys.exit("stage step not found")
PY
}

# Builds a head checkout whose .github/scripts is a copy of the real scripts; prints its tree.
make_head() { # $1 directory
  rm -rf "$1"
  mkdir -p "$1/.github"
  cp -r "$real_scripts" "$1/.github/scripts"
  git -C "$1" init -q
  git -C "$1" add -A
  git -C "$1" -c user.name=test -c user.email=test@example.invalid commit -q -m head
  git -C "$1" rev-parse "HEAD:.github/scripts"
}

# Runs the step for one workflow in a fresh layout and checks the outcome.
run_case() { # $1 name, $2 want ok|fail, $3 workflow index, $4 trusted has gate (yes|no), $5 pr env, $6 bootstrap pr, $7 bootstrap tree, $8 head mutator (or -)
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" run="$scratch/run-$cases.sh" rc=0 out
  mkdir -p "$dir/trusted"
  if [ "$4" = yes ]; then
    mkdir -p "$dir/trusted/.github"
    cp -r "$real_scripts" "$dir/trusted/.github/scripts"
  fi
  make_head "$dir/head" > /dev/null
  if [ "$8" != - ]; then
    "$8" "$dir/head"
    git -C "$dir/head" -c user.name=test -c user.email=test@example.invalid commit -q -am tampered
  fi
  extract_run "${workflows[$3]}" "$run"
  mkdir -p "$dir/tmp"
  out=$(cd "$dir" && PR="$5" CODEX_GATE_BOOTSTRAP_PR="$6" CODEX_GATE_BOOTSTRAP_TREE="$7" \
    RUNNER_TEMP="$dir/tmp" bash -e "$run" 2>&1) || rc=$?
  local got=fail
  if [ "$rc" -eq 0 ]; then got=ok; fi
  # A refusal must come from the step's own check, not from some unrelated failure such as a missing directory.
  if [ "$2" = fail ] && ! grep -q '::error::' <<<"$out"; then got=unexpected-failure; fi
  if [ "$got" = "$2" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: got $got, want $2"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

# Tree the owner would pin for an unmodified head.
pinned=$(make_head "$scratch/pin-source")

tamper_stager() { # edits the head's stager, which is what an attacker would change to skip the check
  printf '%s\n' "true" >> "$1/.github/scripts/stage-gate.sh"
}
tamper_gate() { printf '%s\n' "EDITED GATE" >> "$1/.github/scripts/codex-review-gate.sh"; }

for i in 0 1; do
  name=$(basename "${workflows[$i]}")
  run_case "$name: main has the gate, stages from main" ok "$i" yes 79 79 "$pinned" -
  run_case "$name: bootstrap at pinned tree stages from head" ok "$i" no 79 79 "$pinned" -
  run_case "$name: wrong pinned tree refuses" fail "$i" no 79 79 0000000000000000000000000000000000000000 -
  run_case "$name: different PR refuses" fail "$i" no 80 79 "$pinned" -
  run_case "$name: no bootstrap variables refuses" fail "$i" no 79 "" "" -
  run_case "$name: stager edited to skip the check refuses" fail "$i" no 79 79 "$pinned" tamper_stager
  run_case "$name: gate edited after the pin refuses" fail "$i" no 79 79 "$pinned" tamper_gate
done

if [ "$failures" -ne 0 ]; then
  echo "$failures workflow staging check(s) failed"
  exit 1
fi
echo "all workflow staging checks passed"
