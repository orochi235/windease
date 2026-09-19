/**
 * Packs every fixture with every engine recipe in every order, and reports where a recipe beats
 * the fixture's own packer. `npm run pack:sweep -- [--out runs.json] [--only <id part>]
 * [--recipes a,b]`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ALL_PRESETS,
  HEAVY_PRESETS,
  ownStrategy,
  packScenario,
} from '#windease/nuts/pack-scenarios.js';
import { datasetsFromCapture } from '../src/core/capture.js';
import { ENGINE_SORTS, type EngineSort } from '../src/core/engine/order.js';
import { RECIPES } from '../src/core/engine/recipes.js';
import { packerById } from '../src/core/packers.js';
import { run } from '../src/core/run.js';
import { STORY_BOXES } from '../src/core/sample.js';
import type { Dataset, Fit, Run } from '../src/core/types.js';

/** One thing to pack, and the recipes and order it is judged against. */
interface Subject {
  dataset: Dataset;
  options: Record<string, unknown>;
  fits: Fit[];
  aspectTarget: number;
  /** The packer and order the fixture's product uses; for a lab plate, every shipped packer in
   *  the plate's own order, the best of them counting. */
  baseline: { recipes: string[]; sort: EngineSort };
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function subjects(): Subject[] {
  const out: Subject[] = [];
  for (const preset of ALL_PRESETS) {
    const own = ownStrategy(preset);
    if (own === 'justified' || HEAVY_PRESETS.includes(preset)) continue;
    const scenario = packScenario(preset, own);
    const { sort, ...options } = scenario.options;
    const ratio = preset.viewport.w / preset.viewport.h;
    out.push({
      dataset: { id: preset.id, label: preset.id, domain: preset.source, items: scenario.items },
      options,
      // The product's own container. An aspect search repacks ~25 times a run, which the lab
      // plates below can afford and the 3,755-glyph atlas cannot.
      fits: [{ kind: 'width', width: preset.viewport.w, height: preset.viewport.h }],
      aspectTarget: ratio,
      baseline: { recipes: [own], sort: (sort as EngineSort | undefined) ?? 'none' },
    });
  }
  const capture = JSON.parse(
    readFileSync(new URL('../datasets/windease.json', import.meta.url), 'utf8'),
  );
  for (const dataset of [STORY_BOXES, ...datasetsFromCapture(capture, 'windease')]) {
    const ratio = dataset.hint?.aspect ?? 1.6;
    out.push({
      dataset,
      options: { gap: dataset.hint?.gap ?? 0, columnWidth: dataset.hint?.columnWidth ?? 0 },
      fits: [{ kind: 'aspect', ratio }],
      aspectTarget: ratio,
      baseline: { recipes: ['shelf', 'skyline', 'column'], sort: 'none' },
    });
  }
  return out;
}

const fitLabel = (fit: Fit): string =>
  fit.kind === 'width' ? `width ${fit.width}` : `aspect ${fit.ratio.toFixed(2)}`;

interface Row {
  dataset: string;
  fit: string;
  recipe: string;
  sort: EngineSort;
  fill: number;
  aspect: number;
  height: number;
  unplaced: number;
  moved: number;
  refill: number;
  ms: number;
}

function toRow(subject: Subject, fit: Fit, recipe: string, sort: EngineSort, r: Run): Row {
  const m = r.metrics;
  return {
    dataset: subject.dataset.id,
    fit: fitLabel(fit),
    recipe,
    sort,
    fill: m.fill!,
    aspect: m.aspect!,
    height: m.height!,
    unplaced: m.unplaced!,
    moved: m.moved!,
    refill: m.refill!,
    ms: m.ms!,
  };
}

function main(): void {
  const only = arg('only');
  const recipeIds = arg('recipes')?.split(',') ?? RECIPES.map((r) => r.id);
  const out = arg('out');
  const chosen = subjects().filter((s) => !only || s.dataset.id.includes(only));

  const jobs: { subject: Subject; fit: Fit; recipe: string; sort: EngineSort }[] = [];
  for (const subject of chosen) {
    for (const fit of subject.fits) {
      for (const recipe of recipeIds) {
        for (const sort of ENGINE_SORTS) jobs.push({ subject, fit, recipe, sort });
      }
    }
  }

  const rows: Row[] = [];
  const pad = String(jobs.length).length;
  jobs.forEach(({ subject, fit, recipe, sort }, i) => {
    // An aspect search sizes the container, so a bin's fixed height has no place in it.
    const { overflowMode, ...unbounded } = subject.options;
    const base = fit.kind === 'aspect' ? unbounded : subject.options;
    const options = sort === 'none' ? base : { ...base, sort };
    const result = run({
      dataset: subject.dataset,
      packer: packerById(`engine:${recipe}`),
      fit,
      options,
      aspectTarget: subject.aspectTarget,
    });
    const row = toRow(subject, fit, recipe, sort, result);
    rows.push(row);
    process.stdout.write(
      `${String(i + 1).padStart(pad)}/${jobs.length}  ${row.dataset}  ${fitLabel(fit)}  ${recipe}  ${sort}` +
        `  fill ${row.fill.toFixed(1).padStart(5)}  moved ${row.moved.toFixed(1).padStart(6)}  ${row.ms.toFixed(1).padStart(7)} ms\n`,
    );
  });

  if (out) writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
  report(chosen, rows);
}

/** How far a recipe must beat the baseline for the table to name it: the table's last digit. */
const MARGIN = 0.1;

/** Per fixture and fit: the baseline's fill, and its moved count with the fill it repacks to,
 *  beside the best any recipe reached without leaving more items unplaced than it did. */
function report(chosen: Subject[], rows: Row[]): void {
  const lines: string[][] = [
    ['fixture', 'fit', 'fill', 'best', 'by', 'moved', 'refill', 'best', 'refill', 'by'],
  ];
  for (const subject of chosen) {
    for (const fit of subject.fits) {
      const here = rows.filter((r) => r.dataset === subject.dataset.id && r.fit === fitLabel(fit));
      const base = here.filter(
        (r) => subject.baseline.recipes.includes(r.recipe) && r.sort === subject.baseline.sort,
      );
      if (base.length === 0) continue;
      const baseFill = Math.max(...base.map((r) => r.fill));
      const steadiest = base.reduce((a, b) => (b.moved < a.moved ? b : a));
      const baseMoved = steadiest.moved;
      const baseUnplaced = Math.min(...base.map((r) => r.unplaced));
      const fair = here.filter((r) => r.unplaced <= baseUnplaced);
      const byFill = fair.reduce((a, b) => (b.fill > a.fill ? b : a));
      const byMoved = fair.reduce((a, b) => (b.moved < a.moved ? b : a));
      lines.push([
        subject.dataset.id,
        fitLabel(fit),
        baseFill.toFixed(1),
        byFill.fill.toFixed(1),
        byFill.fill >= baseFill + MARGIN ? `${byFill.recipe} ${byFill.sort}` : '—',
        baseMoved.toFixed(1),
        steadiest.refill.toFixed(1),
        byMoved.moved.toFixed(1),
        byMoved.refill.toFixed(1),
        byMoved.moved <= baseMoved - MARGIN ? `${byMoved.recipe} ${byMoved.sort}` : '—',
      ]);
    }
  }
  const numeric = new Set([2, 3, 5, 6, 7, 8]);
  const widths = lines[0]!.map((_, c) => Math.max(...lines.map((l) => l[c]!.length)));
  process.stdout.write('\n');
  for (const line of lines) {
    process.stdout.write(
      `${line.map((cell, c) => (numeric.has(c) ? cell.padStart(widths[c]!) : cell.padEnd(widths[c]!))).join('  ')}\n`,
    );
  }
}

main();
