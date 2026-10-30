#!/usr/bin/env bash
# Static checks on the repair workflow's write safety. They fail if a later edit gives the job that runs Claude a way to push
# (a write-scoped token, the push secret, a git push), moves the push before the changed-file check, or lets a secret reach a
# step that should not hold one. Also checks that CLAUDE.md still states the protected-path rules the workflow enforces.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)

python3 - "${WORKFLOW:-$repo/.github/workflows/claude-review-repair.yml}" "$repo/CLAUDE.md" <<'PY'
import sys, yaml

workflow_path, claude_md_path = sys.argv[1], sys.argv[2]
wf = yaml.safe_load(open(workflow_path))
text = open(workflow_path).read()
claude_md = open(claude_md_path).read()
failures = []

def check(ok, message):
    print(("ok    " if ok else "FAIL  ") + message)
    if not ok:
        failures.append(message)

def blob(step):
    return yaml.safe_dump(step)

on = wf.get(True, wf.get("on"))
jobs = wf["jobs"]
repair, push = jobs["repair"], jobs["push"]

# Triggers and top-level permissions.
check(set(on.keys()) == {"pull_request_review"}, "only the pull_request_review trigger is used (no pull_request_target or workflow_run)")
check(wf["permissions"] == {"contents": "read"}, "workflow-level permissions are contents: read")

# The repair job runs Claude with a shell, so it must not be able to push.
check(repair["permissions"].get("contents") == "read", "repair job has contents: read, not write")
check({k for k, v in repair["permissions"].items() if v == "write"} == {"issues"},
      "repair job can write only issues (comments), so it cannot resolve threads or dismiss reviews")
check(repair["permissions"].get("pull-requests") == "read", "repair job has pull-requests: read, not write")
every_permission = [wf["permissions"]] + [j.get("permissions", {}) for j in jobs.values()]
check(all("id-token" not in p for p in every_permission),
      "no job can request an OIDC token, so the action cannot exchange for the write-capable Claude App token")
check("CLAUDE_AUTOMATION_TOKEN" not in blob(repair), "repair job never references the push token")
check("git push" not in blob(repair).replace("Bash(git push:*)", ""), "repair job runs no git push")
claude_steps = [s for s in repair["steps"] if str(s.get("uses", "")).startswith("anthropics/claude-code-action")]
check(len(claude_steps) == 1, "repair job has exactly one Claude step")
claude = claude_steps[0]
check(claude["with"].get("github_token") == "${{ github.token }}",
      "Claude gets the read-only workflow token, not the push token or the app token exchange")
check("--disallowedTools" in claude["with"].get("claude_args", "") and "git push" in claude["with"].get("claude_args", ""),
      "Claude's tool list disallows git push")
check(set(repair["outputs"].keys()) == {"has_patch", "thread_ids"}, "repair job exposes only whether a patch exists and the captured thread IDs")
check("Resolve each review thread" not in claude["with"].get("prompt", "") and "Do not resolve or dismiss" in claude["with"].get("prompt", ""),
      "Claude's prompt tells it not to resolve or dismiss reviews and threads")

# The threads to resolve are captured before Claude runs, and Claude does not run without them.
rnames = [st.get("name", "") for st in repair["steps"]]
cap_i = rnames.index("Capture the Codex threads of the review being repaired")
claude_i = next(i for i, st in enumerate(repair["steps"]) if str(st.get("uses", "")).startswith("anthropics/claude-code-action"))
check(cap_i < claude_i, "the Codex threads are captured before Claude runs")
check("steps.install.outcome == 'success'" in str(claude.get("if", "")), "Claude runs only when the dependency install succeeded")
install_i = next(i for i, st in enumerate(repair["steps"]) if st.get("id") == "install")
node_i = next(i for i, st in enumerate(repair["steps"]) if str(st.get("uses", "")).startswith("actions/setup-node@"))
head_i = next(i for i, st in enumerate(repair["steps"]) if str(st.get("uses", "")).startswith("actions/checkout@") and "head.sha" in str(st.get("with", {})))
check(head_i < node_i < install_i < claude_i, "the head is checked out, Node is set up and dependencies are installed before Claude runs")
check(repair["steps"][node_i]["with"].get("node-version") == 22, "Node 22 is set up, as in ci.yml")
check(repair["steps"][install_i]["run"].strip() == "npm ci --ignore-scripts --no-audit --no-fund",
      "dependencies come from the lockfile with lifecycle scripts disabled")
check("secrets." not in blob(repair["steps"][install_i]) and "secrets." not in blob(repair["steps"][node_i]) and "env" not in repair["steps"][install_i],
      "the install and Node setup steps hold no secret or injected environment")
check("steps.capture.outcome == 'success'" in str(repair["steps"][install_i].get("if", "")), "the install runs only after the thread capture succeeded")
patch_step = next(st for st in repair["steps"] if st.get("name") == "Collect Claude's edits as a patch")
check("steps.install.outcome == 'success'" in str(patch_step.get("if", "")), "the patch is collected only when Claude had its dependencies")
cap_step = next(st for st in repair["steps"] if st.get("id") == "cap")
check("-ge 5" in cap_step["run"] and "-ge 3" not in cap_step["run"] and "five automated review-repair commits" in cap_step["run"],
      "the repair cap is five and its NEEDS_DECISION notice says so")
check(repair["steps"][cap_i]["env"].get("GH_TOKEN") == "${{ github.token }}" and "REVIEW_ID" in repair["steps"][cap_i]["env"],
      "the capture uses the read-only token and the review that triggered the run")

# The push job holds the push token, and only after the changed-file check.
steps = push["steps"]
names = [s.get("name", "") for s in steps]
apply_i = names.index("Apply the patch and check every changed file")
push_i = names.index("Push the checked repair")
check(push["needs"] == "repair", "push job needs the repair job")
check(push["permissions"] == {"contents": "read"}, "push job has contents: read only")
check(apply_i < push_i, "the changed-file check runs before the push")
check("steps.apply.outputs.changed == 'true'" in str(steps[push_i].get("if", "")), "the push runs only when the check passed and left changes")
holders = [s.get("name", "") for s in steps if "CLAUDE_AUTOMATION_TOKEN" in blob(s)]
check(holders == ["Push the checked repair", "Resolve the Codex review threads", "Request a fresh Codex review of the repaired head"],
      "only the push, the re-review request and the Codex-thread resolver hold the push token")
resolve_i = names.index("Resolve the Codex review threads")
check(resolve_i > push_i and "steps.push.outcome == 'success'" in str(steps[resolve_i].get("if", "")),
      "threads are resolved only after a successful push")
rereview_i = names.index("Request a fresh Codex review of the repaired head")
rereview = steps[rereview_i]
check(rereview_i > push_i and "steps.push.outcome == 'success'" in str(rereview.get("if", "")),
      "the re-review request runs only after a successful push")
check(rereview_i > names.index("Resolve the Codex review threads"),
      "the re-review is requested after the threads are resolved, so a clean re-review cannot reach the gate while they are open")
check("always()" in str(rereview.get("if", "")), "a failed thread resolution does not stop the re-review request")
check(rereview["env"].get("PUSHED_SHA") == "${{ steps.push.outputs.sha }}",
      "the re-review request takes the commit from the push step's output")
check("pulls/$PR" not in rereview["run"] and ".head.sha" not in rereview["run"],
      "the re-review request never reads the pull request's head, which GitHub refreshes a moment after a push")
check("echo \"sha=$(git rev-parse HEAD)\" >> \"$GITHUB_OUTPUT\"" in steps[push_i]["run"],
      "the push step reports the commit it pushed")
resolver = steps[resolve_i]
check(resolver["env"].get("THREAD_IDS") == "${{ needs.repair.outputs.thread_ids }}" and resolver["env"].get("REVIEW_ID") == "${{ github.event.review.id }}",
      "the resolver takes the captured thread IDs and the repaired review's ID")
check("$captured" in resolver["run"] and "pull_request_review_id == $review" in resolver["run"],
      "the resolver closes only captured threads that belong to the repaired review")
check("secrets." not in blob(steps[apply_i]), "the changed-file check holds no secret")
pushers = [s.get("name", "") for s in steps if "git push" in str(s.get("run", ""))]
check(pushers == ["Push the checked repair"], "git push appears only in the guarded push step")
check("git push" not in "".join(str(s.get("run", "")) for s in repair["steps"]), "no git push in the repair job's scripts")

# The repair job drops protected paths with a copy of the push job's protected() function. The copies must not drift: the
# convenience filter has to agree with the real guard, or repairs would fail closed (or the filter would hide changes).
import re as _re
def protected_fn(step_name, jobs_):
    for job in jobs_.values():
        for step in job["steps"]:
            if step.get("name") == step_name:
                m = _re.search(r"protected\(\) \{\n.*?\n\s*\}\n", step["run"], _re.S)
                return None if m is None else "\n".join(line.strip() for line in m.group(0).splitlines())
    return None
filter_fn = protected_fn("Collect Claude's edits as a patch", jobs)
guard_fn = protected_fn("Apply the patch and check every changed file", jobs)
check(filter_fn is not None and filter_fn == guard_fn, "the patch step and the push job use the same protected() function")

# Secrets used anywhere in the workflow are the two expected ones.
import re
secrets_used = sorted(set(re.findall(r"secrets\.([A-Z_]+)", text)))
check(secrets_used == ["CLAUDE_AUTOMATION_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"], "the workflow reads only the two expected secrets: " + ", ".join(secrets_used))

# CLAUDE.md states what the workflow enforces.
check("## Protected paths in automated review repairs" in claude_md, "CLAUDE.md has the protected-paths section")
section = claude_md.split("## Protected paths in automated review repairs", 1)[1]
for needle in [".github/", ".claude/", ".mcp.json", ".env", "CLAUDE.md", "AGENTS.md", "package.json", "npm-shrinkwrap.json", "supabase/",
               "target-guard.ts", "NEEDS_DECISION", "symlinks", "Do not commit or push", "resolve or dismiss"]:
    check(needle in section, f"CLAUDE.md protected-paths section mentions {needle}")

if failures:
    print(f"{len(failures)} invariant(s) failed")
    sys.exit(1)
print("all repair workflow invariants hold")
PY
