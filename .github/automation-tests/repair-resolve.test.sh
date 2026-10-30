#!/usr/bin/env bash
# Tests how the repair workflow decides which review threads to resolve, with a fake gh. The repair job's capture step records
# the open Codex threads of the review being repaired before Claude runs; the push job's resolver closes only those, after
# checking each again. Human threads, impostors, threads of a newer or an older Codex review and threads that are already
# resolved are never closed, and any doubt (a bad list, an API failure, more threads than one page) resolves nothing.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
workflow=${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0

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
extract_step "Capture the Codex threads of the review being repaired" "$scratch/capture.sh"
extract_step "Resolve the Codex review threads" "$scratch/resolve.sh"

codex='{"id":199175422,"login":"chatgpt-codex-connector[bot]","type":"Bot"}'
impostor='{"id":1,"login":"chatgpt-codex-connector[bot]","type":"Bot"}'
human='{"id":326150552,"login":"zhrsidd","type":"User"}'

# The review being repaired is 500. Review 400 is an earlier Codex generation, review 600 a newer one that lands while the
# repair runs, and review 700 is a human's.
#  101, 105  Codex, review 500, open threads: these are the ones to capture and resolve
#  102       human, review 700
#  103       Codex, review 500, thread already resolved
#  104       impostor with Codex's login and another ID, review 500
#  106/107   a Codex reply inside a thread that a human started (first comment 107, human's, in review 500)
#  108       Codex, review 600 (newer), open
#  109       Codex, review 400 (older), open
comments=$(jq -n --argjson c "$codex" --argjson i "$impostor" --argjson h "$human" '[
  {id:101,user:$c,pull_request_review_id:500},{id:102,user:$h,pull_request_review_id:700},
  {id:103,user:$c,pull_request_review_id:500},{id:104,user:$i,pull_request_review_id:500},
  {id:105,user:$c,pull_request_review_id:500},{id:106,user:$c,pull_request_review_id:500},
  {id:107,user:$h,pull_request_review_id:500},{id:108,user:$c,pull_request_review_id:600},
  {id:109,user:$c,pull_request_review_id:400}]')

thread() { # $1 id, $2 resolved, $3 first comment id
  jq -n --arg id "$1" --argjson r "$2" --argjson c "$3" '{id:$id,isResolved:$r,comments:{nodes:[{databaseId:$c}]}}'
}
threads_json() { # $1 hasNextPage, rest: thread objects
  local next=$1
  shift
  printf '%s\n' "$@" | jq -s --argjson n "$next" '{data:{repository:{pullRequest:{reviewThreads:{pageInfo:{hasNextPage:$n},nodes:.}}}}}'
}

open1=PRRT_codexOpen1
open2=PRRT_codexOpen2
all_threads=$(threads_json false \
  "$(thread $open1 false 101)" \
  "$(thread PRRT_humanOpen false 102)" \
  "$(thread PRRT_codexDone true 103)" \
  "$(thread PRRT_impostorOpen false 104)" \
  "$(thread $open2 false 105)" \
  "$(thread PRRT_humanStarted false 107)" \
  "$(thread PRRT_newerReview false 108)" \
  "$(thread PRRT_olderReview false 109)")

report() { # $1 name, $2 ok flag, $3 reason, $4 output
  if [ "$2" -eq 1 ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: $3"
    while IFS= read -r line; do echo "        $line"; done <<<"$4"
    failures=$((failures + 1))
  fi
}

# Capture. $1 name, $2 want ok|fail, $3 expected thread_ids (sorted, space separated), $4 comments, $5 threads, $6 option
# (-|graphql-fails), $7 review id.
capture_case() {
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" rc=0 out got ok=1 why=""
  mkdir -p "$dir"
  printf '%s' "$4" > "$dir/comments.json"
  printf '%s' "$5" > "$dir/threads.json"
  if [ "$6" = graphql-fails ]; then : > "$dir/graphql-fails"; fi
  : > "$dir/out"
  out=$(FAKE_DIR="$dir" PATH="$here/fake-gh:$PATH" GITHUB_REPOSITORY=o/r GH_TOKEN=tok PR=79 REVIEW_ID="${7:-500}" \
    GITHUB_OUTPUT="$dir/out" bash -e "$scratch/capture.sh" 2>&1) || rc=$?
  got=$(grep '^thread_ids=' "$dir/out" | cut -d= -f2- | jq -r 'sort | join(" ")' 2>/dev/null || true)
  if [ "$2" = ok ] && [ "$rc" -ne 0 ]; then ok=0; why="capture failed unexpectedly"; fi
  if [ "$2" = fail ] && [ "$rc" -eq 0 ]; then ok=0; why="capture succeeded but should have failed"; fi
  if [ "$ok" -eq 1 ] && [ "$2" = ok ] && [ "$got" != "$3" ]; then ok=0; why="captured '$got', want '$3'"; fi
  if [ "$ok" -eq 1 ] && [ "$2" = fail ] && [ -s "$dir/out" ]; then ok=0; why="a failed capture still wrote an output"; fi
  report "capture: $1" "$ok" "$why" "$out"
}

# Resolve. $1 name, $2 want ok|fail, $3 expected resolved ids (sorted, space separated), $4 THREAD_IDS, $5 comments, $6 threads,
# $7 option (-|graphql-fails), $8 review id.
resolve_case() {
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" rc=0 out resolved ok=1 why=""
  mkdir -p "$dir"
  printf '%s' "$5" > "$dir/comments.json"
  printf '%s' "$6" > "$dir/threads.json"
  if [ "$7" = graphql-fails ]; then : > "$dir/graphql-fails"; fi
  : > "$dir/resolved.log"
  out=$(FAKE_DIR="$dir" PATH="$here/fake-gh:$PATH" GITHUB_REPOSITORY=o/r GH_TOKEN=tok PR=79 REVIEW_ID="${8:-500}" \
    THREAD_IDS="$4" bash -e "$scratch/resolve.sh" 2>&1) || rc=$?
  resolved=$(sort "$dir/resolved.log" | tr '\n' ' ')
  if [ "$2" = ok ] && [ "$rc" -ne 0 ]; then ok=0; why="step failed unexpectedly"; fi
  if [ "$2" = fail ] && [ "$rc" -eq 0 ]; then ok=0; why="step succeeded but should have failed"; fi
  if [ "${resolved% }" != "$3" ]; then ok=0; why="resolved '$resolved', want '$3'"; fi
  if [ "$ok" -eq 1 ] && [ "$2" = fail ] && [ "$7" != graphql-fails ] && ! grep -q '::error::' <<<"$out"; then ok=0; why="failed without the step's own ::error::"; fi
  report "resolve: $1" "$ok" "$why" "$out"
}

# --- Capture: only the open Codex threads of the review being repaired.
capture_case "takes the open Codex threads of the repaired review, not human, impostor, resolved, newer or older ones" ok \
  "$open1 $open2" "$comments" "$all_threads" -
capture_case "a thread a human started is not captured even with a Codex reply in it" ok "" "$comments" \
  "$(threads_json false "$(thread PRRT_humanStarted false 107)")" -
capture_case "repairing the newer review captures only its own thread" ok "PRRT_newerReview" "$comments" "$all_threads" - 600
capture_case "repairing the older review captures only its own thread" ok "PRRT_olderReview" "$comments" "$all_threads" - 400
capture_case "a review with no Codex threads captures an empty list" ok "" "$comments" "$all_threads" - 999
capture_case "an impostor with Codex's login but another ID is not captured" ok "" "$comments" \
  "$(threads_json false "$(thread PRRT_impostorOpen false 104)")" -
capture_case "more than one page of threads fails and captures nothing" fail "" "$comments" \
  "$(threads_json true "$(thread $open1 false 101)")" -
capture_case "a failing thread query fails and captures nothing" fail "" "$comments" "$all_threads" graphql-fails
capture_case "a non-numeric review ID fails and captures nothing" fail "" "$comments" "$all_threads" - "5;rm"

# --- Resolve: only the captured threads, each checked again.
both="[\"$open1\",\"$open2\"]"
resolve_case "resolves exactly the captured threads while a newer review's thread sits open" ok "$open1 $open2" "$both" "$comments" "$all_threads" -
resolve_case "a newer Codex review that landed before the resolver ran is left open" ok "$open1 $open2" "$both" "$comments" "$all_threads" -
resolve_case "an older Codex review's open thread is left open" ok "$open1" "[\"$open1\"]" "$comments" "$all_threads" -
resolve_case "an empty captured list resolves nothing" ok "" "[]" "$comments" "$all_threads" -
resolve_case "a tampered list naming a human thread does not resolve it" ok "$open1" "[\"$open1\",\"PRRT_humanOpen\"]" "$comments" "$all_threads" -
resolve_case "a tampered list naming a human-started thread does not resolve it" ok "" "[\"PRRT_humanStarted\"]" "$comments" "$all_threads" -
resolve_case "a tampered list naming an impostor's thread does not resolve it" ok "" "[\"PRRT_impostorOpen\"]" "$comments" "$all_threads" -
resolve_case "a tampered list naming the newer review's thread does not resolve it" ok "" "[\"PRRT_newerReview\"]" "$comments" "$all_threads" -
resolve_case "a tampered list naming the older review's thread does not resolve it" ok "" "[\"PRRT_olderReview\"]" "$comments" "$all_threads" -
resolve_case "a captured thread that is already resolved is not resolved again" ok "" "[\"PRRT_codexDone\"]" "$comments" "$all_threads" -
resolve_case "a captured thread the repaired review does not own is not resolved" ok "" "[\"$open1\"]" "$comments" "$all_threads" - 600
resolve_case "a missing captured list resolves nothing and fails" fail "" "" "$comments" "$all_threads" -
resolve_case "a captured list that is not JSON resolves nothing and fails" fail "" "not json" "$comments" "$all_threads" -
resolve_case "a captured list that is not an array resolves nothing and fails" fail "" "{\"a\":1}" "$comments" "$all_threads" -
resolve_case "a captured list with a malformed thread ID resolves nothing and fails" fail "" "[\"$open1\",\"x y\"]" "$comments" "$all_threads" -
resolve_case "a captured list over 100 entries resolves nothing and fails" fail "" \
  "$(jq -nc '[range(101) | "PRRT_a\(.)"]')" "$comments" "$all_threads" -
resolve_case "more than one page of threads resolves nothing and fails" fail "" "$both" "$comments" \
  "$(threads_json true "$(thread $open1 false 101)")" -
resolve_case "a failing thread query resolves nothing and fails" fail "" "$both" "$comments" "$all_threads" graphql-fails
resolve_case "a non-numeric review ID resolves nothing and fails" fail "" "$both" "$comments" "$all_threads" - "5;rm"

if [ "$failures" -ne 0 ]; then
  echo "$failures thread check(s) failed"
  exit 1
fi
echo "all thread checks passed"
