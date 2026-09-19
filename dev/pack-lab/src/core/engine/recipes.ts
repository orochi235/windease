import type { Recipe } from './types.js';

/**
 * Named recipes. The first three reproduce `shelfStrategy`, `skylineStrategy` and
 * `columnStrategy` exactly; the rest are published heuristics the shipped packers lack.
 * Leftmost-on-ties comes from the trackers listing spots left to right, not from an `x` weight.
 */
export const RECIPES: readonly Recipe[] = [
  {
    id: 'shelf',
    tracker: 'rows',
    tiers: [{ overWidth: 1 }, { newRow: 1 }, { raise: 1 }, { rowWidth: 1 }, { turned: 1 }],
  },
  { id: 'skyline', tracker: 'outline', tiers: [{ overWidth: 1 }, { bottom: 1 }] },
  {
    id: 'column',
    tracker: 'columns',
    tiers: [{ overWidth: 1 }, { peak: 1 }, { span: 1 }, { bottom: 1 }],
  },
  // Jylänki, "A Thousand Ways to Pack the Bin" (2010): Skyline-MinWaste.
  {
    id: 'skyline-min-waste',
    tracker: 'outline',
    tiers: [{ overWidth: 1 }, { waste: 1 }, { bottom: 1 }],
  },
  {
    id: 'column-min-waste',
    tracker: 'columns',
    tiers: [{ overWidth: 1 }, { waste: 1 }, { bottom: 1 }],
  },
  // MaxRects: bottom-left, best short side fit, best long side fit.
  { id: 'maxrects-bl', tracker: 'free', tiers: [{ overWidth: 1 }, { bottom: 1 }, { x: 1 }] },
  {
    id: 'maxrects-bssf',
    tracker: 'free',
    tiers: [{ overWidth: 1 }, { shortSide: 1 }, { longSide: 1 }, { bottom: 1 }],
  },
  {
    id: 'maxrects-blsf',
    tracker: 'free',
    tiers: [{ overWidth: 1 }, { longSide: 1 }, { shortSide: 1 }, { bottom: 1 }],
  },
  // Bottom-left that pays to stay near its last position: 1px of drift costs as much as 1px of height.
  { id: 'skyline-steady', tracker: 'outline', tiers: [{ overWidth: 1 }, { bottom: 1, drift: 1 }] },
  {
    id: 'maxrects-steady',
    tracker: 'free',
    tiers: [{ overWidth: 1 }, { bottom: 1, drift: 1 }, { x: 1 }],
  },
];

export function recipeById(id: string): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`pack engine: no recipe "${id}"`);
  return recipe;
}
