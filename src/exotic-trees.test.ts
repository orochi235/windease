import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { CycleError, WindeaseError } from './errors.js';
import type { LayoutStrategy, Rect, Size } from './layout-types.js';
import { asNodeId, type NodeId } from './node.js';
import { deserialize, serialize } from './snapshot.js';
import type { Store } from './store.js';
import { dropped, EPS, malformedRects } from './test-utils/exotic/invariants.js';
import {
  type Preset,
  type PresetNode,
  presetToStore,
  presetTree,
} from './test-utils/exotic/preset.js';
import {
  type ContainerPass,
  DOCKVIEW_PRESET,
  EMACS_PRESET,
  fromGoldenLayout,
  GOLDEN_PRESET,
  GOLDEN_V1_PRESET,
  I3_PRESET,
  LAPTOP,
  layoutTree,
  PRESETS,
  TRADING_DESK_PRESET,
  TREE_STRATEGIES,
} from './test-utils/exotic/tree-scenarios.js';

const id = (s: string) => asNodeId(s);
type Strategies = Record<string, LayoutStrategy<unknown, string, unknown>>;

/** Everything wrong with one laid-out tree, keyed so a failure names the container. */
function treeProblems(store: Store, passes: ContainerPass[]) {
  const problems: string[] = [];
  for (const { id: cid, box, result } of passes) {
    for (const bad of malformedRects(result.placements)) problems.push(`${cid}: malformed ${bad}`);
    const visible = store
      .getChildren(id(cid))
      .filter((n) => n.lifecycle.state !== 'hidden')
      .map((n) => ({ id: n.id as string }));
    for (const lost of dropped(visible, result)) problems.push(`${cid}: dropped ${lost}`);
    // A child outside its container is fine only when the strategy says so.
    const escaped = [...result.placements].filter(
      ([, r]) =>
        r.w > 0 &&
        r.h > 0 &&
        (r.x < -EPS || r.y < -EPS || r.x + r.w > box.w + EPS || r.y + r.h > box.h + EPS),
    );
    if (escaped.length > 0 && !result.overflow) {
      problems.push(`${cid}: ${escaped.map(([e]) => e).join(',')} escape with no overflow`);
    }
  }
  return problems;
}

function laidOut(preset: Preset, store = presetToStore(preset), viewport = preset.viewport) {
  const tree = layoutTree(store, preset.mechanics.id, viewport);
  return { store, ...tree, problems: treeProblems(store, tree.passes) };
}

/** Container depth of the deepest leaf. */
function depth(node: PresetNode): number {
  if (!node.children || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(depth));
}

function find(node: PresetNode, want: string): PresetNode | undefined {
  if (node.id === want) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, want);
    if (hit) return hit;
  }
  return undefined;
}

/** The snapshot as it would come back from disk. */
function roundTrip(store: Store): Store {
  return deserialize(JSON.parse(JSON.stringify(serialize(store))));
}

const rectOf = (rects: Map<string, Rect>, nid: string) => {
  const r = rects.get(nid);
  if (!r) throw new Error(`${nid} was not placed`);
  return r;
};

/**
 * Drags the seam after `childId` in strip `rowId` by `d` through a
 * `ContainerHost`, as the React gutter does. `moved` is how far the seam went;
 * `total` is how much the row's extent changed, which should be nothing.
 */
function dragSeam(
  store: Store,
  rootId: string,
  rowId: string,
  childId: string,
  d: number,
  viewport: Size,
) {
  const before = layoutTree(store, rootId, viewport);
  const box = before.passes.find((p) => p.id === rowId)?.box ?? { w: 0, h: 0 };
  const config = store.getNode(id(rowId))?.container?.config as { axis?: 'x' | 'y' } | undefined;
  const axis = config?.axis ?? 'x';
  const end = (rects: Map<string, Rect>, n: string) =>
    axis === 'x'
      ? rectOf(rects, n).x + rectOf(rects, n).w
      : rectOf(rects, n).y + rectOf(rects, n).h;
  const extent = (rects: Map<string, Rect>) =>
    (store.getContainerView(id(rowId))?.childOrder ?? []).reduce((s, c) => {
      const r = rects.get(String(c));
      return s + (r ? (axis === 'x' ? r.w : r.h) : 0);
    }, 0);
  const host = new ContainerHost(store, id(rowId), new Map(Object.entries(TREE_STRATEGIES)));
  host.setViewport({ w: box.w, h: box.h });
  host.dispatchAffordance({
    affordanceId: `resize-${axis}-${childId}`,
    kind: 'drag',
    payload: axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d },
  });
  const after = layoutTree(store, rootId, viewport);
  return {
    moved: end(after.rects, childId) - end(before.rects, childId),
    total: extent(after.rects) - extent(before.rects),
  };
}

describe('i3 / sway trees', () => {
  const DEVTOOLS_TAB = 'splitv-0-1-0-0-1';
  const withDevtools = () => {
    const store = presetToStore(I3_PRESET);
    store.updateContainerConfig(id('tabbed-0-1-0-0'), { activeId: DEVTOOLS_TAB });
    return store;
  };

  it('translates append_layout into six nested containers with percent as share', () => {
    expect(depth(presetTree(I3_PRESET))).toBeGreaterThanOrEqual(6);
    expect(find(presetTree(I3_PRESET), 'splitv-0-0')?.placement).toEqual({ share: 0.25 });
    expect(find(presetTree(I3_PRESET), 'nvim')?.placement).toEqual({ share: 0.4 });
    expect(find(presetTree(I3_PRESET), 'stacked-0-0-1')?.config).toEqual({
      headerSize: 60,
      show: 'dropped',
    });
  });

  it('keeps every split in proportion on a smaller output', () => {
    const { rects, problems } = laidOut(I3_PRESET, withDevtools(), { w: 1280, h: 720 });
    expect(problems).toEqual([]);
    expect(rectOf(rects, 'splitv-0-0').w).toBeCloseTo(320, 6);
    expect(rectOf(rects, 'nvim').w).toBeCloseTo(0.4 * 0.5 * 1280, 6);
    expect(rectOf(rects, 'htop').h).toBeCloseTo(0.4 * 720, 6);
  });

  it('lays the whole workspace out clean, down to the deepest split', () => {
    const { rects, problems } = laidOut(I3_PRESET, withDevtools());
    expect(problems).toEqual([]);
    const consoleRect = rectOf(rects, 'console');
    const network = rectOf(rects, 'network');
    expect(consoleRect.x + consoleRect.w).toBeCloseTo(network.x, 6);
    expect(consoleRect.w / (consoleRect.w + network.w)).toBeCloseTo(0.3, 1);
  });

  it('gives a pane zero extent when it lands unshared among siblings whose shares fill the split', () => {
    // i3 hands a moved window an equal share. A tab carries no share, and
    // htop and the stack already share all of the column, so an unshared pane
    // gets only the leftover — none.
    const store = presetToStore(I3_PRESET);
    store.moveNode(id('slack'), id('splitv-0-0'), 1);
    const { rects, problems } = laidOut(I3_PRESET, store);
    expect(problems).toEqual([]);
    expect(rectOf(rects, 'slack').w).toBeCloseTo(rectOf(rects, 'splitv-0-0').w, 6);
    expect(rectOf(rects, 'slack').h).toBe(0);
  });

  it('reads a share carried from a horizontal split on a vertical one', () => {
    // A share names no axis, so nvim's 0.4 of a width becomes 0.4 of a height,
    // normalized against the 1.0 htop and the stack already hold.
    const store = presetToStore(I3_PRESET);
    store.moveNode(id('nvim'), id('splitv-0-0'), 1);
    const { rects, problems } = laidOut(I3_PRESET, store);
    expect(problems).toEqual([]);
    expect(rectOf(rects, 'nvim').h / rectOf(rects, 'splitv-0-0').h).toBeCloseTo(0.4 / 1.4, 6);
  });

  it('lets a stale share claim its old fraction of a much narrower split', () => {
    // i3 resets percent on a move; windease carries placement.share, so the
    // column's 0.25 of the workspace normalizes against console's 0.3 and
    // network's 0.7.
    const store = withDevtools();
    store.moveNode(id('splitv-0-0'), id('splith-0-1-0-0-1-1'), 1);
    const { rects, problems } = laidOut(I3_PRESET, store);
    expect(problems).toEqual([]);
    const row = rectOf(rects, 'splith-0-1-0-0-1-1');
    const moved = rectOf(rects, 'splitv-0-0');
    const parts = ['console', 'splitv-0-0', 'network'].map((n) => rectOf(rects, n).w);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(row.w, 6);
    expect(moved.w / row.w).toBeCloseTo(0.25 / (0.3 + 0.25 + 0.7), 6);
    // Its own children still fit inside the squeezed column.
    for (const leaf of ['htop', 'stacked-0-0-1']) {
      const r = rectOf(rects, leaf);
      expect(r.x).toBeGreaterThanOrEqual(moved.x - EPS);
      expect(r.x + r.w).toBeLessThanOrEqual(moved.x + moved.w + EPS);
    }
  });

  it('fills a tabbed body whatever size a pane arrives carrying', () => {
    const store = presetToStore(I3_PRESET);
    store.moveNode(id('htop'), id('tabbed-0-2'), 0);
    const { rects, problems } = laidOut(I3_PRESET, store);
    expect(problems).toEqual([]);
    const tabs = rectOf(rects, 'tabbed-0-2');
    expect(rectOf(rects, 'htop')).toEqual({
      x: tabs.x,
      y: tabs.y + 20,
      z: 0,
      w: tabs.w,
      h: tabs.h - 20,
    });
  });

  it('shows a pane moved into a tabbed container and reports the tabs behind it as unplaced', () => {
    const store = presetToStore(I3_PRESET);
    store.moveNode(id('shell'), id('tabbed-0-2'), 2);
    expect(store.getContainerView(id('tabbed-0-2'))?.config).toMatchObject({ activeId: 'shell' });
    const { passes, problems } = laidOut(I3_PRESET, store);
    expect(problems).toEqual([]);
    const tabbed = passes.find((p) => p.id === 'tabbed-0-2');
    expect(tabbed?.result.placements.has(id('shell'))).toBe(true);
    expect(tabbed?.result.unplaced).toEqual(['slack', 'spotify']);
  });

  it('clamps a span carried out of a wide grid into a narrow one', () => {
    const store = presetToStore(I3_PRESET);
    store.registerNode(
      createNode({
        id: id('scratchpad'),
        kind: 'group',
        parentId: id('splith-0'),
        placement: { size: { w: 320 } },
        container: { strategyId: 'grid', config: { cols: 2, gap: 4 } },
      }),
    );
    store.showNode(id('scratchpad'));
    store.patchPlacement(id('shell'), { span: { cols: 5, rows: 3 } });
    store.moveNode(id('shell'), id('scratchpad'));
    const { rects, problems } = laidOut(I3_PRESET, store);
    expect(problems).toEqual([]);
    expect(rectOf(rects, 'shell').w).toBeCloseTo(rectOf(rects, 'scratchpad').w, 6);
  });

  it('realigns a carried pin to the index the pane lands on', () => {
    const store = presetToStore(I3_PRESET);
    store.setPinned(id('shell'), 1);
    store.moveNode(id('shell'), id('tabbed-0-2'), 0);
    expect(store.getPinnedIndex(id('shell'))).toBe(0);
    expect(laidOut(I3_PRESET, store).problems).toEqual([]);
  });

  it('drops a carried pin in a tab container that opts out of pinning', () => {
    const store = presetToStore(I3_PRESET);
    store.setAllowsPinning(id('tabbed-0-2'), false);
    store.setPinned(id('shell'), 1);
    store.moveNode(id('shell'), id('tabbed-0-2'), 0);
    expect(store.getPinnedIndex(id('shell'))).toBeNull();
  });

  it('refuses to move a split into its own descendant and leaves the tree alone', () => {
    const store = withDevtools();
    const before = serialize(store);
    expect(() => store.moveNode(id('splitv-0-1'), id('splith-0-1-0-0-1-1'))).toThrow(CycleError);
    expect(serialize(store)).toEqual(before);
  });
});

describe('Golden Layout configs', () => {
  it('wraps a bare component in a one-tab stack, as Golden Layout does on load', () => {
    const search = find(presetTree(GOLDEN_PRESET), 'stack-search');
    expect(search?.strategy).toBe('stack');
    expect(search?.children?.map((c) => c.id)).toEqual(['search']);
    expect(search?.placement).toEqual({ share: 0.4 });
  });

  it('shows a dropped tab, and the tab before a closed active one', () => {
    const store = presetToStore(GOLDEN_PRESET);
    store.moveNode(id('terminal'), id('stack-chat'), 1);
    expect(store.getContainerView(id('stack-chat'))?.config).toMatchObject({
      activeId: 'terminal',
    });
    store.unregisterNode(id('terminal'));
    expect(store.getContainerView(id('stack-chat'))?.config).toMatchObject({ activeId: 'chat' });
    store.setActiveChild(id('stack-main-ts'), id('main-ts-2'));
    store.unregisterNode(id('main-ts-2'));
    expect(store.getContainerView(id('stack-main-ts'))?.config).toMatchObject({
      activeId: 'store-ts',
    });
  });

  it('reads v1 width/height percentages the same as v2 size strings', () => {
    const v2 = fromGoldenLayout(
      {
        root: {
          type: 'row',
          content: [
            { type: 'component', componentType: 'tree', title: 'Tree', size: '30%' },
            {
              type: 'column',
              size: '70%',
              content: [
                { type: 'component', componentType: 'editor', title: 'Editor', size: '75%' },
                { type: 'component', componentType: 'console', title: 'Console', size: '25%' },
              ],
            },
          ],
        },
      },
      GOLDEN_V1_PRESET,
    );
    expect(v2.mechanics).toEqual(GOLDEN_V1_PRESET.mechanics);
    expect(v2.data).toEqual(GOLDEN_V1_PRESET.data);
  });

  for (const preset of [GOLDEN_PRESET, GOLDEN_V1_PRESET]) {
    it(`${preset.id} lays out clean and survives a snapshot round trip`, () => {
      const before = laidOut(preset);
      expect(before.problems).toEqual([]);
      const restored = roundTrip(before.store);
      expect(serialize(restored)).toEqual(serialize(before.store));
      expect(layoutTree(restored, preset.mechanics.id, preset.viewport).rects).toEqual(
        before.rects,
      );
    });
  }

  it('drops a nested stack into the root row, where its 50% normalizes with the rest', () => {
    const store = presetToStore(GOLDEN_PRESET);
    store.moveNode(id('stack-problems'), id('row'), 3);
    const { rects, problems } = laidOut(GOLDEN_PRESET, store);
    expect(problems).toEqual([]);
    const widths = ['column', 'column-2', 'stack-chat', 'stack-problems'].map(
      (n) => rectOf(rects, n).w,
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1600, 6);
    expect(rectOf(rects, 'stack-problems').w).toBeCloseTo((0.5 / 1.5) * 1600, 6);
  });
});

describe('Dockview layouts', () => {
  it('alternates branch orientation and turns pixel sizes into shares of the parent axis', () => {
    expect(DOCKVIEW_PRESET.mechanics.config).toEqual({ axis: 'x', fill: true });
    expect(find(presetTree(DOCKVIEW_PRESET), 'branch-0.1')?.config).toEqual({
      axis: 'y',
      fill: true,
    });
    expect(find(presetTree(DOCKVIEW_PRESET), 'branch-0.1.1')?.placement).toEqual({ share: 0.3 });
  });

  it('lays out at the saved grid size and restores identically', () => {
    const before = laidOut(DOCKVIEW_PRESET);
    expect(before.problems).toEqual([]);
    expect(rectOf(before.rects, 'group-1').w).toBeCloseTo(280, 6);
    const restored = roundTrip(before.store);
    expect(layoutTree(restored, 'branch-0', DOCKVIEW_PRESET.viewport).rects).toEqual(before.rects);
  });

  it('scales every saved pixel size in proportion into a smaller window', () => {
    const { rects, problems } = laidOut(DOCKVIEW_PRESET, undefined, { w: 800, h: 500 });
    expect(problems).toEqual([]);
    expect(rectOf(rects, 'group-1').w).toBeCloseTo(140, 6);
    expect(rectOf(rects, 'branch-0.1.1').h).toBeCloseTo(150, 6);
    expect(rectOf(rects, 'group-4').w).toBeCloseTo(200, 6);
  });

  it('shows a tab dropped into another group', () => {
    const store = presetToStore(DOCKVIEW_PRESET);
    store.moveNode(id('terminal'), id('group-5'), 0);
    expect(store.getContainerView(id('group-5'))?.config).toMatchObject({ activeId: 'terminal' });
  });

  for (const [seam, row] of [
    ['group-1', 'branch-0'],
    ['group-2', 'branch-0.1'],
    ['group-3', 'branch-0.1.1'],
  ] as const) {
    it(`moves the ${seam} seam by exactly the drag, in the saved window and a smaller one`, () => {
      for (const viewport of [DOCKVIEW_PRESET.viewport, { w: 960, h: 540 }]) {
        const { moved, total } = dragSeam(
          presetToStore(DOCKVIEW_PRESET),
          'branch-0',
          row,
          seam,
          40,
          viewport,
        );
        expect(moved).toBeCloseTo(40, 6);
        expect(total).toBeCloseTo(0, 6);
      }
    });
  }
});

describe('Emacs side windows', () => {
  const order = (store: Store, parent: string) =>
    store.getContainerView(id(parent))?.childOrder.map(String);
  const pins = (store: Store, ids: string[]) => ids.map((n) => store.getPinnedIndex(id(n)));

  it('pins each side window at its slot', () => {
    const store = presetToStore(EMACS_PRESET);
    expect(pins(store, ['dired', 'treemacs', 'imenu-list'])).toEqual([0, 1, 2]);
    expect(laidOut(EMACS_PRESET, store).problems).toEqual([]);
  });

  it('keeps each side at its frame fraction when the frame resizes', () => {
    for (const frame of [EMACS_PRESET.viewport, LAPTOP]) {
      const { rects } = laidOut(EMACS_PRESET, undefined, frame);
      expect(rectOf(rects, 'side-left').w).toBeCloseTo(0.2 * frame.w, 6);
      expect(rectOf(rects, 'side-bottom').h).toBeCloseTo(0.25 * frame.h, 6);
    }
  });

  it('shifts the later slots down when a side window is deleted', () => {
    const store = presetToStore(EMACS_PRESET);
    store.unregisterNode(id('dired'));
    expect(order(store, 'side-left')).toEqual(['treemacs', 'imenu-list']);
    expect(pins(store, ['treemacs', 'imenu-list'])).toEqual([0, 1]);
    const { rects, problems } = laidOut(EMACS_PRESET, store);
    expect(problems).toEqual([]);
    const side = rectOf(rects, 'side-left');
    expect(rectOf(rects, 'treemacs').h + rectOf(rects, 'imenu-list').h).toBeCloseTo(side.h, 6);
  });

  it('routes a buffer displayed at slot 0 past the pinned slots', () => {
    const store = presetToStore(EMACS_PRESET);
    store.registerNode(
      createNode({ id: id('occur'), kind: 'panel', parentId: id('side-left'), focus: true }),
    );
    store.showNode(id('occur'));
    store.reorderInParent(id('occur'), 0);
    expect(order(store, 'side-left')).toEqual(['dired', 'treemacs', 'imenu-list', 'occur']);
  });

  it('carries a side slot pin into the main area, where it holds index 0', () => {
    // The parent-relative pin arrives meaning "slot 0 of the main area" — the
    // documented hazard, not a defect; later splits route around it.
    const store = presetToStore(EMACS_PRESET);
    store.moveNode(id('compilation'), id('main-area'), 0);
    expect(store.getPinnedIndex(id('compilation'))).toBe(0);
    store.moveNode(id('help'), id('main-area'), 0);
    expect(order(store, 'main-area')).toEqual(['compilation', 'help', 'init-el', 'main-right']);
    expect(laidOut(EMACS_PRESET, store).problems).toEqual([]);
  });
});

describe('trading desk saved at 3840x2160, restored at 1366x768', () => {
  const restored = () => roundTrip(presetToStore(TRADING_DESK_PRESET));

  it('restores with no malformed rect and no silent crush', () => {
    expect(laidOut(TRADING_DESK_PRESET, restored(), LAPTOP).problems).toEqual([]);
  });

  it('keeps the MD Trader floors and reports the row as overflowing', () => {
    const { rects, passes } = laidOut(TRADING_DESK_PRESET, restored(), LAPTOP);
    for (const sym of ['es', 'nq', 'cl']) {
      expect(rectOf(rects, `ladder-${sym}`).w).toBeGreaterThanOrEqual(180 - EPS);
    }
    expect(passes.find((p) => p.id === 'ladders')?.result.overflow?.w).toBeGreaterThan(0);
  });

  it('reports order tickets left off the narrower canvas as overflow', () => {
    const { passes } = laidOut(TRADING_DESK_PRESET, restored(), LAPTOP);
    const overflow = passes.find((p) => p.id === 'tickets')?.result.overflow;
    expect(overflow?.w).toBeGreaterThan(0);
    expect(overflow?.h).toBeGreaterThan(0);
  });

  it('scales the columns in proportion, so the unsized chart column keeps its 4K fraction', () => {
    const { rects } = laidOut(TRADING_DESK_PRESET, restored(), LAPTOP);
    const row = LAPTOP.w - 2 * 4 - 2 * 4;
    expect(rectOf(rects, 'quotes-col').w).toBeCloseTo((960 / 3824) * row, 6);
    expect(rectOf(rects, 'center-col').w).toBeCloseTo((1464 / 3824) * row, 6);
    expect(rectOf(rects, 'tickets').w).toBeCloseTo((1400 / 3824) * row, 6);
  });

  it('gives every docked pane a nonzero box on the laptop', () => {
    const { rects, passes } = laidOut(TRADING_DESK_PRESET, restored(), LAPTOP);
    const docked = passes
      .filter((p) => p.id !== 'tickets')
      .flatMap((p) => [...p.result.placements.keys()].map(String));
    expect(docked.length).toBeGreaterThanOrEqual(12);
    const empty = docked.filter((n) => rectOf(rects, n).w <= 0 || rectOf(rects, n).h <= 0);
    expect(empty).toEqual([]);
  });

  it('moves a column seam by exactly the drag on the laptop', () => {
    const { moved, total } = dragSeam(restored(), 'desk', 'desk', 'quotes-col', -30, LAPTOP);
    expect(moved).toBeCloseTo(-30, 6);
    expect(total).toBeCloseTo(0, 6);
  });

  it('keeps a floored fill column open and overflows the desk instead', () => {
    const store = restored();
    store.setHints(id('center-col'), { minSize: { w: 400, h: 0 } });
    const { rects, passes, problems } = laidOut(TRADING_DESK_PRESET, store, LAPTOP);
    expect(problems).toEqual([]);
    expect(rectOf(rects, 'center-col').w).toBeGreaterThanOrEqual(400 - EPS);
    expect(passes.find((p) => p.id === 'desk')?.result.overflow).toBeUndefined();
  });

  for (const viewport of [
    { w: 0, h: 0 },
    { w: 1, h: 1 },
  ]) {
    it(`survives a ${viewport.w}x${viewport.h} viewport`, () => {
      const { passes } = laidOut(TRADING_DESK_PRESET, restored(), viewport);
      for (const pass of passes) expect(malformedRects(pass.result.placements)).toEqual([]);
    });
  }
});

describe('this file’s presets', () => {
  for (const preset of PRESETS) {
    it(`${preset.id} names only registered strategies`, () => {
      const walk = (n: PresetNode): string[] => [
        ...(n.strategy ? [n.strategy] : []),
        ...(n.children ?? []).flatMap(walk),
      ];
      for (const s of walk(presetTree(preset))) expect(TREE_STRATEGIES[s], s).toBeDefined();
    });
  }
});

const FIXTURE_FILES = [
  'strip-scenarios',
  'grid-scenarios',
  'pack-scenarios',
  'overlap-scenarios',
  'tree-scenarios',
];

/** Every exported `PRESETS` across the exotic fixture files, plus any strategy registry they export. */
async function allPresets(): Promise<{ file: string; preset: Preset; strategies: Strategies }[]> {
  const out: { file: string; preset: Preset; strategies: Strategies }[] = [];
  for (const file of FIXTURE_FILES) {
    const path = `./test-utils/exotic/${file}.js`;
    const mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
    const registries = Object.entries(mod)
      .filter(([name, v]) => name.endsWith('_STRATEGIES') && v && typeof v === 'object')
      .map(([, v]) => v as Strategies);
    const strategies = Object.assign({}, TREE_STRATEGIES, ...registries) as Strategies;
    for (const preset of (mod.PRESETS as Preset[] | undefined) ?? []) {
      out.push({ file, preset, strategies });
    }
  }
  return out;
}

describe('every exotic preset', async () => {
  const all = await allPresets();

  it('finds presets in every fixture file', () => {
    expect(new Set(all.map((p) => p.file))).toEqual(new Set(FIXTURE_FILES));
  });

  for (const { file, preset, strategies } of all) {
    it(`${file}: ${preset.id} builds, lays out every container, and round-trips`, () => {
      const store = presetToStore(preset);
      const { passes } = layoutTree(store, preset.mechanics.id, preset.viewport, strategies);
      const problems: string[] = [];
      for (const { id: cid, result } of passes) {
        for (const bad of malformedRects(result.placements)) problems.push(`${cid}: ${bad}`);
        const visible = store
          .getChildren(id(cid))
          .filter((n) => n.lifecycle.state !== 'hidden')
          .map((n) => ({ id: n.id as string }));
        for (const lost of dropped(visible, result)) problems.push(`${cid}: dropped ${lost}`);
      }
      expect(problems).toEqual([]);

      const restored = roundTrip(store);
      expect(serialize(restored)).toEqual(serialize(store));
      const again = layoutTree(restored, preset.mechanics.id, preset.viewport, strategies);
      expect(again.rects).toEqual(
        layoutTree(store, preset.mechanics.id, preset.viewport, strategies).rects,
      );
    });
  }
});

describe('moving across kinds never throws anything but a WindeaseError', () => {
  it('every leaf of the i3 tree into every container, one move at a time', () => {
    const base = presetToStore(I3_PRESET);
    const containers = [...base.nodes.values()].filter((n) => n.container).map((n) => n.id);
    const leaves = [...base.nodes.values()].filter((n) => !n.container).map((n) => n.id);
    const failures: string[] = [];
    for (const leaf of leaves) {
      for (const target of containers) {
        const store = presetToStore(I3_PRESET);
        try {
          store.moveNode(leaf as NodeId, target as NodeId, 0);
        } catch (e) {
          if (!(e instanceof WindeaseError)) failures.push(`${leaf}→${target}: ${String(e)}`);
          continue;
        }
        const problems = laidOut(I3_PRESET, store).problems;
        if (problems.length > 0) failures.push(`${leaf}→${target}: ${problems.join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
