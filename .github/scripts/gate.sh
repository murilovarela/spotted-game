#!/usr/bin/env bash
# Compare one metric against the quality baseline and write job outputs.
#
#   gate.sh <output-name> <value> <baseline-key> <lower|higher>
#
# Fails closed: an empty or non-numeric value means the tool crashed, and a crashed tool
# is a failed check — never a pass. Reads BASELINE_FILE (set by baseline.sh) so a PR is
# measured against main's numbers, not its own branch point.
set -euo pipefail

name=$1
value=$2
key=$3
better=$4
baseline_file=${BASELINE_FILE:-quality-baseline.json}

if ! [[ "$value" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "::error::$name produced no numeric metric (got '$value'). The tool probably crashed; see the step log above."
  echo "status=fail" >> "$GITHUB_OUTPUT"
  exit 1
fi

baseline=$(jq -r ".$key" "$baseline_file")
if ! [[ "$baseline" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "::error::baseline key '$key' missing or non-numeric in $baseline_file"
  echo "status=fail" >> "$GITHUB_OUTPUT"
  exit 1
fi

echo "$name=$value" >> "$GITHUB_OUTPUT"

if [ "$better" = lower ]; then
  worse=$(echo "$value > $baseline" | bc -l)
else
  worse=$(echo "$value < $baseline" | bc -l)
fi

if [ "$worse" = 1 ]; then
  echo "::error::$name is $value; baseline is $baseline ($better is better)"
  echo "status=fail" >> "$GITHUB_OUTPUT"
  exit 1
fi

echo "$name=$value  (baseline $baseline)"
echo "status=pass" >> "$GITHUB_OUTPUT"
