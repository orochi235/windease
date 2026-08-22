#!/usr/bin/env bash
# Verify CHANGELOG.md is ready to publish at a given version.
#
# Two drifts this catches. A tag whose version has no section ships a release
# with no notes to read. And an "Unreleased" heading that survives the bump goes
# out in the tarball — README.md and CHANGELOG.md are both published files, so a
# consumer ends up reading "Unreleased" about code they already have.
#
#   scripts/check-changelog.sh              # version from package.json
#   scripts/check-changelog.sh 1.3.0        # or an explicit one (v-prefix ok)
#   scripts/check-changelog.sh --extract 1.3.0   # print that section's body
#
# Exits nonzero if either check fails, or if --extract finds no section.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

CHANGELOG=CHANGELOG.md
# Every file npm publishes that a stale "Unreleased" heading could reach.
PUBLISHED=(CHANGELOG.md README.md)

extract=0
if [ "${1:-}" = "--extract" ]; then
  extract=1
  shift
fi

version="${1:-$(node -p "require('./package.json').version")}"
version="${version#v}"

section_body() {
  awk -v v="$version" '
    $0 ~ "^## " v "([^0-9.]|$)" { inside = 1; next }
    inside && /^## / { exit }
    inside { print }
  ' "$CHANGELOG"
}

if [ "$extract" -eq 1 ]; then
  body="$(section_body)"
  if [ -z "${body//[[:space:]]/}" ]; then
    echo "no CHANGELOG.md section for $version" >&2
    exit 1
  fi
  printf '%s\n' "$body"
  exit 0
fi

fail=0

body="$(section_body)"
if [ -z "${body//[[:space:]]/}" ]; then
  echo "1/2 $CHANGELOG — no section for $version"
  fail=$((fail + 1))
else
  echo "1/2 $CHANGELOG — section for $version found, $(printf '%s\n' "$body" | grep -c '^- ') entries"
fi

stale=()
for f in "${PUBLISHED[@]}"; do
  [ -f "$f" ] || continue
  grep -qi '^#\{1,6\} .*unreleased' "$f" && stale+=("$f")
done

if [ ${#stale[@]} -eq 0 ]; then
  echo "2/2 Unreleased headings — none in ${PUBLISHED[*]}"
else
  echo "2/2 Unreleased headings — still in: ${stale[*]}"
  fail=$((fail + 1))
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $version is ready to publish."
else
  echo "FAIL: $fail check(s). Name the version in $CHANGELOG and retitle every Unreleased heading."
fi
exit $((fail > 0))
