#!/usr/bin/env bash
# Runs the real "Stage gate scripts outside the workspace" step from each workflow, extracted as written, against a
# throwaway layout. The gate scripts must come from the main checkout and nowhere else: if main has none the step refuses
# with its own error, a stale or tampered pull request checkout next to it is never staged or run, and the old bootstrap
# variables have no effect. Lives outside .github/scripts so that test changes do not alter the gate scripts.
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
            if step.get("env"):
                sys.exit("the stage step must not take environment variables: " + ", ".join(step["env"]))
            open(sys.argv[2], "w").write(step["run"])
            sys.exit(0)
sys.exit("stage step not found")
PY
}

# $1 name, $2 want ok|fail, $3 workflow index, $4 main has the gate (yes|no), $5 layout extra (-|head-with-bad-gate|bootstrap-vars)
run_case() {
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" run="$scratch/run-$cases.sh" rc=0 out ok=1 why=""
  mkdir -p "$dir/trusted" "$dir/tmp"
  if [ "$4" = yes ]; then
    mkdir -p "$dir/trusted/.github"
    cp -r "$real_scripts" "$dir/trusted/.github/scripts"
  fi
  if [ "$5" = head-with-bad-gate ]; then
    # What an attacker would leave next to the trusted checkout: a gate and a stager that would announce themselves.
    mkdir -p "$dir/head/.github/scripts"
    printf '#!/bin/sh\ntouch "%s/HEAD-SCRIPT-RAN"\n' "$dir" > "$dir/head/.github/scripts/codex-review-gate.sh"
    printf '#!/bin/sh\ntouch "%s/HEAD-SCRIPT-RAN"\n' "$dir" > "$dir/head/.github/scripts/stage-gate.sh"
  fi
  extract_run "${workflows[$3]}" "$run"
  local env_extra=()
  if [ "$5" = bootstrap-vars ]; then env_extra=(CODEX_GATE_BOOTSTRAP_PR=79 CODEX_GATE_BOOTSTRAP_TREE=9012be5d9c2b48341fc636247ecc95df9ced86e1); fi
  out=$(cd "$dir" && env PR=79 "${env_extra[@]}" RUNNER_TEMP="$dir/tmp" bash -e "$run" 2>&1) || rc=$?
  if [ "$2" = ok ] && [ "$rc" -ne 0 ]; then ok=0; why="the step failed"; fi
  if [ "$2" = fail ] && [ "$rc" -eq 0 ]; then ok=0; why="the step should have refused"; fi
  # A refusal must come from the step's own check, not from some unrelated failure such as a missing directory.
  if [ "$ok" -eq 1 ] && [ "$2" = fail ] && ! grep -q '::error::main has no gate scripts' <<<"$out"; then ok=0; why="refused without the step's own error"; fi
  if [ "$ok" -eq 1 ] && [ "$2" = ok ]; then
    if ! cmp -s "$real_scripts/codex-review-gate.sh" "$dir/tmp/gate/codex-review-gate.sh"; then ok=0; why="the staged gate is not main's"; fi
    if [ -e "$dir/trusted" ]; then ok=0; why="the trusted checkout was left in the workspace"; fi
  fi
  if [ "$ok" -eq 1 ] && [ "$2" = fail ] && [ -e "$dir/tmp/gate" ]; then ok=0; why="something was staged despite the refusal"; fi
  if [ "$ok" -eq 1 ] && [ -e "$dir/HEAD-SCRIPT-RAN" ]; then ok=0; why="a script from the pull request checkout ran"; fi
  if [ "$ok" -eq 1 ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: $why"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

for i in 0 1; do
  name=$(basename "${workflows[$i]}")
  run_case "$name: main has the gate, stages main's scripts" ok "$i" yes -
  run_case "$name: a pull request checkout next to it is neither staged nor run" ok "$i" yes head-with-bad-gate
  run_case "$name: bootstrap variables have no effect when main has the gate" ok "$i" yes bootstrap-vars
  run_case "$name: main has no gate, refuses" fail "$i" no -
  run_case "$name: main has no gate and bootstrap variables are set, still refuses" fail "$i" no bootstrap-vars
  run_case "$name: main has no gate and the head carries one, refuses and runs nothing from it" fail "$i" no head-with-bad-gate
done

# The workflows must not check out the pull request head or read the retired bootstrap variables at all.
for w in "${workflows[@]}"; do
  cases=$((cases + 1))
  if grep -q 'CODEX_GATE_BOOTSTRAP\|refs/pull/.*/head\|bootstrap staging' "$w"; then
    echo "FAIL  $(basename "$w") still carries bootstrap code"
    failures=$((failures + 1))
  else
    echo "ok    $(basename "$w") carries no bootstrap code"
  fi
done

if [ "$failures" -ne 0 ]; then
  echo "$failures workflow staging check(s) failed"
  exit 1
fi
echo "all workflow staging checks passed"
