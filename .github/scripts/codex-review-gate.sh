#!/usr/bin/env bash
# Reads the pull request state the Claude–Codex loop depends on and prints the decision from codex-review-gate.jq
# as JSON. Read-only: it never comments, merges or edits anything. Any API failure stops the script (fails closed).
#
# Usage: codex-review-gate.sh <pull-number>
# Needs GH_TOKEN and GITHUB_REPOSITORY (set by Actions; export both locally to run it by hand).
set -euo pipefail

pr=${1:?usage: codex-review-gate.sh <pull-number>}
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be owner/name}
dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
owner=${repo%%/*}
name=${repo##*/}

# REST list endpoints: gh --paginate emits one array per page, so flatten them into a single array.
list() { gh api --paginate "$1" --jq '.[]' | jq -s '.'; }

pull=$(gh api "repos/$repo/pulls/$pr")
reviews=$(list "repos/$repo/pulls/$pr/reviews?per_page=100")
issue_comments=$(list "repos/$repo/issues/$pr/comments?per_page=100")
review_comments=$(list "repos/$repo/pulls/$pr/comments?per_page=100")
rules=$(list "repos/$repo/rules/branches/main?per_page=100")
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
threads='[]'
cursor=''
while :; do
  args=(-f "query=$thread_query" -F "owner=$owner" -F "name=$name" -F "number=$pr")
  if [ -n "$cursor" ]; then args+=(-F "cursor=$cursor"); fi
  page=$(gh api graphql "${args[@]}")
  threads=$(jq -n --argjson acc "$threads" --argjson page "$page" '
    $acc + [$page.data.repository.pullRequest.reviewThreads.nodes[]
      | {id, isResolved, isOutdated, first_comment_id: .comments.nodes[0].databaseId}]')
  jq -e '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<<"$page" >/dev/null || break
  cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<<"$page")
done

jq -n \
  --arg repo "$repo" \
  --argjson pr "$pull" \
  --argjson reviews "$reviews" \
  --argjson issue_comments "$issue_comments" \
  --argjson review_comments "$review_comments" \
  --argjson threads "$threads" \
  --argjson rules "$rules" \
  --argjson branch_protected "$branch_protected" \
  '{repo: $repo, pr: $pr, reviews: $reviews, issue_comments: $issue_comments, review_comments: $review_comments,
    threads: $threads, rules: $rules, branch_protected: $branch_protected}' \
  | jq -f "$dir/codex-review-gate.jq"
