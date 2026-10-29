#!/usr/bin/env bash
# Offline tests for the Codex review gate. Each case edits a snapshot of PR #79 (captured from the GitHub API on
# 2026-10-29) and asserts the decision from codex-review-gate.jq. No network access; needs jq.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
scripts=$(cd "$here/.." && pwd)
workflows=$(cd "$here/../../workflows" && pwd)
snapshot="$here/fixtures/pr-79-snapshot.json"
head=$(jq -r .pr.head.sha "$snapshot")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0

clean_code="{\"commit_sha\":\"$head\",\"status\":\"completed\",\"has_any_findings\":false,\"has_unresolved_findings\":false}"
no_security='{"commit_sha":null,"has_any_findings":null,"has_unresolved_findings":null,"status":null}'

# Replaces Codex's summary comment with one carrying the given code_review and security_review state, exactly as Codex
# writes it, and prints the whole snapshot.
with_summary() { # $1 code_review JSON, $2 security_review JSON
  jq --argjson code "$1" --argjson security "${2:-$no_security}" '
    .issue_comments |= map(
      if (.user.id == 199175422 and (.body | contains("codex-pull-request-review-summary")))
      then .body = "<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 "
          + ({code_review: $code, security_review: $security} | tojson) + " -->"
      else . end)' "$snapshot"
}

# Runs the decision logic on a snapshot JSON and compares ready_to_merge and needs_repair with the expectation.
check() { # $1 name, $2 want ready, $3 want needs_repair, $4 snapshot JSON
  local got ready repair
  got=$(printf '%s' "$4" | jq -f "$scripts/codex-review-gate.jq")
  ready=$(jq -r .ready_to_merge <<<"$got")
  repair=$(jq -r .needs_repair <<<"$got")
  if [ "$ready" = "$2" ] && [ "$repair" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: ready=$ready (want $2), needs_repair=$repair (want $3)"
    jq -c .reasons <<<"$got"
    failures=$((failures + 1))
  fi
}

# Cases. The snapshot as captured has open Codex findings on its head and is still a draft.
check "PR #79 as captured: Codex findings open, draft" false true "$(cat "$snapshot")"

clean=$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true)')
check "clean on current head, threads resolved, verify required" true false "$clean"

check "clean but threads still unresolved blocks merge and keeps repair on" false true \
  "$(with_summary "$clean_code" | jq '.pr.draft = false')"

check "clean summary for an older commit does not count" false false \
  "$(with_summary '{"commit_sha":"dc72afa6ad4a6c7aa2f0e957328b8790a2744e82","status":"completed","has_any_findings":false,"has_unresolved_findings":false}' \
    | jq '.pr.draft = false | .threads |= map(.isResolved = true)')"

check "clean summary still in progress does not count" false false \
  "$(with_summary "{\"commit_sha\":\"$head\",\"status\":\"in_progress\",\"has_any_findings\":false,\"has_unresolved_findings\":false}" \
    | jq '.pr.draft = false | .threads |= map(.isResolved = true)')"

check "clean summary posted by a human is ignored" false false \
  "$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true)
    | .issue_comments |= map(.user = {login: "zhrsidd", id: 326150552, type: "User"})')"

check "same bot login with a different numeric ID is not Codex" false false \
  "$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true)
    | (.reviews, .issue_comments, .review_comments) |= map(if .user.login == "chatgpt-codex-connector[bot]" then .user.id = 1 else . end)')"

check "unresolved thread from a human blocks merge" false false \
  "$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true)
    | .threads += [{id: "PRRT_human", isResolved: false, isOutdated: false, first_comment_id: 5550001}]')"

check "reviewer's latest review requests changes" false false \
  "$(with_summary "$clean_code" | jq --arg head "$head" '.pr.draft = false | .threads |= map(.isResolved = true)
    | .reviews += [{id: 1, state: "CHANGES_REQUESTED", commit_id: $head, submitted_at: "2026-10-29T21:00:00Z",
        user: {login: "zhrsidd", id: 326150552, type: "User"}}]')"

check "a comment-only follow-up does not clear a standing change request" false false \
  "$(with_summary "$clean_code" | jq --arg head "$head" '.pr.draft = false | .threads |= map(.isResolved = true)
    | .reviews += [{id: 1, state: "CHANGES_REQUESTED", commit_id: $head, submitted_at: "2026-10-29T21:00:00Z",
        user: {login: "zhrsidd", id: 326150552, type: "User"}},
      {id: 2, state: "COMMENTED", commit_id: $head, submitted_at: "2026-10-29T21:05:00Z",
        user: {login: "zhrsidd", id: 326150552, type: "User"}}]')"

check "Codex security review with unresolved findings on head blocks merge" false false \
  "$(with_summary "$clean_code" "{\"commit_sha\":\"$head\",\"status\":\"completed\",\"has_any_findings\":true,\"has_unresolved_findings\":true}" \
    | jq '.pr.draft = false | .threads |= map(.isResolved = true)')"

check "no ruleset requiring verify blocks merge" false false \
  "$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true) | .rules = []')"

check "ruleset with verify but not the codex-review-gate status blocks merge" false false \
  "$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true)
    | .rules[0].parameters.required_status_checks = [{context: "verify"}]')"

check "unprotected main blocks merge" false false \
  "$(with_summary "$clean_code" | jq '.pr.draft = false | .threads |= map(.isResolved = true) | .branch_protected = false')"

check "draft pull request is never merged" false false \
  "$(with_summary "$clean_code" | jq '.threads |= map(.isResolved = true)')"

check "head from a fork is never merged or repaired" false false \
  "$(jq '.pr.head.repo.full_name = "someone/MUNOS"' "$snapshot")"

check "base other than main is never merged or repaired" false false \
  "$(jq '.pr.base.ref = "release"' "$snapshot")"

# End to end through codex-review-gate.sh: the fake gh serves the snapshot, so pagination and GraphQL joins run for real.
fake_dir=$(cd "$here/fake-gh" && pwd)
chmod +x "$fake_dir/gh"
printf '%s' "$clean" > "$scratch/clean.json"
e2e() { # $1 name, $2 snapshot file, $3 want ready, $4 want needs_repair
  local got
  got=$(PATH="$fake_dir:$PATH" FAKE_SNAPSHOT="$2" GITHUB_REPOSITORY=zhrsidd/MUNOS GH_TOKEN=test \
    "$scripts/codex-review-gate.sh" 79)
  if [ "$(jq -r .ready_to_merge <<<"$got")" = "$3" ] && [ "$(jq -r .needs_repair <<<"$got")" = "$4" ] \
    && [ "$(jq -r .head_sha <<<"$got")" = "$head" ]; then
    echo "ok    gate script: $1"
  else
    echo "FAIL  gate script: $1"
    echo "$got"
    failures=$((failures + 1))
  fi
}
printf '%s' "$(cat "$snapshot")" > "$scratch/current.json"
e2e "PR #79 as captured" "$scratch/current.json" false true
e2e "clean head, threads resolved" "$scratch/clean.json" true false

# Every workflow and the decision logic must pin the same Codex App ID; a stale copy would silently skip Codex.
for file in "$scripts/codex-review-gate.jq" "$workflows/claude-review-repair.yml" "$workflows/codex-reviewed-automerge.yml"; do
  if grep -q 199175422 "$file"; then
    echo "ok    pinned Codex ID in $(basename "$file")"
  else
    echo "FAIL  pinned Codex ID missing from $(basename "$file")"
    failures=$((failures + 1))
  fi
done
# shellcheck disable=SC2016 # the ${{ }} is a literal workflow expression, not a shell expansion
if grep -q 'claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}' "$workflows/claude-review-repair.yml" \
  && ! grep -rq ANTHROPIC_API_KEY "$workflows"; then
  echo "ok    repair uses CLAUDE_CODE_OAUTH_TOKEN and no workflow reads ANTHROPIC_API_KEY"
else
  echo "FAIL  repair must authenticate with CLAUDE_CODE_OAUTH_TOKEN and no workflow may read ANTHROPIC_API_KEY"
  failures=$((failures + 1))
fi
if grep -rq CODEX_REVIEWER_LOGIN "$workflows"; then
  echo "FAIL  workflows still read CODEX_REVIEWER_LOGIN, which cannot distinguish a bot from a spoofed name"
  failures=$((failures + 1))
else
  echo "ok    no workflow relies on CODEX_REVIEWER_LOGIN"
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
