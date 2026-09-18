import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { runStrategyForContainer } from '../layout-node-adapter.js';
import type { LayoutResult, Rect } from '../layout-types.js';
import { asNodeId, type NodeId } from '../node.js';
import type { Store } from '../store.js';
import {
  dropped,
  malformedRects,
  outOfBounds,
  overlaps,
  runScenario,
  type Scenario,
} from '../test-utils/exotic/invariants.js';
import {
  AMIGA_SCREENS,
  CASCADE_200,
  DESKTOP_PATHOLOGY,
  FIGMA_CANVAS,
  GIMP_MULTIWINDOW,
  MACOS9_WINDOWSHADE,
  OVERLAP_STRATEGIES,
  PRESETS,
  TWM_ICON_MANAGER,
  UNPLUGGED_MONITOR,
  WIN31_ICONS,
} from '../test-utils/exotic/overlap-scenarios.js';
import { type Preset, presetScenario, presetToStore } from '../test-utils/exotic/preset.js';

const DESKTOP_PRESETS = PRESETS.filter((p) => p.root.strategy?.startsWith('desktop'));

function scenarioOf(preset: Preset): Scenario {
  return presetScenario(preset);
}

function run(scenario: Pick<Scenario, 'items' | 'container' | 'options'>, strategyId: string) {
  const strategy = OVERLAP_STRATEGIES[strategyId];
  if (!strategy) throw new Error(`no strategy ${strategyId}`);
  return runScenario(strategy, scenario);
}

const runPreset = (preset: Preset) => run(scenarioOf(preset), preset.root.strategy!);

/** The placed id a pointer at `p` would land on: highest z whose rect holds it. */
function topmostAt(result: LayoutResult<string>, p: { x: number; y: number }): string | null {
  let best: [string, Rect] | null = null;
  for (const [id, r] of result.placements) {
    if (p.x < r.x || p.y < r.y || p.x >= r.x + r.w || p.y >= r.y + r.h) continue;
    if (!best || r.z > best[1].z) best = [id, r];
  }
  return best?.[0] ?? null;
}

function layoutStore(store: Store, parent: string, preset: Preset) {
  const node = store.getNode(asNodeId(parent) as NodeId);
  const strategy = OVERLAP_STRATEGIES[node!.container!.strategyId]!;
  const items = store.getChildren(asNodeId(parent) as NodeId);
  const state = strategy.initialState?.(
    items.map((n) => ({ id: n.id, meta: { ...(n.membership?.placement ?? {}) } })),
    node!.container!.config as Record<string, unknown>,
  );
  const id = asNodeId(parent) as NodeId;
  return runStrategyForContainer(
    store,
    id,
    preset.viewport,
    strategy,
    state,
  ) as unknown as LayoutResult<string>;
}

describe('desktop presets: generic invariants', () => {
  it.each(DESKTOP_PRESETS.map((p) => [p.id, p] as const))(
    '%s: no malformed rects, no silent drops, deterministic',
    (_, preset) => {
      const scenario = scenarioOf(preset);
      const r = runPreset(preset);
      expect(malformedRects(r.placements)).toEqual([]);
      expect(dropped(scenario.items, r)).toEqual([]);
      expect(runPreset(preset)).toEqual(r);
    },
  );

  it.each(DESKTOP_PRESETS.map((p) => [p.id, p] as const))(
    '%s: window z strictly follows child order, every window above every icon',
    (_, preset) => {
      const scenario = scenarioOf(preset);
      const r = runPreset(preset);
      const iconIds = new Set(
        [...r.placements.entries()].filter(([, rect]) => rect.z === 0).map(([id]) => id),
      );
      const windowZ = scenario.items
        .filter((i) => r.placements.has(i.id) && !iconIds.has(i.id))
        .map((i) => r.placements.get(i.id)!.z);
      expect(windowZ).toEqual(windowZ.map((_, k) => k + 1));
    },
  );

  it.each(DESKTOP_PRESETS.map((p) => [p.id, p] as const))(
    '%s: overflow covers every window that passes any edge',
    (_, preset) => {
      const scenario = scenarioOf(preset);
      const r = runPreset(preset);
      let w = 0;
      let h = 0;
      let left = 0;
      let top = 0;
      for (const rect of r.placements.values()) {
        w = Math.max(w, rect.x + rect.w - scenario.container.w);
        h = Math.max(h, rect.y + rect.h - scenario.container.h);
        left = Math.max(left, -rect.x);
        top = Math.max(top, -rect.y);
      }
      if (w <= 0 && h <= 0 && left <= 0 && top <= 0) expect(r.overflow).toBeUndefined();
      else {
        const want: Record<string, number> = { w: Math.max(0, w), h: Math.max(0, h) };
        if (left > 0) want.left = left;
        if (top > 0) want.top = top;
        expect(r.overflow).toEqual(want);
      }
    },
  );
});

describe('Mac OS 9 WindowShade', () => {
  const r = runPreset(MACOS9_WINDOWSHADE);

  it('rolls a shaded window up to the bar, keeping x, y and w', () => {
    expect(r.placements.get('mac-simpletext')).toMatchObject({ x: 180, y: 110, w: 300, h: 20 });
  });

  it('keeps a shaded window in its stacking slot', () => {
    expect(r.placements.get('mac-simpletext')?.z).toBe(2);
    expect(r.placements.get('mac-notepad')?.z).toBe(5);
  });

  // Spec: "its h becomes shadeHeight" — so a strip shorter than the bar grows when shaded.
  it('sets a shaded window shorter than shadeHeight to shadeHeight, growing it', () => {
    expect(r.placements.get('mac-app-switcher')?.h).toBe(20);
  });

  it('tiles the desktop icons under every window', () => {
    expect(r.placements.get('mac-hd')).toMatchObject({ z: 0, w: 64, h: 64 });
    expect(r.placements.get('mac-trash')?.z).toBe(0);
  });
});

describe('Windows 3.1 minimized icons', () => {
  const scenario = scenarioOf(WIN31_ICONS);
  const r = runPreset(WIN31_ICONS);
  const minimized = scenario.items.filter((i) => i.meta?.minimized === true).map((i) => i.id);

  it('gives every minimized window its icon slot at the icon size, at z 0', () => {
    expect(minimized).toHaveLength(15);
    for (const id of minimized) {
      expect(r.placements.get(id)).toMatchObject({ z: 0, w: 72, h: 56 });
    }
  });

  it('places icons in child order after the real icon, wrapping to a second row', () => {
    const first = r.placements.get('win31-recycle')!;
    const rects = minimized.map((id) => r.placements.get(id)!);
    expect(rects[0]!.x).toBeGreaterThan(first.x);
    const rows = new Set(rects.map((rect) => rect.y));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('never lets two icons overlap', () => {
    const icons = new Map([...r.placements].filter(([, rect]) => rect.z === 0));
    expect(overlaps(icons)).toEqual([]);
  });

  it('ranks the two open windows 1 and 2, ignoring the iconified ones', () => {
    expect(r.placements.get('win31-progman')?.z).toBe(1);
    expect(r.placements.get('win31-filemgr')?.z).toBe(2);
  });

  it('restoring a window takes it back to its saved x, y and size above the rest', () => {
    const store = presetToStore(WIN31_ICONS);
    store.patchPlacement(asNodeId('win31-app-3'), { minimized: false });
    const after = layoutStore(store, 'win31-desktop', WIN31_ICONS);
    expect(after.placements.get('win31-app-3')).toEqual({ x: 76, y: 76, z: 3, w: 300, h: 200 });
  });
});

describe('twm icon manager', () => {
  const r = runPreset(TWM_ICON_MANAGER);

  it('turns 484×316 xterms into 160×20 icon-manager rows', () => {
    expect(r.placements.get('twm-xterm-2')).toMatchObject({ w: 160, h: 20, z: 0 });
  });

  it('keeps the unminimized xterms stacked by child order after xclock and xload', () => {
    expect(
      ['twm-xclock', 'twm-xload', 'twm-xterm-1', 'twm-xterm-4'].map(
        (id) => r.placements.get(id)?.z,
      ),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe('GIMP multi-window: utility windows above image windows', () => {
  const tools = ['gimp-toolbox', 'gimp-layers'];
  const toolsOnTop = (store: Store) => {
    const r = layoutStore(store, 'gimp-desktop', GIMP_MULTIWINDOW);
    const zs = [...r.placements.entries()];
    const minTool = Math.min(...zs.filter(([id]) => tools.includes(id)).map(([, rect]) => rect.z));
    const maxImage = Math.max(
      ...zs.filter(([id]) => !tools.includes(id)).map(([, rect]) => rect.z),
    );
    return minTool > maxImage;
  };

  const pinnedStore = () => {
    const store = presetToStore(GIMP_MULTIWINDOW);
    store.setPinned(asNodeId('gimp-toolbox'), 3);
    store.setPinned(asNodeId('gimp-layers'), 4);
    return store;
  };

  it('starts with the utility windows on top', () => {
    expect(toolsOnTop(presetToStore(GIMP_MULTIWINDOW))).toBe(true);
  });

  it('an unpinned raise puts the image window above the Toolbox — childOrder alone interleaves', () => {
    const store = presetToStore(GIMP_MULTIWINDOW);
    store.reorderInParent(asNodeId('gimp-img-1'), 4);
    expect(toolsOnTop(store)).toBe(false);
  });

  it('pinning the utility windows last keeps a raised image window under them', () => {
    const store = pinnedStore();
    store.reorderInParent(asNodeId('gimp-img-1'), 4);
    expect(store.getNode(asNodeId('gimp-desktop'))?.container?.childOrder.at(2)).toBe('gimp-img-1');
    expect(toolsOnTop(store)).toBe(true);
  });

  it('closing an image window keeps the pinned utility windows above the rest', () => {
    const store = pinnedStore();
    store.unregisterNode(asNodeId('gimp-img-2'));
    expect(toolsOnTop(store)).toBe(true);
  });

  // Pins are absolute indices, so "pinned last" stops being last the moment a window opens.
  it('a newly opened image window lands above the pinned utility windows', () => {
    const store = pinnedStore();
    const id = asNodeId('gimp-img-4');
    store.registerNode(
      createNode({
        id,
        kind: 'window',
        focus: true,
        parentId: asNodeId('gimp-desktop'),
        placement: { x: 420, y: 240 },
        hints: { preferredSize: { w: 400, h: 300 } },
      }),
    );
    store.showNode(id);
    expect(store.getNode(asNodeId('gimp-desktop'))?.container?.childOrder.at(-1)).toBe(
      'gimp-img-4',
    );
    expect(toolsOnTop(store)).toBe(false);
  });
});

describe('Amiga screens pulled down', () => {
  const r = runPreset(AMIGA_SCREENS);

  it('stacks the front screen last', () => {
    expect(
      ['amiga-workbench', 'amiga-dpaint', 'amiga-term'].map((id) => r.placements.get(id)?.z),
    ).toEqual([1, 2, 3]);
  });

  it('hits the screen behind through the strip each front screen reveals', () => {
    expect(topmostAt(r, { x: 320, y: 20 })).toBe('amiga-workbench');
    expect(topmostAt(r, { x: 320, y: 120 })).toBe('amiga-dpaint');
    expect(topmostAt(r, { x: 320, y: 200 })).toBe('amiga-term');
  });

  it('reports how far the pulled-down screens hang below the display', () => {
    expect(r.overflow).toEqual({ w: 0, h: 180 });
  });

  it('dragging a screen fully down reveals the whole screen behind it', () => {
    const store = presetToStore(AMIGA_SCREENS);
    store.patchPlacement(asNodeId('amiga-term'), { y: 256 });
    store.patchPlacement(asNodeId('amiga-dpaint'), { y: 256 });
    const after = layoutStore(store, 'amiga-display', AMIGA_SCREENS);
    expect(topmostAt(after, { x: 10, y: 250 })).toBe('amiga-workbench');
  });
});

describe('Figma canvas: negative and far-off coordinates', () => {
  const r = runPreset(FIGMA_CANVAS);

  it('places frames at their coordinates without clamping', () => {
    expect(r.placements.get('figma-cover')).toMatchObject({ x: -4200, y: -2600 });
    expect(r.placements.get('figma-archive')).toMatchObject({ x: 18000, y: 12000 });
  });

  it('reports overflow past every edge, negative coordinates included', () => {
    expect(r.overflow).toMatchObject({ w: 18000 + 2400 - 1440, h: 12000 + 1600 - 900 });
    expect(r.overflow?.left).toBeGreaterThan(0);
  });

  it('lists the frames outside the viewport, which the host must pan to', () => {
    const scenario = scenarioOf(FIGMA_CANVAS);
    expect(outOfBounds(r.placements, scenario.container).sort()).toEqual(
      ['figma-archive', 'figma-cover', 'figma-desktop', 'figma-flows'].sort(),
    );
  });
});

describe('unplugged second monitor', () => {
  const r = runPreset(UNPLUGGED_MONITOR);

  it('keeps positions saved on a lost display, unclamped', () => {
    expect(r.placements.get('mon-slack')).toMatchObject({ x: 1920, y: 60 });
    expect(r.placements.get('mon-xcode')).toMatchObject({ x: -1800, y: 40 });
  });

  it('reports both the right-hand window and the one wholly off the left edge', () => {
    expect(r.overflow).toEqual({ w: 1920 + 1000 - 1280, h: 40 + 1000 - 800, left: 1800 });
    const xcode = r.placements.get('mon-xcode')!;
    expect(xcode.x + xcode.w).toBeLessThan(0);
  });

  it('survives a snapshot round trip with the off-screen positions intact', async () => {
    const { serialize, deserialize } = await import('../snapshot.js');
    const store = presetToStore(UNPLUGGED_MONITOR);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(store))));
    const after = layoutStore(back, 'laptop-display', UNPLUGGED_MONITOR);
    expect(after.placements.get('mon-xcode')).toEqual(r.placements.get('mon-xcode'));
  });
});

describe('cascade after 200 new windows', () => {
  const r = runPreset(CASCADE_200);

  it('walks 24px per window without wrapping', () => {
    expect(r.placements.get('cascade-1')).toMatchObject({ x: 0, y: 0 });
    expect(r.placements.get('cascade-200')).toMatchObject({ x: 199 * 24, y: 199 * 24 });
  });

  it('is reachable only through overflow, which covers the last window', () => {
    const last = r.placements.get('cascade-200')!;
    expect(r.overflow).toEqual({ w: last.x + last.w - 1024, h: last.y + last.h - 768 });
  });

  it('stacks the 200 windows 1..200 in order', () => {
    expect(r.placements.get('cascade-200')?.z).toBe(200);
    expect(new Set([...r.placements.values()].map((p) => p.z)).size).toBe(200);
  });
});

describe('desktop pathology', () => {
  const byId = Object.fromEntries(DESKTOP_PATHOLOGY.map((s) => [s.id, s]));

  it('unplaces zero and negative extents, and places the rest', () => {
    const r = run(byId['desktop-zero-size']!, 'desktop');
    expect(r.unplaced).toEqual(['zero', 'flat', 'negative']);
    expect(r.placements.get('ok')?.z).toBe(1);
  });

  it('places windows in a 0×0 container and reports all of them as overflow', () => {
    const scenario = byId['desktop-container-0x0']!;
    const r = run(scenario, 'desktop');
    expect(malformedRects(r.placements)).toEqual([]);
    expect(r.overflow).toEqual({ w: 300, h: 200 });
  });

  it('treats a non-finite position as no position, and cascades it', () => {
    const r = run(byId['desktop-nan-position']!, 'desktop');
    expect(malformedRects(r.placements)).toEqual([]);
    expect(r.placements.get('nan')).toMatchObject({ x: 0, y: 0 });
  });

  it('never reports a NaN overflow, even for a NaN position', () => {
    const r = run(byId['desktop-nan-position']!, 'desktop');
    for (const v of Object.values(r.overflow ?? {})) expect(Number.isNaN(v)).toBe(false);
  });

  it('is deterministic over a seeded random desktop', async () => {
    const { prng } = await import('../test-utils/exotic/invariants.js');
    const rand = prng(1987);
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `w${i}`,
      hints: { preferredSize: { w: rand(0, 400), h: rand(0, 300) } },
      meta: rand(0, 3) === 0 ? { minimized: true } : { x: rand(-500, 1500), y: rand(-500, 1000) },
    }));
    const scenario = { items, container: { w: 1024, h: 768 }, options: {} };
    const a = run(scenario, 'desktop');
    expect(run(scenario, 'desktop')).toEqual(a);
    expect(malformedRects(a.placements)).toEqual([]);
    expect(dropped(items, a)).toEqual([]);
  });
});
