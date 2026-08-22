#!/usr/bin/env bash
# Verify every commit hash cited in prose still resolves.
#
# A hash naming a commit on an unmerged branch is a reference with an expiry
# date: a rebase renumbers it and `git show` then returns nothing, leaving a
# reader unable to tell whether the commit was dropped, squashed, or renumbered.
# Only cite a hash once it is on the trunk — and run this to be sure.
#
#   scripts/check-doc-hashes.sh              # every tracked *.md
#   scripts/check-doc-hashes.sh a.md b.md    # just these
#
# Exits nonzero if any citation is dead.
set -uo pipefail

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(git ls-tree -r --name-only HEAD | grep -E '\.md$')
fi

total=${#files[@]}
dead=0
i=0

for f in "${files[@]}"; do
  i=$((i + 1))
  [ -f "$f" ] || { echo "$i/$total $f — not found, skipped"; continue; }

  # Commit-shaped: 7-40 hex chars, at least one letter so pure digits (dates,
  # counts, versions) don't masquerade as abbreviated hashes.
  mapfile -t tokens < <(grep -oE '\b[0-9a-f]{7,40}\b' "$f" | grep -E '[a-f]' | sort -u)

  bad=()
  for h in "${tokens[@]}"; do
    git cat-file -e "${h}^{commit}" 2>/dev/null || bad+=("$h")
  done

  if [ ${#bad[@]} -eq 0 ]; then
    echo "$i/$total $f — ${#tokens[@]} cited, all resolve"
  else
    echo "$i/$total $f — ${#tokens[@]} cited, ${#bad[@]} DEAD: ${bad[*]}"
    dead=$((dead + ${#bad[@]}))
  fi
done

echo
if [ "$dead" -eq 0 ]; then
  echo "OK: every cited hash resolves across $total file(s)."
else
  echo "FAIL: $dead dead citation(s). Replace each with a trunk commit, or drop it."
fi
exit $(( dead > 0 ))
