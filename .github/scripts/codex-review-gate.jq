# Decision logic for the Claude–Codex review loop. Pure: the input is the object assembled by
# codex-review-gate.sh; the output is {head_sha, needs_repair, ready_to_merge, reasons}.
#
# Codex is trusted only as its pinned GitHub App identity (numeric ID, login and type together).
# Anything else that copies its name or its summary text is ignored.
#
# Codex posts COMMENTED reviews with inline findings and a summary comment whose machine-readable state is
# <!-- codex-review-state:v1 {json} -->. It reacts with a thumbs-up, rather than approving, when it finds nothing,
# so a clean head is read from that summary state, never from a comment or reaction alone.

def codex_id: 199175422;
def codex_login: "chatgpt-codex-connector[bot]";
def is_codex: .id == codex_id and .login == codex_login and .type == "Bot";
def is_summary: contains("<!-- codex-pull-request-review-summary -->");

def summary_state:
  (split("codex-review-state:v1 ")[1] // "") | split(" -->")[0] | (try fromjson catch null);

. as $in
| $in.pr.head.sha as $head
| ($in.pr.head.repo.full_name == $in.repo) as $same_repo
| ($in.pr.base.ref == "main") as $base_main
| ($in.pr.state == "open") as $open
| ([$in.issue_comments[] | select((.user | is_codex) and (.body | is_summary))]
    | sort_by(.updated_at) | last | (.body // "") | summary_state // {}) as $state
| ($state.code_review // {}) as $code
| ($state.security_review // {}) as $security
| ($code.commit_sha == $head and $code.status == "completed") as $code_done
| ($code_done and $code.has_any_findings == false and $code.has_unresolved_findings == false) as $code_clean
| ($code.commit_sha == $head and $code.has_unresolved_findings == true) as $code_findings
| ($security.commit_sha == $head and $security.has_unresolved_findings == true) as $security_findings
| [$in.review_comments[] | select(.user | is_codex) | .id] as $codex_comments
| [$in.threads[] | select(.isResolved | not)] as $open_threads
| ([$open_threads[] | select(.first_comment_id as $c | any($codex_comments[]; . == $c))] | length) as $open_codex
| ($open_threads | length) as $open_any
# Comment-only reviews do not approve or dismiss a change request, so only decisive states set a reviewer's standing.
| ([$in.reviews[] | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED")]
    | group_by(.user.login) | map(sort_by(.submitted_at) | last | select(.state == "CHANGES_REQUESTED"))
    | length) as $changes_requested
| ([$in.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]?.context]) as $checks
| (any($checks[]; . == "verify") and any($checks[]; . == "codex-review-gate") and $in.branch_protected == true) as $verify_required
| ($same_repo and $base_main and $open) as $targetable
| ($targetable and ($open_codex > 0 or $code_findings)) as $needs_repair
| ($targetable and $in.pr.draft == false and $verify_required and $code_clean
    and ($security_findings | not) and $open_any == 0 and $changes_requested == 0) as $ready
| {
    head_sha: $head,
    needs_repair: $needs_repair,
    ready_to_merge: $ready,
    reasons: [
      if $same_repo | not then "head branch is not in this repository" else empty end,
      if $base_main | not then "base branch is not main" else empty end,
      if $open | not then "pull request is not open" else empty end,
      if $in.pr.draft then "pull request is a draft" else empty end,
      if $verify_required | not then "main has no ruleset requiring the verify and codex-review-gate checks" else empty end,
      if $code_clean | not then "Codex summary is not clean on the current head (status \($code.status // "missing") at \($code.commit_sha // "none"))" else empty end,
      if $code_findings then "Codex reports unresolved findings on the current head" else empty end,
      if $security_findings then "Codex security review reports unresolved findings on the current head" else empty end,
      if $open_codex > 0 then "\($open_codex) unresolved Codex thread(s)" else empty end,
      if ($open_any - $open_codex) > 0 then "\($open_any - $open_codex) unresolved thread(s) from others" else empty end,
      if $changes_requested > 0 then "a reviewer's latest review requests changes" else empty end
    ]
  }
