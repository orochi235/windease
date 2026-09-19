# Pack engine

**Status: built in the pack lab 2026-09-18. Promotion into core is undecided** (see
[Promotion](#promotion)).

A single greedy placement engine for the pack lab. `shelf`, `skyline` and `column` are
configurations of it rather than three separate loops, and new packing heuristics are new
configurations rather than new code. For whoever tunes or adds a packer. It answers "which
combination of free-space tracking, ranking and order packs a given domain's boxes best", by
sweeping those combinations over the exotic pack fixtures and the lab's datasets.

It lives in `dev/pack-lab/src/core/engine/` and never ships.

## The loop

The engine places items one at a time and never moves one it has placed:

```
order the items
for each item:
  candidates = tracker.candidates(turns)     spots where the item could go
  drop candidates outside a bin              under overflowMode: 'unplaced'
  best = rank the candidates tier by tier    ties: the first one the tracker listed
  tracker.commit(best)
```

A configuration is a **recipe**: `{ id, tracker, tiers }`, JSON-safe. A tier is a set of feature
weights, and a candidate's score in it is `Σ weight × feature`. Tiers compare in order, so a
later tier decides only among candidates tied on every earlier one. The shipped packers break
ties with a chain of keys (`packLeast` in `src/layout/pack.ts`), and a single weighted sum
can't express that chain without epsilon weights that break on fractional gaps.

"Policy" is taken: the guide's chapter 7.04 defines it as a consumer callback that can refuse or
defer, and a recipe does neither.

Order, rotation, gap and bounds are run options, read as the shipped packers read them: `sort`,
`rotate`, `gap`, `overflowMode`. `sort` also takes `perimeter` and `height-width`
(stb_rect_pack's tallest-then-widest), which the shipped packers lack.

## Trackers

A tracker holds the free space and lists candidate spots for each turn of an item, in the order
ties should go.

| Tracker | Holds | Candidates | Own features |
| --- | --- | --- | --- |
| `rows` | the open row's end and height | continue the row (any turn that fits without raising it, or upright raising it), or start a new row | `newRow`, `raise`, `rowWidth` |
| `outline` | the skyline's segments | each segment start, left to right, up to the first that crosses the width | `waste` |
| `columns` | each column's height | each run of adjacent columns wide enough, left to right; reads `columnWidth`, `cols`, `justify` | `span`, `waste` |
| `free` | the maximal free rectangles (maxrects) | each free rect's top-left corner the item fits, top to bottom, then left to right | `shortSide`, `longSide` |

Every tracker also gets the common features: `x`, `y`, `bottom`, `right`, `peak` (the pack's
height after placing), `overWidth` (1 for an item wider than the container), `turned`, and
`drift` (distance from where the item sat last pass, when the caller passes one). A recipe that
weights a feature its tracker lacks throws when it's checked.

`free` packs every box grown by `gap` on its right and bottom, in a container grown to match, so
no free rect offers a spot closer than `gap` to a placed box. Without a bin, its free space runs
down without end.

## Recipes

| Recipe | Tracker | Tiers |
| --- | --- | --- |
| `shelf` | `rows` | `overWidth` · `newRow` · `raise` · `rowWidth` · `turned` |
| `skyline` | `outline` | `overWidth` · `bottom` |
| `column` | `columns` | `overWidth` · `peak` · `span` · `bottom` |
| `skyline-min-waste` | `outline` | `overWidth` · `waste` · `bottom` |
| `column-min-waste` | `columns` | `overWidth` · `waste` · `bottom` |
| `maxrects-bl` | `free` | `overWidth` · `bottom` · `x` |
| `maxrects-bssf` | `free` | `overWidth` · `shortSide` · `longSide` · `bottom` |
| `maxrects-blsf` | `free` | `overWidth` · `longSide` · `shortSide` · `bottom` |
| `skyline-steady` | `outline` | `overWidth` · `bottom + drift` |
| `maxrects-steady` | `free` | `overWidth` · `bottom + drift` · `x` |

The first three reproduce the shipped packers exactly.

## Parity

`engine.parity.test.ts` holds the engine to the shipped packers. Every exotic pack preset runs
through all three packers, each under its own config, with `rotate` flipped, with
`overflowMode` flipped, and sorted by height, each at its viewport width, half of it and 1.37×
it. The 10,000-item preset runs at its own settings, and every lab dataset at three widths with
and without rotation and sorting. Placements, `unplaced`, `overflow` and the rotation channel
must be equal, not close. Every other recipe must leave no overlap at the run's gap, no
malformed rect and no dropped item on any preset.

## Lab integration

- Each recipe is a lab packer named `engine:<id>`, off in a new trial, so Single, Compare and
  Matrix show it with no instrument changes. The Ladle story **Pack lab / Lab** and
  `e2e/pack-lab.spec.ts` cover turning one on.
- `sort` offers the engine-only orders. A packer that lacks the chosen order gets no `sort`, so
  a shipped packer packs in the dataset's order rather than silently misreading the key.
- A width fit can carry a bin's `height`, which a packer under `overflowMode: 'unplaced'` reads.
- The `moved` metric is the mean number of other items whose position changes when one item
  grows 1px and the dataset packs again in the same container, over the items a quarter, half and
  three quarters of the way in. An engine packer is handed the first packing as `previous`, so
  `drift` has something to read.

## Sweep

`npm run pack:sweep -- [--out runs.json] [--only <id part>] [--recipes a,b]` runs every recipe
in every order over:

- every non-justified exotic preset except the 10,000-item one, at its viewport as a width fit
  under its own config, `sort` aside
- the story boxes and every lab capture plate, as an aspect fit to the plate's ratio

It prints one line per run with its position as it finishes, writes one JSON row per run with
`--out`, and ends with a table per fixture: the baseline's fill and `moved` beside the best any
recipe reached without leaving more items unplaced. A preset's baseline is its own packer in its
own order; a lab plate's is the best of the three shipped packers in the plate's order.

Presets skip the aspect fit because it repacks about 25 times a run, and the 3,755-glyph atlas
makes that minutes per recipe. The sweep runs under `tsx`, from `dev/pack-lab/sweep/`, whose
tsconfig declares the few Node APIs it uses rather than installing `@types/node`: with no `types`
field in `tsconfig.json`, that package would reach the library's own typecheck.

## Promotion

Decided after reading the sweep, in its own spec. The bar:

- parity with the shipped packers (met)
- on the largest fixtures, layout time within 1.5× of the shipped packers'
- some recipe beats the shipped packers on fill, unplaced or `moved` for a fixture domain

If promoted, `shelfStrategy`, `skylineStrategy` and `columnStrategy` keep their names and
configs and become recipes internally, and new recipes become options.

## Out of scope

- Searching the order (swap-and-improve over the sequence).
- Resuming from a saved prefix when only the tail changed.
- An optimal baseline from a constraint solver (CP-SAT), which would say how far each recipe is
  from the best possible packing. It needs Python and OR-Tools in the lab.
- Cassowary, or any linear solver. It can't express non-overlap.
- `justified`, which sizes rows to fill the width rather than placing boxes at their own size.
- A `CHANGELOG.md` entry. Nothing user-visible changes until promotion.
