import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '#windease/layout-types.js';
import { fitsWithin } from './geometry.js';
import { ENGINE_SORTS, engineQueue } from './order.js';
import { columnsTracker } from './trackers/columns.js';
import { freeTracker } from './trackers/free.js';
import { outlineTracker } from './trackers/outline.js';
import { rowsTracker } from './trackers/rows.js';
import {
  type Candidate,
  COMMON_FEATURES,
  type EngineInput,
  type EnginePass,
  type Recipe,
  type TrackerDef,
  type Turn,
} from './types.js';

export const TRACKERS: readonly TrackerDef[] = [
  rowsTracker,
  outlineTracker,
  columnsTracker,
  freeTracker,
];

export function trackerById(id: string): TrackerDef {
  const tracker = TRACKERS.find((t) => t.id === id);
  if (!tracker) throw new Error(`pack engine: no tracker "${id}"`);
  return tracker;
}

/** Throws when `recipe` names an unknown tracker or weights a feature its tracker lacks. */
export function checkRecipe(recipe: Recipe): TrackerDef {
  const tracker = trackerById(recipe.tracker);
  const known = new Set<string>([...COMMON_FEATURES, ...tracker.features]);
  for (const tier of recipe.tiers) {
    for (const [feature, weight] of Object.entries(tier)) {
      if (!known.has(feature)) {
        throw new Error(
          `pack engine: recipe ${recipe.id} weights "${feature}", which the ${tracker.id} tracker does not compute`,
        );
      }
      if (!Number.isFinite(weight)) {
        throw new Error(`pack engine: recipe ${recipe.id} gives "${feature}" a non-finite weight`);
      }
    }
  }
  return tracker;
}

// Mirrors packGap and packTurns in src/layout/pack.ts.
function gapOf(options: Record<string, unknown>): number {
  const gap = options.gap;
  return typeof gap === 'number' && Number.isFinite(gap) && gap > 0 ? gap : 0;
}

function turnsOf(size: Size, rotate: boolean): Turn[] {
  const upright = { w: size.w, h: size.h, turned: false };
  return rotate && size.w !== size.h
    ? [upright, { w: size.h, h: size.w, turned: true }]
    : [upright];
}

/** One packing pass of `recipe`. Deterministic: equal scores go to the first candidate listed. */
export function pack(recipe: Recipe, input: EngineInput): EnginePass {
  const def = checkRecipe(recipe);
  const { container, options, previous } = input;
  const gap = gapOf(options);
  const bounded = options.overflowMode === 'unplaced';
  const rotate = options.rotate === true;
  const queue = engineQueue(input.items, options.sort);
  const tracker = def.create({ container, gap, options, sizes: queue.map((e) => e.size) });
  const tiers = recipe.tiers.map((tier) =>
    Object.entries(tier).filter(([, weight]) => weight !== 0),
  );

  const placed = new Map<string, Rect>();
  const turned = new Set<string>();
  let peak = 0;
  const scores = new Float64Array(tiers.length);
  const best = new Float64Array(tiers.length);

  for (const { item, size } of queue) {
    const before = previous?.get(item.id);
    const feature = (name: string, c: Candidate): number => {
      switch (name) {
        case 'x':
          return c.x;
        case 'y':
          return c.y;
        case 'bottom':
          return c.y + c.turn.h;
        case 'right':
          return c.x + c.turn.w;
        case 'peak':
          return Math.max(peak, c.y + c.turn.h);
        case 'overWidth':
          return fitsWithin(c.turn.w, container.w) ? 0 : 1;
        case 'turned':
          return c.turn.turned ? 1 : 0;
        case 'drift':
          return before ? Math.hypot(c.x - before.x, c.y - before.y) : 0;
        default:
          return c.extra[name] ?? 0;
      }
    };

    let chosen: Candidate | null = null;
    for (const c of tracker.candidates(turnsOf(size, rotate))) {
      if (
        bounded &&
        !(fitsWithin(c.x + c.turn.w, container.w) && fitsWithin(c.y + c.turn.h, container.h))
      ) {
        continue;
      }
      for (let t = 0; t < tiers.length; t++) {
        let score = 0;
        for (const [name, weight] of tiers[t]!) score += weight * feature(name, c);
        scores[t] = score;
      }
      let wins = chosen === null;
      for (let t = 0; !wins && t < tiers.length; t++) {
        if (scores[t]! < best[t]!) wins = true;
        else if (scores[t]! !== best[t]!) break;
      }
      if (wins) {
        chosen = c;
        best.set(scores);
      }
    }
    if (!chosen) continue;
    tracker.commit(chosen);
    placed.set(item.id, { x: chosen.x, y: chosen.y, z: 0, w: chosen.turn.w, h: chosen.turn.h });
    if (chosen.turn.turned) turned.add(item.id);
    peak = Math.max(peak, chosen.y + chosen.turn.h);
  }
  return { placed, turned };
}

/** Wraps a pass the way `packResult` in src/layout/pack.ts does: items' order, `unplaced`,
 *  per-axis `overflow`, and a `rotation` channel on every placement when `rotate` was on. */
export function engineResult(
  items: readonly LayoutItem[],
  { placed, turned }: EnginePass,
  container: Size,
  rotate: boolean,
): LayoutResult<string> {
  const placements = new Map<string, Rect>();
  const channels = new Map<string, Record<string, number>>();
  const unplaced: string[] = [];
  let right = 0;
  let bottom = 0;
  for (const { id } of items) {
    const rect = placed.get(id);
    if (!rect) {
      unplaced.push(id);
      continue;
    }
    placements.set(id, rect);
    if (rotate) channels.set(id, { rotation: turned.has(id) ? 90 : 0 });
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  const result: LayoutResult<string> = { placements, affordances: [] };
  if (unplaced.length > 0) result.unplaced = unplaced;
  if (rotate) result.channels = channels;
  const w = fitsWithin(right, container.w) ? 0 : right - container.w;
  const h = fitsWithin(bottom, container.h) ? 0 : bottom - container.h;
  if (w > 0 || h > 0) result.overflow = { w, h };
  return result;
}

/** `recipe` as a layout strategy named `engine:<id>`, taking the options the shipped packers do
 *  plus whatever its tracker reads. */
export function engineStrategy(recipe: Recipe): LayoutStrategy<void, string> {
  const def = checkRecipe(recipe);
  return {
    name: `engine:${recipe.id}`,
    configSpec: {
      gap: 'number',
      sort: ENGINE_SORTS,
      rotate: 'boolean',
      overflowMode: ['scroll', 'unplaced'],
      ...def.configSpec,
    },
    layout({ items, container, options }) {
      const pass = pack(recipe, { items, container, options });
      return engineResult(items, pass, container, options.rotate === true);
    },
  };
}
