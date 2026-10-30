#!/usr/bin/env bash
# Behavioural tests for the push job's "Request a fresh Codex review of the repaired head" step. Extracts the real step and
# runs it against a fake gh that reproduces the stale pull request head GitHub serves for a moment after a push. A successful
# push that created a commit must produce exactly one @codex review request for that commit, and nothing else may produce one.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
workflow=${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0
cases=0

python3 - "$workflow" "$scratch/step.sh" <<'PY'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for job in wf["jobs"].values():
    for step in job["steps"]:
        if step.get("name") == "Request a fresh Codex review of the repaired head":
            open(sys.argv[2], "w").write(step["run"])
            sys.exit(0)
sys.exit("step not found")
PY

reviewed=1111111111111111111111111111111111111111
pushed=2222222222222222222222222222222222222222
other=3333333333333333333333333333333333333333

# $1 name, $2 PUSHED_SHA, $3 REVIEW_SHA, $4 want exit (0|fail), $5 want number of requests in total, $6 times to run the step,
# $7 optional comments.json content.
run_case() {
  local name=$1 pushed_sha=$2 review_sha=$3 want_rc=$4 want_posts=$5 runs=${6:-1} comments=${7:-[]}
  cases=$((cases + 1))
  local dir="$scratch/case-$cases" rc=0 out="" posts=0
  mkdir -p "$dir"
  printf '%s' "$comments" > "$dir/comments.json"
  : > "$dir/posts.log"
  # GitHub still reports the reviewed commit as the head, whatever was pushed.
  printf '%s' "$review_sha" > "$dir/stale-head"
  for _ in $(seq "$runs"); do
    rc=0
    out=$(FAKE_DIR="$dir" PATH="$here/fake-gh-rereview:$PATH" GITHUB_REPOSITORY=o/r GH_TOKEN=tok PR=81 \
      REVIEW_SHA="$review_sha" PUSHED_SHA="$pushed_sha" bash -e "$scratch/step.sh" 2>&1) || rc=$?
  done
  posts=$(wc -l < "$dir/posts.log")
  local ok=1 why=""
  if [ "$want_rc" = 0 ] && [ "$rc" -ne 0 ]; then ok=0; why="step failed ($rc)"; fi
  if [ "$want_rc" = fail ] && [ "$rc" -eq 0 ]; then ok=0; why="step should have failed"; fi
  if [ "$ok" -eq 1 ] && [ "$posts" -ne "$want_posts" ]; then ok=0; why="$posts @codex requests, want $want_posts"; fi
  if [ "$ok" -eq 1 ] && [ "$posts" -gt 0 ]; then
    if ! grep -q '@codex review' "$dir/posts.log" || ! grep -qF "codex-rereview-request sha=$pushed_sha" "$dir/posts.log"; then
      ok=0; why="the request is not '@codex review' with the marker for the pushed commit"
    fi
  fi
  if [ "$ok" -eq 1 ]; then
    echo "ok    $name"
  else
    echo "FAIL  $name: $why"
    while IFS= read -r line; do echo "        $line"; done <<<"$out"
    failures=$((failures + 1))
  fi
}

# The race: GET /pulls/N still returns the reviewed commit when the step runs just after the push.
run_case "stale pull request head after a push still produces one review request" "$pushed" "$reviewed" 0 1
run_case "a second run for the same commit adds no second request" "$pushed" "$reviewed" 0 1 2
run_case "an earlier request for the same commit is not repeated" "$pushed" "$reviewed" 0 0 1 \
  "[{\"body\":\"@codex review\\n\\n<!-- codex-rereview-request sha=$pushed -->\"}]"
run_case "a request for an older commit does not block the new one" "$pushed" "$reviewed" 0 1 1 \
  "[{\"body\":\"<!-- codex-rereview-request sha=$other -->\"}]"

# Nothing pushed, nothing requested.
run_case "no new commit (pushed sha equals the reviewed one) requests nothing" "$reviewed" "$reviewed" 0 0
run_case "a missing sha from the push step fails loudly and requests nothing" "" "$reviewed" fail 0
run_case "a malformed sha fails and requests nothing" "not-a-sha" "$reviewed" fail 0
run_case "an abbreviated sha fails and requests nothing" "${pushed:0:7}" "$reviewed" fail 0

if [ "$failures" -ne 0 ]; then
  echo "$failures repair re-review check(s) failed"
  exit 1
fi
echo "all repair re-review checks passed"
