#!/usr/bin/env bash
# Refuse to publish a tag whose commit has no green CI run.
#
# The drift this catches: 1.3.0 published while CI's e2e job had been red for
# five runs. release.yml runs lint, typecheck and unit tests; CI is the only
# thing that runs Playwright, so nothing on the release path could see it. This
# waits for the CI run at the tagged commit and fails on anything but success.
#
#   scripts/require-green-ci.sh              # HEAD, repo from the git remote
#   scripts/require-green-ci.sh <sha>
#
# Needs `gh` authenticated with actions:read. Env: WORKFLOW (default ci.yml),
# TIMEOUT_SECONDS (default 1800), POLL_SECONDS (default 20).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# head_sha matches only the full 40 characters — an abbreviated one returns an
# empty run list, which is indistinguishable from "CI hasn't started yet".
sha="$(git rev-parse "${1:-HEAD}" 2>/dev/null || echo "${1:-}")"
if [ "${#sha}" -ne 40 ]; then
  echo "FAIL: '${1:-HEAD}' is not a full 40-character commit sha." >&2
  exit 1
fi
workflow="${WORKFLOW:-ci.yml}"
timeout="${TIMEOUT_SECONDS:-1800}"
poll="${POLL_SECONDS:-20}"

repo="${GITHUB_REPOSITORY:-}"
if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
fi
if [ -z "$repo" ]; then
  echo "FAIL: no repository — set GITHUB_REPOSITORY or run inside a gh-resolvable clone." >&2
  exit 1
fi

echo "Waiting on $workflow at ${sha:0:7} in $repo (up to ${timeout}s)."

deadline=$((SECONDS + timeout))
attempt=0

while :; do
  attempt=$((attempt + 1))
  line="$(gh api \
    "repos/$repo/actions/workflows/$workflow/runs?head_sha=$sha&per_page=1" \
    --jq '(.workflow_runs[0] // {}) | "\(.status // "none") \(.conclusion // "none") \(.html_url // "-")"' \
    2>/dev/null)"

  read -r status conclusion url <<<"${line:-query-failed none -}"

  case "$status" in
    completed)
      if [ "$conclusion" = "success" ]; then
        echo "$attempt: completed/success — $url"
        echo
        echo "OK: ${sha:0:7} has a green $workflow run."
        exit 0
      fi
      echo "$attempt: completed/$conclusion — $url"
      echo
      # A cancelled run is as unverified as a failed one: CI's concurrency
      # group cancels an in-flight run when a newer commit lands on main.
      echo "FAIL: $workflow at ${sha:0:7} concluded $conclusion, so nothing has run"
      echo "      the e2e suite against this tree. Fix it and re-run CI, or"
      echo "      re-tag a commit that is green."
      exit 1
      ;;
    none)
      echo "$attempt: no $workflow run yet for ${sha:0:7}"
      ;;
    query-failed)
      echo "$attempt: could not query the API, retrying"
      ;;
    *)
      echo "$attempt: $status — $url"
      ;;
  esac

  if [ "$SECONDS" -ge "$deadline" ]; then
    echo
    if [ "$status" = "none" ]; then
      # CI is `on: push` to main only, so a tag pushed at a commit that never
      # reached main has no run and never will.
      echo "FAIL: no $workflow run appeared for ${sha:0:7} within ${timeout}s."
      echo "      CI runs on pushes to main — is this commit on main?"
    else
      echo "FAIL: $workflow at ${sha:0:7} was still '$status' after ${timeout}s."
    fi
    exit 1
  fi

  sleep "$poll"
done
