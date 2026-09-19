import { describe, expect, it } from 'vitest';
import { columnStrategy, shelfStrategy, skylineStrategy } from '#windease/index.js';
import type { LayoutItem, LayoutStrategy, Size } from '#windease/layout-types.js';
import { dropped, malformedRects, overlaps } from '#windease/test-utils/exotic/invariants.js';
import {
  ALL_PRESETS,
  HEAVY_PRESETS,
  ownStrategy,
  PACKERS,
  packScenario,
} from '#windease/test-utils/exotic/pack-scenarios.js';
import windease from '../../../datasets/windease.json';
import { datasetsFromCapture } from '../capture.js';
import { STORY_BOXES } from '../sample.js';
import { engineStrategy } from './engine.js';
import { recipeById } from './recipes.js';

const SHIPPED: Record<(typeof PACKERS)[number], LayoutStrategy<void, string>> = {
  shelf: shelfStrategy,
  skyline: skylineStrategy,
  column: columnStrategy,
};

function expectParity(
  packer: (typeof PACKERS)[number],
  items: LayoutItem[],
  container: Size,
  options: Record<string, unknown>,
): void {
  const args = { items, container, state: undefined, options };
  const shipped = SHIPPED[packer].layout(args);
  const engine = engineStrategy(recipeById(packer)).layout(args);
  expect(engine).toEqual(shipped);
}

/** The options each preset is run under: its own, and with rotation and the bound flipped. */
function variants(config: Record<string, unknown>): Record<string, unknown>[] {
  return [
    config,
    { ...config, rotate: config.rotate !== true },
    { ...config, overflowMode: config.overflowMode === 'unplaced' ? 'scroll' : 'unplaced' },
    { ...config, sort: 'height' },
  ];
}

const presets = ALL_PRESETS.filter(
  (p) => ownStrategy(p) !== 'justified' && !HEAVY_PRESETS.includes(p),
);

describe('the engine reproduces the shipped packers', () => {
  for (const preset of presets) {
    for (const packer of PACKERS) {
      it(`${preset.id} through ${packer}`, () => {
        const scenario = packScenario(preset, packer);
        const { w, h } = scenario.container;
        for (const options of variants(scenario.options)) {
          for (const width of [w, Math.round(w * 0.5), Math.round(w * 1.37)]) {
            expectParity(packer, scenario.items, { w: width, h }, options);
          }
        }
      });
    }
  }

  for (const preset of HEAVY_PRESETS) {
    it(`${preset.id} through ${ownStrategy(preset)} at its own settings`, () => {
      const packer = ownStrategy(preset) as (typeof PACKERS)[number];
      const scenario = packScenario(preset, packer);
      expectParity(packer, scenario.items, scenario.container, scenario.options);
    });
  }

  const datasets = [STORY_BOXES, ...datasetsFromCapture(windease, 'windease')];
  for (const dataset of datasets) {
    for (const packer of PACKERS) {
      it(`lab dataset ${dataset.id} through ${packer}`, () => {
        const options = { gap: dataset.hint?.gap ?? 4, columnWidth: dataset.hint?.columnWidth };
        for (const width of [40, 120, 400]) {
          for (const extra of [{}, { rotate: true }, { sort: 'area' }]) {
            expectParity(packer, [...dataset.items], { w: width, h: 0 }, { ...options, ...extra });
          }
        }
      });
    }
  }
});

describe('every recipe packs soundly', () => {
  const recipes = [
    'skyline-min-waste',
    'column-min-waste',
    'maxrects-bl',
    'maxrects-bssf',
    'maxrects-blsf',
    'skyline-steady',
    'maxrects-steady',
  ];
  for (const id of recipes) {
    it(`${id} leaves no overlap, malformed rect or dropped item on any preset`, () => {
      const strategy = engineStrategy(recipeById(id));
      for (const preset of presets) {
        const scenario = packScenario(preset, 'skyline');
        for (const options of variants(scenario.options)) {
          const result = strategy.layout({
            items: scenario.items,
            container: scenario.container,
            state: undefined,
            options,
          });
          const where = `${preset.id} ${JSON.stringify(options)}`;
          expect(overlaps(result.placements, packGapOf(options)), where).toEqual([]);
          expect(malformedRects(result.placements), where).toEqual([]);
          expect(dropped(scenario.items, result), where).toEqual([]);
        }
      }
    });
  }
});

function packGapOf(options: Record<string, unknown>): number {
  return typeof options.gap === 'number' && options.gap > 0 ? options.gap : 0;
}
