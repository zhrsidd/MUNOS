#!/usr/bin/env bash
# Stages the Claude–Codex gate scripts into a directory outside the workspace.
#
# The gate comes from main whenever main has it. Before that, one bootstrap pull request may supply it from its own head,
# and only when the head's .github/scripts tree is exactly the tree the owner pinned in the repository variable
# CODEX_GATE_BOOTSTRAP_TREE for CODEX_GATE_BOOTSTRAP_PR. Any later change to the gate changes the tree and fails closed.
# This is a one-time bootstrap: once main carries the gate, the head path is unreachable. Remove the variables then.
#
# Usage: stage-gate.sh <trusted-checkout> <head-checkout> <pull-number> <destination>
#   trusted-checkout: checkout of main with .github/scripts
#   head-checkout:    checkout of the pull request head (a git repository) with .github/scripts
set -euo pipefail

trusted=${1:?usage: stage-gate.sh <trusted-checkout> <head-checkout> <pull-number> <destination>}
head=${2:?missing head checkout}
pr=${3:?missing pull number}
dest=${4:?missing destination}

if [ -f "$trusted/.github/scripts/codex-review-gate.sh" ]; then
  src="$trusted/.github/scripts"
  echo "Gate scripts from main."
elif [ -n "${CODEX_GATE_BOOTSTRAP_PR:-}" ] && [ -n "${CODEX_GATE_BOOTSTRAP_TREE:-}" ] \
  && [ "$pr" = "$CODEX_GATE_BOOTSTRAP_PR" ]; then
  tree=$(git -C "$head" rev-parse "HEAD:.github/scripts")
  if [ "$tree" != "$CODEX_GATE_BOOTSTRAP_TREE" ]; then
    echo "::error::Gate tree $tree is not the pinned bootstrap tree; refusing to run the pull request's gate." >&2
    exit 1
  fi
  src="$head/.github/scripts"
  echo "Gate scripts bootstrapped from pull request $pr at tree $tree."
else
  echo "::error::main has no gate scripts and no bootstrap is pinned for pull request $pr." >&2
  exit 1
fi

rm -rf "$dest"
cp -r "$src" "$dest"
