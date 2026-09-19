/**
 * `windease/nuts` — the Novel UI Torture Suite: layouts lifted from real
 * software, as data, plus the checks that say whether a strategy laid one out
 * sanely.
 *
 * A {@link Preset} is a whole tree (Blender's workspace, i3's tiling, Mac OS 9's
 * desktop) that {@link presetToStore} turns into a live store. A
 * {@link Scenario} is one container's flat case — items, container size and
 * config — that {@link runScenario} feeds to a single strategy, yours included.
 * The pathology corpora are the deliberately awful ones: zero-size containers,
 * 150 tabs, 10,000 items.
 *
 * Nothing here reads the DOM.
 */

import { PRESETS as GRID_PRESETS } from './grid-scenarios.js';
import { PRESETS as OVERLAP_PRESETS } from './overlap-scenarios.js';
import { PRESETS as PACK_PRESETS } from './pack-scenarios.js';
import type { Preset } from './preset.js';
import { PRESETS as STRIP_PRESETS } from './strip-scenarios.js';
import { PRESETS as TREE_PRESETS } from './tree-scenarios.js';

export { gridContainerIds, presetGridScenarios } from './grid-scenarios.js';
export {
  dropped,
  EPS,
  malformedRects,
  outOfBounds,
  overlaps,
  prng,
  runScenario,
  type Scenario,
} from './invariants.js';
export {
  ALL_PRESETS as PACK_ALL_PRESETS,
  ownStrategy,
  type PackerId,
  type PackStrategyId,
  packItemCount,
  packScenario,
  withStrategy,
} from './pack-scenarios.js';
export {
  type Preset,
  type PresetData,
  type PresetNode,
  type PresetProperty,
  presetNodes,
  presetProperties,
  presetScenario,
  presetToStore,
  presetTree,
  styled,
  titles,
} from './preset.js';
export { type ContainerPass, LAPTOP, layoutTree, TREE_STRATEGIES } from './tree-scenarios.js';
/** The five preset corpora, by the shape of layout each one stresses. */
export { GRID_PRESETS, OVERLAP_PRESETS, PACK_PRESETS, STRIP_PRESETS, TREE_PRESETS };

/** Every real-product preset the suite ships, across all five corpora. */
export const ALL_NUTS_PRESETS: Preset[] = [
  ...GRID_PRESETS,
  ...STRIP_PRESETS,
  ...OVERLAP_PRESETS,
  ...PACK_PRESETS,
  ...TREE_PRESETS,
];

export { PATHOLOGICAL as GRID_PATHOLOGY, TEN_THOUSAND } from './grid-scenarios.js';
export {
  DESKTOP_PATHOLOGY,
  FLOATING_PATHOLOGY,
  OVERLAP_STRATEGIES,
  STACK_PATHOLOGY,
} from './overlap-scenarios.js';
export {
  HEAVY_PRESETS as PACK_HEAVY_PRESETS,
  PACK_STRATEGIES,
  PATHOLOGY_PRESETS as PACK_PATHOLOGY_PRESETS,
} from './pack-scenarios.js';
export { PATHOLOGICAL as STRIP_PATHOLOGY } from './strip-scenarios.js';

export {
  type DockviewGridNode,
  type DockviewLayout,
  type EmacsSideWindow,
  emacsFrame,
  fromDockview,
  fromGoldenLayout,
  fromI3Layout,
  type GoldenConfig,
  type GoldenItem,
  type I3Node,
} from './tree-scenarios.js';
