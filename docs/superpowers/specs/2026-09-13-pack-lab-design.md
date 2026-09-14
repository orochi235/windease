# Pack lab

**Status: built.** Run it with `npm run dev:pack-lab`.

A dev-only page for trying windease's packing strategies (`shelf`, `column`, `skyline`) against
real box sets and comparing the results. For whoever tunes or adds a packer. It never ships:
it lives in `dev/pack-lab/`, and the package publishes only `dist`.

It answers "which packer, with which options, does best on boxes shaped like this domain's" —
first for astv's directory plates, which already pack with these strategies.

## Pieces

Everything the lab computes is plain TypeScript in `dev/pack-lab/src/core/`, with no React,
labkit or DOM, and tested headless like the rest of windease. Each piece is a value in a
registry, so a new strategy, dataset or metric is one entry.

- **Dataset** — `{ id, label, domain, items: LayoutItem[], hint?: { gap?, columnWidth?, aspect? } }`.
  `hint` carries what the source packed with, so a run can reproduce it.
- **Packer** — `{ id, strategy: LayoutStrategy }`. A run passes it only the option keys its
  `strategy.configSpec` declares, so one set of lab controls serves every packer.
- **Fit** — how wide the container is:
  - `{ kind: 'width', width }` — a fixed width; the pack grows downward and reports overflow,
    the shape of a vertically scrolling container.
  - `{ kind: 'aspect', ratio }` — astv's search: pack at widths from the widest box to the sum
    of widths and gaps in 24 steps, keep the result whose `w/h` is closest to `ratio` by
    `|log(w / h / ratio)|`. Boxes the strategies would skip don't count toward those widths.
- **Run spec** — `specFor(dataset, packer, settings)` turns the lab's settings into
  `{ dataset, packer, fit, options, aspectTarget }`. With "use the dataset's settings" on, the
  dataset's hints replace the lab's gap, column width and aspect.
- **Run** — `run(spec)` returns the placements, unplaced ids, bounds, the width it settled on,
  layout time, and every metric's value. Deterministic apart from layout time.
- **Metric** — `{ id, label, digits, value(packing, spec, ms) }`: bounds width and height, fill
  (box area over bounds area), aspect error against `aspectTarget`, unplaced count, layout ms.

## Views

- **`PackView`** — one run on its own `<canvas>`: boxes colored by their index in the dataset,
  and the width the packer was given as a guide line. Not a labkit canvas layer, which is one
  stack per trial.
- **`RunTable`** — a row per run: the fit, gap and column width it actually used (`narrowest`
  where column width is 0), then each metric at fixed decimals in `tabular-nums`.
- **`Comparison`** — `PackView`s in a grid over a `RunTable`, with one scale per dataset so its
  packers compare at a glance without a large plate shrinking a small one.

## Instruments

An instrument is a config schema, a function from config to run specs, and how many canvases
sit in a row. `defineComparison({ name, config, specs, columns })` builds the labkit instrument
from those, so a new comparison is a new call rather than a new component. Runs recompute only
when the trial's config changes.

| Instrument | Config | Runs |
| --- | --- | --- |
| Single | dataset, packer, settings | 1 |
| Compare | dataset, one toggle per packer, settings | one per packer on |
| Matrix | one toggle per dataset and per packer, settings | every dataset × packer on |

Toggles rather than lists because labkit's `f.schema` has single-value fields only. Several
trials of any instrument sit side by side in labkit's workspace.

## Datasets

`DATASETS` is the Pack story's boxes, then every `dev/pack-lab/datasets/*.json` capture in file
name order. A dataset's id is `<file stem>:<plate id>`, so a recapture keeps saved trials
pointing at the same plate; its domain names the source and commit. Matrix keys its toggles by
id with dots escaped, since labkit config paths split on dots. A malformed capture, or two
datasets sharing an id, throws while the page loads and names the file, plate and key.

`dev/pack-lab/datasets/astv.json`:

```json
{
  "source": "astv",
  "commit": "abc1234",
  "fixture": "def5678",
  "captured": "2026-09-13",
  "gap": 1,
  "plates": [
    { "id": "dir:src/layout", "columnWidth": 8, "aspect": 1.6, "boxes": [[8, 3.2]] }
  ]
}
```

`commit` is the astv code that ran the capture and `fixture` the checked-in astv tree it read.
Each plate's boxes are in the order astv packs them, tallest first.

The capture script lives in astv.

## Tooling

- `dev/pack-lab/` holds `index.html`, `vite.config.ts`, `tsconfig.json` and `src/`, after
  klieg's dev labs. `npm run dev:pack-lab` serves it on port 61100 with `host: '::'` and
  `strictPort`, with its own Vite cache so it and Ladle don't invalidate each other.
- `devDependencies` gain `@weasel-js/labkit` and `@weasel-js/core`, both pinned to 1.4.4
  because labkit's peer dependency on core is exact, plus `vite` 7 and `@vitejs/plugin-react`.
  Declaring Vite 7 moved Vitest onto it from its own Vite 8.
- The lab imports windease through a path alias to `src/` (`#windease/*`), and only its public
  entry and types — never the bare `windease` specifier. labkit depends on `windease@^1.3.0`
  from npm, and that copy predates the packers.
- The page is the `PackLab` component, saving trials to `localStorage`. The Ladle story
  **Pack lab / Lab** (`dev/pack-lab/src/PackLab.stories.tsx`, picked up by `.ladle/config.mjs`)
  renders the same component unsaved, so every load starts fresh, and `e2e/pack-lab.spec.ts`
  drives it: turning a packer off, and switching to an astv plate.
- Core tests run in the existing `node` vitest project; `typecheck` adds the lab's tsconfig.
  Biome skips `dev/pack-lab/datasets/`, since a recapture rewrites it.

## Out of scope

Generated datasets and loading a file of sizes (the registry takes both later without a
change to the pieces); re-packing astv's nested plates as a tree rather than one plate at a
time; rendering through windease's React containers.
