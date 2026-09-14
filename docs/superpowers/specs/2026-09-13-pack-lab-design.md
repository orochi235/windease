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

- **Dataset** — `{ id, label, domain, items: LayoutItem[], hint?: { columnWidth?, aspect? } }`.
  `hint` carries what the source used, so a run can reproduce it.
- **Packer** — `{ id, strategy: LayoutStrategy }`. A run passes it only the option keys its
  `strategy.configSpec` declares, so one set of lab controls serves every packer.
- **Fit** — how wide the container is:
  - `{ kind: 'width', w }` — a fixed width; the pack grows downward and reports overflow, the
    shape of a vertically scrolling container.
  - `{ kind: 'aspect', ratio }` — astv's search: pack at widths from the widest box to the sum
    of widths in 24 steps, keep the result whose `w/h` is closest to `ratio` by
    `|log(w / h / ratio)|`.
- **Metric** — `(run) => number`, with a label and a format. Initial set: bounds width, bounds
  height, fill (box area over bounds area), aspect error, unplaced count, layout time in ms.
- **Run** — `run(dataset, packer, fit)` returns the placements, the bounds, the width it
  settled on, and every metric's value. Deterministic apart from layout time, so a view can
  memoize on its inputs.

## Views

Two React components, each taking runs and nothing else:

- **`PackView`** — draws one run on its own `<canvas>`: boxes, and the width the packer was
  given as a guide line. Not a labkit canvas layer, which is one stack per trial; Compare and
  Matrix draw several runs in one trial.
- **`RunTable`** — runs as rows, metrics as columns, digits in `tabular-nums` with decimal
  places fixed per metric.

## Instruments

An instrument is a config schema, a function from config to runs, and how many canvases sit
in a row. A helper, `defineComparison({ name, config, specs, columns })`, builds the labkit
instrument from those, so a new comparison is a new call rather than a new component.

| Instrument | Config | Runs | Arrangement |
| --- | --- | --- | --- |
| Single | dataset, packer, fit | 1 | one `PackView` |
| Compare | dataset, fit, one toggle per packer | one per packer on | a row of `PackView`s over a `RunTable` |
| Matrix | fit, one toggle per dataset and per packer | every dataset × packer on | a grid of small `PackView`s beside a `RunTable` |

Toggles rather than lists because labkit's `f.schema` has single-value fields only. Several
trials of any instrument sit side by side in labkit's workspace, which is how two unrelated
runs are compared.

## astv datasets

The first datasets are captured from astv, not recomputed: its card sizing stays in astv, and
the lab has no runtime dependency on it.

`dev/pack-lab/datasets/astv.json` (values illustrative):

```json
{
  "source": "astv",
  "commit": "abc1234",
  "captured": "2026-09-13",
  "gap": 1,
  "plates": [
    { "id": "dir:src/layout", "columnWidth": 8, "aspect": 1.6, "boxes": [[8, 3.2]] }
  ]
}
```

Each plate becomes one dataset, its boxes in the order astv hands them over (tallest first).
The lab validates the file on load and reports a malformed plate by id rather than skipping it.

The capture script lives in astv.

## Tooling

- `dev/pack-lab/` holds `index.html`, `vite.config.ts`, `tsconfig.json` and `src/`, after
  klieg's dev labs. `npm run dev:pack-lab` starts it on port 61100 with `host: '::'` and
  `strictPort`.
- `devDependencies` gain `@weasel-js/labkit`, `@weasel-js/core` at the version labkit pins (1.4.4 today),
  `vite` and `@vitejs/plugin-react`.
- The lab imports windease through a path alias to `src/` (`#windease/*`), never the bare
  `windease` specifier. labkit depends on `windease@^1.3.0` from npm, and that copy predates
  the packers — a bare import would resolve to it.
- Core tests run in the existing `node` vitest project; `typecheck` adds the lab's tsconfig.

## Out of scope

Generated datasets and loading a file of sizes (the registry takes both later without a
change to the pieces); re-packing astv's nested plates as a tree rather than one plate at a
time; rendering through windease's React containers.
