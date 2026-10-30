#!/usr/bin/env bash
# Reads the pull request state the Claude–Codex loop depends on and prints the decision from codex-review-gate.jq
# as JSON. Read-only: it never comments, merges or edits anything. Any API failure stops the script (fails closed).
#
# Usage: codex-review-gate.sh <pull-number>
# Needs GH_TOKEN and GITHUB_REPOSITORY (set by Actions; export both locally to run it by hand).
set -euo pipefail

pr=${1:?usage: codex-review-gate.sh <pull-number>}
if [[ ! "$pr" =~ ^[1-9][0-9]{0,9}$ ]] || (( pr > 2147483647 )); then
  echo "::error::Invalid PR identifier: expected a positive GraphQL integer." >&2
  exit 1
fi
trap 'echo "::error::GitHub API/authentication or gate data evaluation failed; refusing to clear the gate." >&2' ERR
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be owner/name}
dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
owner=${repo%%/*}
name=${repo##*/}

# The PR data goes through files, never through command-line arguments: Linux caps a single argument at 128 KiB, and a
# long review conversation is larger than that (jq fails with "Argument list too long").
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# REST list endpoints: gh --paginate emits one array per page, so flatten them into a single array in a file.
list() { gh api --paginate "$1" --jq '.[]' | jq -s '.' > "$2"; }

gh api "repos/$repo/pulls/$pr" > "$work/pr.json"
list "repos/$repo/pulls/$pr/reviews?per_page=100" "$work/reviews.json"
list "repos/$repo/issues/$pr/comments?per_page=100" "$work/issue_comments.json"
list "repos/$repo/pulls/$pr/comments?per_page=100" "$work/review_comments.json"
list "repos/$repo/rules/branches/main?per_page=100" "$work/rules.json"
branch_protected=$(gh api "repos/$repo/branches/main" --jq '.protected')

# Review threads (resolution state) exist only in GraphQL. first_comment_id joins each thread to its REST comment,
# where the author's numeric ID is available. The $variables are GraphQL's, so they must stay unexpanded.
# shellcheck disable=SC2016
thread_query='query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved isOutdated comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}'
echo '[]' > "$work/threads.json"
cursor=''
while :; do
  args=(-f "query=$thread_query" -F "owner=$owner" -F "name=$name" -F "number=$pr")
  if [ -n "$cursor" ]; then args+=(-F "cursor=$cursor"); fi
  gh api graphql "${args[@]}" > "$work/page.json"
  jq -s '.[0] + [.[1].data.repository.pullRequest.reviewThreads.nodes[]
      | {id, isResolved, isOutdated, first_comment_id: .comments.nodes[0].databaseId}]' \
    "$work/threads.json" "$work/page.json" > "$work/threads.next"
  mv "$work/threads.next" "$work/threads.json"
  jq -e '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' "$work/page.json" >/dev/null || break
  cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' "$work/page.json")
done

jq -n \
  --arg repo "$repo" \
  --argjson branch_protected "$branch_protected" \
  --slurpfile pr "$work/pr.json" \
  --slurpfile reviews "$work/reviews.json" \
  --slurpfile issue_comments "$work/issue_comments.json" \
  --slurpfile review_comments "$work/review_comments.json" \
  --slurpfile threads "$work/threads.json" \
  --slurpfile rules "$work/rules.json" \
  '{repo: $repo, pr: $pr[0], reviews: $reviews[0], issue_comments: $issue_comments[0],
    review_comments: $review_comments[0], threads: $threads[0], rules: $rules[0], branch_protected: $branch_protected}' \
  | jq -f "$dir/codex-review-gate.jq"
