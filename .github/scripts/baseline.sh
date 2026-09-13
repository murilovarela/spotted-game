#!/usr/bin/env bash
# Decide which quality-baseline.json a job compares against, and export BASELINE_FILE.
#
# On main: the checked-out file.
# On a PR that did NOT touch quality-baseline.json: main's current file, so a branch cut
#   before the bot last raised the bar cannot pass while regressing against today's main.
# On a PR that DID touch it: the PR's file. Editing the baseline is the one sanctioned way
#   to lower a bar deliberately, and it shows up in the diff for review.
set -euo pipefail

out=/tmp/quality-baseline.json

if [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]; then
  cp quality-baseline.json "$out"
  echo "baseline: this branch"
else
  git fetch --quiet origin main
  base=$(git merge-base origin/main HEAD)
  if git diff --quiet "$base" HEAD -- quality-baseline.json; then
    git show origin/main:quality-baseline.json > "$out"
    echo "baseline: origin/main"
  else
    cp quality-baseline.json "$out"
    echo "baseline: this PR (quality-baseline.json edited deliberately)"
  fi
fi

cat "$out"
echo "BASELINE_FILE=$out" >> "$GITHUB_ENV"
