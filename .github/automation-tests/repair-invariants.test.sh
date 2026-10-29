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
check("write" not in [v for k, v in repair["permissions"].items() if k not in ("pull-requests", "issues")],
      "repair job grants write only to pull-requests and issues")
check("CLAUDE_AUTOMATION_TOKEN" not in blob(repair), "repair job never references the push token")
check("git push" not in blob(repair).replace("Bash(git push:*)", ""), "repair job runs no git push")
claude_steps = [s for s in repair["steps"] if str(s.get("uses", "")).startswith("anthropics/claude-code-action")]
check(len(claude_steps) == 1, "repair job has exactly one Claude step")
claude = claude_steps[0]
check(claude["with"].get("github_token") == "${{ github.token }}",
      "Claude gets the read-only workflow token, not the push token or the app token exchange")
check("--disallowedTools" in claude["with"].get("claude_args", "") and "git push" in claude["with"].get("claude_args", ""),
      "Claude's tool list disallows git push")
check(set(repair["outputs"].keys()) == {"has_patch"}, "repair job exposes only whether a patch exists")

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
check(holders == ["Push the checked repair", "Request a fresh Codex review of the repaired head"],
      "only the push and the re-review request hold the push token")
check("secrets." not in blob(steps[apply_i]), "the changed-file check holds no secret")
pushers = [s.get("name", "") for s in steps if "git push" in str(s.get("run", ""))]
check(pushers == ["Push the checked repair"], "git push appears only in the guarded push step")
check("git push" not in "".join(str(s.get("run", "")) for s in repair["steps"]), "no git push in the repair job's scripts")

# Secrets used anywhere in the workflow are the two expected ones.
import re
secrets_used = sorted(set(re.findall(r"secrets\.([A-Z_]+)", text)))
check(secrets_used == ["CLAUDE_AUTOMATION_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"], "the workflow reads only the two expected secrets: " + ", ".join(secrets_used))

# CLAUDE.md states what the workflow enforces.
check("## Protected paths in automated review repairs" in claude_md, "CLAUDE.md has the protected-paths section")
section = claude_md.split("## Protected paths in automated review repairs", 1)[1]
for needle in [".github/", ".claude/", ".mcp.json", ".env", "CLAUDE.md", "AGENTS.md", "package.json", "supabase/",
               "target-guard.ts", "NEEDS_DECISION", "symlinks", "Do not commit or push"]:
    check(needle in section, f"CLAUDE.md protected-paths section mentions {needle}")

if failures:
    print(f"{len(failures)} invariant(s) failed")
    sys.exit(1)
print("all repair workflow invariants hold")
PY
