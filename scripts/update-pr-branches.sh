#!/usr/bin/env bash
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# Keep clean PR branches based on main. Only GitHub's update-branch API is called;
# no PR code is fetched or executed.
# Runs on every push to main; the pull_request_target branch is kept so the trigger
# can return without a script change (EVENT_NAME, PR_NUMBER, BASE_BRANCH decide the
# path). GITHUB_REPOSITORY and a `gh` authenticated through GH_TOKEN are required.
#
# The push path lists candidates WITHOUT mergeStateStatus: that field is computed on
# demand per PR, so one list query asking for it across every open PR times out into
# a GraphQL 502 (#5045). Each candidate's state is read in its own query below,
# retried on transient 5xx responses; one unreadable PR warns and is skipped instead
# of failing the run.
set -euo pipefail

: "${GITHUB_REPOSITORY:?}"
EVENT_NAME="${EVENT_NAME:-push}"
PR_NUMBER="${PR_NUMBER:-}"
BASE_BRANCH="${BASE_BRANCH:-}"

GH_ATTEMPTS="${GH_ATTEMPTS:-3}"
UPB_DELAY="${UPB_DELAY:-5}"

# gh_retry <label> -- <command> [args...]: prints the command's stdout on success.
# Transient HTTP 5xx responses are retried up to GH_ATTEMPTS times with a growing
# pause between tries; anything else fails on the first attempt.
gh_retry() {
  local label="$1"
  shift
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi
  local attempt=1 out status err_body
  local err_file
  err_file="$(mktemp)"
  while true; do
    if out="$("$@" 2>"$err_file")"; then
      rm -f "$err_file"
      printf '%s\n' "$out"
      return 0
    else
      status=$?
    fi
    if grep -Eq 'HTTP 5[0-9]{2}' "$err_file" && ((attempt < GH_ATTEMPTS)); then
      attempt=$((attempt + 1))
      echo "::warning title=GitHub API retry::${label} got a 5xx response; retrying (attempt ${attempt} of ${GH_ATTEMPTS})." >&2
      sleep $((attempt * UPB_DELAY))
      continue
    fi
    err_body="$(cat "$err_file")"
    rm -f "$err_file"
    [[ -z "$err_body" ]] || printf '%s\n' "$err_body" >&2
    return "$status"
  done
}

update_branch() {
  local number="$1"
  local head_sha="$2"
  if gh api --method PUT \
    "repos/${GITHUB_REPOSITORY}/pulls/${number}/update-branch" \
    -f "expected_head_sha=${head_sha}"; then
    echo "::notice title=PR branch update::Requested an update for PR #${number}."
  else
    echo "::warning title=PR branch update skipped::PR #${number} could not be updated automatically. Check for conflicts or fork permissions; the existing conflict guidance will remain available."
  fi
}

update_if_behind() {
  local number="$1"
  local state_and_sha
  local base state head_sha
  local attempt
  for attempt in {1..6}; do
    if ! state_and_sha="$(gh_retry "Read PR #${number} state" -- gh pr view "$number" \
      --repo "$GITHUB_REPOSITORY" \
      --json baseRefName,mergeStateStatus,headRefOid \
      --jq '[.baseRefName, .mergeStateStatus, .headRefOid] | @tsv')"; then
      echo "::warning title=PR branch update skipped::PR #${number} state could not be read; skipping it."
      return 0
    fi
    IFS=$'\t' read -r base state head_sha <<<"$state_and_sha"
    if [[ "$state" != "UNKNOWN" ]]; then
      break
    fi
    if [[ "$attempt" -lt 6 ]]; then
      sleep "$UPB_DELAY"
    fi
  done
  if [[ "$base" != "main" || "$state" != "BEHIND" ]]; then
    echo "PR #${number} does not need a clean update (base=${base:-?}, state=${state:-?})."
    return 0
  fi
  update_branch "$number" "$head_sha"
}

if [[ "$EVENT_NAME" == "pull_request_target" ]]; then
  : "${PR_NUMBER:?}"
  if [[ "$BASE_BRANCH" != "main" ]]; then
    echo "Skipping PR #${PR_NUMBER}; its base branch is not main."
    exit 0
  fi
  update_if_behind "$PR_NUMBER"
  exit 0
fi

# A push to main used to update every open PR, and each update started that PR's
# full CI, so the update set stays limited to approved PRs and PRs with auto-merge
# enabled. mergeStateStatus is fetched per candidate above instead.
candidates=""
if ! candidates="$(gh_retry "List open PRs" -- gh pr list \
  --repo "$GITHUB_REPOSITORY" --state open --base main \
  --limit 1000 --json number,reviewDecision,autoMergeRequest \
  --jq '.[] | select(.reviewDecision == "APPROVED" or .autoMergeRequest != null) | .number')"; then
  echo "::warning title=PR branch update::Could not list open PRs; skipping this run."
  exit 0
fi

while IFS= read -r number; do
  [[ -z "$number" ]] || update_if_behind "$number"
done <<<"$candidates"
