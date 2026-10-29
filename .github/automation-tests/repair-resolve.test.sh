#!/usr/bin/env bash
# Tests the push job's "Resolve the Codex review threads" step with a fake gh. Only threads whose first comment was written by
# the pinned Codex App (numeric ID, login and type together) may be resolved. Human threads, impostors and threads that are
# already resolved are left alone, and any doubt (an API failure, more threads than one page) resolves nothing.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
workflow=${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0

python3 - "$workflow" "Resolve the Codex review threads" "$scratch/resolve.sh" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if step.get("name") == sys.argv[2]:
            open(sys.argv[3], "w").write(step["run"])
            sys.exit(0)
sys.exit("step not found: " + sys.argv[2])
PY

codex='{"id":199175422,"login":"chatgpt-codex-connector[bot]","type":"Bot"}'
impostor='{"id":1,"login":"chatgpt-codex-connector[bot]","type":"Bot"}'
human='{"id":326150552,"login":"zhrsidd","type":"User"}'

# Review comments by author: 101 Codex, 102 human, 103 Codex (thread already resolved), 104 impostor, 105 Codex,
# 106 Codex reply inside a thread that a human started (the first comment, 107, is the human's).
comments=$(jq -n --argjson c "$codex" --argjson i "$impostor" --argjson h "$human" \
  '[{id:101,user:$c},{id:102,user:$h},{id:103,user:$c},{id:104,user:$i},{id:105,user:$c},{id:106,user:$c},{id:107,user:$h}]')

thread() { # $1 id, $2 resolved, $3 first comment id
  jq -n --arg id "$1" --argjson r "$2" --argjson c "$3" '{id:$id,isResolved:$r,comments:{nodes:[{databaseId:$c}]}}'
}
threads_json() { # $1 hasNextPage, rest: thread objects
  local next=$1
  shift
  printf '%s\n' "$@" | jq -s --argjson n "$next" '{data:{repository:{pullRequest:{reviewThreads:{pageInfo:{hasNextPage:$n},nodes:.}}}}}'
}

all_threads=$(threads_json false \
  "$(thread T-codex-open false 101)" \
  "$(thread T-human-open false 102)" \
  "$(thread T-codex-done true 103)" \
  "$(thread T-impostor-open false 104)" \
  "$(thread T-codex-open-2 false 105)" \
  "$(thread T-human-started false 107)")

# $1 name, $2 want ok|fail, $3 expected resolved ids (space separated), $4 comments json, $5 threads json, $6 option (-|graphql-fails)
run_case() {
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" rc=0 out resolved
  mkdir -p "$dir"
  printf '%s' "$4" > "$dir/comments.json"
  printf '%s' "$5" > "$dir/threads.json"
  if [ "$6" = graphql-fails ]; then : > "$dir/graphql-fails"; fi
  : > "$dir/resolved.log"
  out=$(FAKE_DIR="$dir" PATH="$here/fake-gh:$PATH" GITHUB_REPOSITORY=o/r GH_TOKEN=tok PR=79 bash -e "$scratch/resolve.sh" 2>&1) || rc=$?
  resolved=$(sort "$dir/resolved.log" | tr '\n' ' ')
  local want_rc=0 ok=1 why=""
  if [ "$2" = fail ]; then want_rc=1; fi
  if [ "$rc" -ne 0 ] && [ "$want_rc" -eq 0 ]; then ok=0; why="step failed unexpectedly"; fi
  if [ "$rc" -eq 0 ] && [ "$want_rc" -ne 0 ]; then ok=0; why="step succeeded but should have failed"; fi
  if [ "${resolved% }" != "$3" ]; then ok=0; why="resolved '$resolved', want '$3'"; fi
  if [ "$2" = fail ] && [ "$6" != graphql-fails ] && ! grep -q '::error::' <<<"$out"; then ok=0; why="failed without the step's own ::error::"; fi
  if [ "$ok" -eq 1 ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: $why"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

run_case "resolves only Codex's own open threads (not human, impostor, resolved, or human-started ones)" ok "T-codex-open T-codex-open-2" "$comments" "$all_threads" -
run_case "resolves nothing when there are no open Codex threads" ok "" "$comments" \
  "$(threads_json false "$(thread T-human-open false 102)" "$(thread T-codex-done true 103)" "$(thread T-impostor-open false 104)")" -
run_case "an impostor with Codex's login but another ID is not resolved" ok "" "$comments" \
  "$(threads_json false "$(thread T-impostor-open false 104)")" -
run_case "resolves nothing when there is more than one page of threads" fail "" "$comments" \
  "$(threads_json true "$(thread T-codex-open false 101)")" -
run_case "resolves nothing when the thread query fails" fail "" "$comments" "$all_threads" graphql-fails

if [ "$failures" -ne 0 ]; then
  echo "$failures thread-resolution check(s) failed"
  exit 1
fi
echo "all thread-resolution checks passed"
