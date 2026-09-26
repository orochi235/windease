#!/usr/bin/env bash
# Delete the raw .tsx sources Ladle ships beside its .d.ts typings.
#
# A .tsx outranks a .d.ts in module resolution, so any program that imports
# @ladle/react typechecks Ladle's own source, where skipLibCheck does not reach.
# Under TypeScript 7 that source fails: its @ts-ignore comments sit above JSX
# tags, and TS 7 reports those errors on the attribute lines below. Every .tsx
# there has a .d.ts sibling, so removing it changes nothing but which file
# resolves. Runs from `prepare`, which a registry install of windease never does.
set -euo pipefail

dir="node_modules/@ladle/react/typings-for-build"
[ -d "$dir" ] || exit 0
find "$dir" -name '*.tsx' -delete
