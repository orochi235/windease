import type { LayoutItem, Rect } from '#windease/layout-types.js';
import { engineResult, pack } from './engine/engine.js';
import { engineSize } from './engine/order.js';
import { aspectScore, packAt } from './fit.js';
import type { Packing, RunSpec } from './types.js';

export interface Metric {
  id: string;
  label: string;
  digits: number;
  value: (packing: Packing, spec: RunSpec, ms: number) => number;
}

export function fillPercent(packing: Packing): number {
  const { w, h } = packing.bounds;
  if (w <= 0 || h <= 0) return 0;
  let area = 0;
  for (const r of packing.placements.values()) area += r.w * r.h;
  return (area / (w * h)) * 100;
}

/**
 * The ratio a run is judged against, as `specFor` recorded it — reading the dataset's hint here
 * directly would ignore the "use hints" toggle for a width fit.
 */
export function targetRatio(spec: RunSpec): number {
  return spec.aspectTarget;
}

/** `items` with the sized item at `fraction` of the way through 1px wider and taller, or
 *  null when nothing is sized. */
export function nudged(
  items: readonly LayoutItem[],
  fraction: number,
): { items: LayoutItem[]; id: string } | null {
  const sized = items.filter((item) => engineSize(item) !== null);
  const target = sized[Math.floor(sized.length * fraction)];
  if (!target) return null;
  const size = engineSize(target)!;
  const grown: LayoutItem = { ...target, natural: { w: size.w + 1, h: size.h + 1 } };
  return { items: items.map((item) => (item === target ? grown : item)), id: target.id };
}

/** Where the nudge metrics nudge: one item a quarter, half and three quarters of the way in. */
const NUDGES = [0.25, 0.5, 0.75];

/** What happens when one item grows: the mean over {@link NUDGES}. */
export interface NudgeStats {
  /** Other items whose position changed. */
  moved: number;
  /** The fill of the repacked layout, which `drift` trades against. */
  fill: number;
}

const nudgeCache = new WeakMap<Packing, NudgeStats>();

/**
 * Grows one item 1px each way and packs the dataset again in the same container — the
 * stability the msdf fixture asks for — for each of three items, since one lands anywhere from
 * first placed to last. An engine packer is handed the first packing as `previous`, so a recipe
 * that weights `drift` can hold items in place. Cached per packing: two metrics read it.
 */
export function nudgeStats(packing: Packing, spec: RunSpec): NudgeStats {
  const cached = nudgeCache.get(packing);
  if (cached) return cached;
  const container = { w: packing.width, h: packing.height };
  const { recipe } = spec.packer;
  let moved = 0;
  let fill = 0;
  for (const fraction of NUDGES) {
    const change = nudged(spec.dataset.items, fraction);
    if (!change) return { moved: 0, fill: fillPercent(packing) };
    const again = recipe
      ? packingOf(
          engineResult(
            change.items,
            pack(recipe, {
              items: change.items,
              container,
              options: spec.options,
              previous: packing.placements,
            }),
            container,
            spec.options.rotate === true,
          ).placements,
          packing,
        )
      : packAt(spec.packer, change.items, packing.width, spec.options, packing.height);
    fill += fillPercent(again);
    for (const [id, before] of packing.placements) {
      if (id === change.id) continue;
      const after = again.placements.get(id);
      if (!after || after.x !== before.x || after.y !== before.y) moved++;
    }
  }
  const stats = { moved: moved / NUDGES.length, fill: fill / NUDGES.length };
  nudgeCache.set(packing, stats);
  return stats;
}

/** `placements` as a packing in `like`'s container, bounds measured from the rects. */
function packingOf(placements: ReadonlyMap<string, Rect>, like: Packing): Packing {
  let w = 0;
  let h = 0;
  for (const r of placements.values()) {
    w = Math.max(w, r.x + r.w);
    h = Math.max(h, r.y + r.h);
  }
  return { ...like, placements, unplaced: [], bounds: { w, h } };
}

/** {@link NudgeStats.moved}. */
export const movedCount = (packing: Packing, spec: RunSpec): number =>
  nudgeStats(packing, spec).moved;

export const METRICS: readonly Metric[] = [
  { id: 'width', label: 'width', digits: 1, value: (p) => p.bounds.w },
  { id: 'height', label: 'height', digits: 1, value: (p) => p.bounds.h },
  { id: 'fill', label: 'fill %', digits: 1, value: (p) => fillPercent(p) },
  {
    id: 'aspect',
    label: 'aspect error',
    digits: 3,
    value: (p, spec) => aspectScore(p, targetRatio(spec)),
  },
  { id: 'unplaced', label: 'unplaced', digits: 0, value: (p) => p.unplaced.length },
  { id: 'moved', label: 'moved', digits: 1, value: (p, spec) => movedCount(p, spec) },
  { id: 'refill', label: 'refill %', digits: 1, value: (p, spec) => nudgeStats(p, spec).fill },
  { id: 'ms', label: 'ms', digits: 2, value: (_p, _spec, ms) => ms },
];

export const formatMetric = (metric: Metric, value: number): string =>
  Number.isFinite(value) ? value.toFixed(metric.digits) : '—';
