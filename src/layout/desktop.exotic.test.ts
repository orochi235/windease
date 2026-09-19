import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { nodeToLayoutItem, runStrategyForContainer } from '../layout-node-adapter.js';
import type { LayoutEvent, LayoutResult, Rect } from '../layout-types.js';
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

const DESKTOP_PRESETS = PRESETS.filter((p) => p.mechanics.strategy?.startsWith('desktop'));

function scenarioOf(preset: Preset): Scenario {
  return presetScenario(preset);
}

function run(scenario: Pick<Scenario, 'items' | 'container' | 'options'>, strategyId: string) {
  const strategy = OVERLAP_STRATEGIES[strategyId];
  if (!strategy) throw new Error(`no strategy ${strategyId}`);
  return runScenario(strategy, scenario);
}

const runPreset = (preset: Preset) => run(scenarioOf(preset), preset.mechanics.strategy!);

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

/** Sends `event` to the affordance `affordanceId` of `preset`'s root, as a pointer on it would. */
function dispatch(
  store: Store,
  preset: Preset,
  affordanceId: string,
  event: Omit<LayoutEvent, 'affordanceId'>,
) {
  const parentId = asNodeId(preset.mechanics.id) as NodeId;
  const affordance = layoutStore(store, preset.mechanics.id, preset).affordances.find(
    (a) => a.id === affordanceId,
  );
  if (!affordance) throw new Error(`no affordance ${affordanceId}`);
  const strategy = OVERLAP_STRATEGIES[preset.mechanics.strategy!]!;
  strategy.dispatchAffordance!({
    event: { affordanceId, ...event },
    affordance,
    store,
    parentId,
    container: preset.viewport,
    options: (store.getNode(parentId)?.container?.config ?? {}) as Record<string, unknown>,
    items: store.getChildren(parentId).map((n) => nodeToLayoutItem(n)),
  });
}

const dragBy = (store: Store, preset: Preset, id: string, dx: number, dy: number) =>
  dispatch(store, preset, `desktop:drag:${id}`, { kind: 'drag', payload: { dx, dy } });

const toggle = (store: Store, preset: Preset, id: string) =>
  dispatch(store, preset, `desktop:minimize:${id}`, { kind: 'click', payload: {} });

const orderOf = (store: Store, preset: Preset) =>
  store.getNode(asNodeId(preset.mechanics.id) as NodeId)?.container?.childOrder ?? [];

const savedAt = (store: Store, id: string) => {
  const p = store.getNode(asNodeId(id) as NodeId)?.membership?.placement ?? {};
  return { x: p.x, y: p.y };
};

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
      const clipped = scenario.options.overflow === 'clip';
      if (clipped || (w <= 0 && h <= 0 && left <= 0 && top <= 0)) {
        expect(r.overflow).toBeUndefined();
      } else {
        const want: Record<string, number> = { w: Math.max(0, w), h: Math.max(0, h) };
        if (left > 0) want.left = left;
        if (top > 0) want.top = top;
        expect(r.overflow).toEqual(want);
      }
    },
  );
});

describe('desktop presets: behavior as config', () => {
  it.each(DESKTOP_PRESETS.map((p) => [p.id, p] as const))(
    '%s: every window drags by its title band',
    (_, preset) => {
      const r = runPreset(preset);
      const windows = [...r.placements].filter(([, rect]) => rect.z > 0);
      expect(windows.length).toBeGreaterThan(0);
      for (const [id, rect] of windows) {
        const band = r.affordances.find((a) => a.id === `desktop:drag:${id}`);
        expect(band?.rect).toMatchObject({ x: rect.x, y: rect.y, w: rect.w, h: 20 });
      }
    },
  );

  it.each(DESKTOP_PRESETS.map((p) => [p.id, p] as const))(
    '%s: its content children carry no mechanics',
    (_, preset) => {
      for (const child of preset.data?.children?.[preset.mechanics.id] ?? []) {
        expect(child.kind === undefined || child.kind === 'icon', child.id).toBe(true);
        expect(child.config, child.id).toBeUndefined();
        expect(child.lock, child.id).toBeUndefined();
      }
    },
  );
});

describe('Mac OS 9 WindowShade', () => {
  const r = runPreset(MACOS9_WINDOWSHADE);

  it('moves the Finder window by its title bar', () => {
    const store = presetToStore(MACOS9_WINDOWSHADE);
    dragBy(store, MACOS9_WINDOWSHADE, 'mac-finder', 30, 25);
    expect(savedAt(store, 'mac-finder')).toEqual({ x: 70, y: 65 });
  });

  it('brings a clicked window to the front', () => {
    const store = presetToStore(MACOS9_WINDOWSHADE);
    store.focusNode(asNodeId('mac-finder'));
    expect(orderOf(store, MACOS9_WINDOWSHADE).at(-1)).toBe('mac-finder');
    const after = layoutStore(store, 'mac-desktop', MACOS9_WINDOWSHADE);
    expect(after.placements.get('mac-finder')?.z).toBe(5);
  });

  it('rolls a window up from its collapse box, and down again, in place', () => {
    const store = presetToStore(MACOS9_WINDOWSHADE);
    toggle(store, MACOS9_WINDOWSHADE, 'mac-finder');
    const shaded = layoutStore(store, 'mac-desktop', MACOS9_WINDOWSHADE);
    expect(shaded.placements.get('mac-finder')).toMatchObject({ x: 40, y: 40, w: 360, h: 20 });
    toggle(store, MACOS9_WINDOWSHADE, 'mac-finder');
    const open = layoutStore(store, 'mac-desktop', MACOS9_WINDOWSHADE);
    expect(open.placements.get('mac-finder')).toMatchObject({ w: 360, h: 240 });
  });

  it('puts the collapse box at the right of the title bar', () => {
    expect(r.affordances.find((a) => a.id === 'desktop:minimize:mac-finder')?.rect).toMatchObject({
      x: 40 + 360 - 20,
      y: 40,
      w: 20,
      h: 20,
    });
  });

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

  it('restoring a window from its icon takes it back to its saved x, y and size above the rest', () => {
    const store = presetToStore(WIN31_ICONS);
    toggle(store, WIN31_ICONS, 'win31-app-3');
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

  it('starts every screen full width with its title bar on the display, where the user left it', () => {
    const store = presetToStore(AMIGA_SCREENS);
    for (const id of ['amiga-workbench', 'amiga-dpaint', 'amiga-term']) {
      const rect = r.placements.get(id)!;
      expect(rect).toMatchObject({ x: 0, w: 640, h: 256 });
      expect(rect.y).toBe(savedAt(store, id).y);
      expect(rect.y + 20).toBeLessThanOrEqual(256);
    }
  });

  it('clips what hangs below the display rather than reporting it', () => {
    expect(r.overflow).toBeUndefined();
  });

  it('drags a screen up and down only', () => {
    const store = presetToStore(AMIGA_SCREENS);
    dragBy(store, AMIGA_SCREENS, 'amiga-term', 80, 30);
    expect(savedAt(store, 'amiga-term')).toEqual({ x: 0, y: 210 });
  });

  it('stops a screen with its title bar at the bottom, and at the top of the display', () => {
    const store = presetToStore(AMIGA_SCREENS);
    dragBy(store, AMIGA_SCREENS, 'amiga-term', 0, 500);
    expect(savedAt(store, 'amiga-term').y).toBe(256 - 20);
    dragBy(store, AMIGA_SCREENS, 'amiga-dpaint', 0, -500);
    expect(savedAt(store, 'amiga-dpaint').y).toBe(0);
  });

  it('pulled all the way down, a screen reveals all but a title bar of the one behind', () => {
    const store = presetToStore(AMIGA_SCREENS);
    store.patchPlacement(asNodeId('amiga-term'), { y: 256 });
    store.patchPlacement(asNodeId('amiga-dpaint'), { y: 256 });
    const after = layoutStore(store, 'amiga-display', AMIGA_SCREENS);
    expect(after.placements.get('amiga-term')?.y).toBe(236);
    expect(topmostAt(after, { x: 10, y: 230 })).toBe('amiga-workbench');
    expect(topmostAt(after, { x: 10, y: 240 })).toBe('amiga-term');
  });

  it('leaves the depth order alone when a screen is clicked', () => {
    const store = presetToStore(AMIGA_SCREENS);
    store.focusNode(asNodeId('amiga-workbench'));
    expect(orderOf(store, AMIGA_SCREENS).at(-1)).toBe('amiga-term');
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

  it('moves a frame to negative coordinates and reports the canvas growing to reach it', () => {
    const store = presetToStore(FIGMA_CANVAS);
    dragBy(store, FIGMA_CANVAS, 'figma-mobile', -5000, -3000);
    expect(savedAt(store, 'figma-mobile')).toEqual({ x: -4880, y: -2960 });
    const after = layoutStore(store, 'figma-canvas', FIGMA_CANVAS);
    expect(after.overflow).toMatchObject({ left: 4880, top: 2960 });
  });

  it('leaves the layer order alone when a frame is selected', () => {
    const store = presetToStore(FIGMA_CANVAS);
    store.focusNode(asNodeId('figma-cover'));
    expect(orderOf(store, FIGMA_CANVAS).at(0)).toBe('figma-cover');
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

  it('keeps the positions the apps saved on the lost displays', () => {
    const store = presetToStore(UNPLUGGED_MONITOR);
    expect(savedAt(store, 'mon-slack')).toEqual({ x: 1920, y: 60 });
    expect(savedAt(store, 'mon-xcode')).toEqual({ x: -1800, y: 40 });
  });

  it('pulls every window onto the laptop screen, wholly where it fits', () => {
    expect(r.placements.get('mon-slack')).toMatchObject({ x: 1280 - 1000, y: 60 });
    expect(r.placements.get('mon-terminal')).toMatchObject({ x: 1280 - 700, y: 800 - 440 });
    expect(r.placements.get('mon-mail')).toMatchObject({ x: 120, y: 80 });
    expect(outOfBounds(r.placements, UNPLUGGED_MONITOR.viewport)).toEqual(['mon-xcode']);
  });

  it('puts a window bigger than the screen at its top-left corner', () => {
    expect(r.placements.get('mon-xcode')).toMatchObject({ x: 0, y: 0, w: 1600, h: 1000 });
    expect(r.overflow).toEqual({ w: 1600 - 1280, h: 1000 - 800 });
  });

  it('drags from where a window shows, not the saved spot, and stops at the edge', () => {
    const store = presetToStore(UNPLUGGED_MONITOR);
    dragBy(store, UNPLUGGED_MONITOR, 'mon-slack', -30, 10);
    expect(savedAt(store, 'mon-slack')).toEqual({ x: 250, y: 70 });
    dragBy(store, UNPLUGGED_MONITOR, 'mon-slack', 900, 0);
    expect(savedAt(store, 'mon-slack')).toEqual({ x: 280, y: 70 });
  });

  it('brings a clicked window to the front', () => {
    const store = presetToStore(UNPLUGGED_MONITOR);
    store.focusNode(asNodeId('mon-mail'));
    expect(orderOf(store, UNPLUGGED_MONITOR).at(-1)).toBe('mon-mail');
  });

  it('survives a snapshot round trip with the off-screen positions intact', async () => {
    const { serialize, deserialize } = await import('../snapshot.js');
    const store = presetToStore(UNPLUGGED_MONITOR);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(store))));
    expect(savedAt(back, 'mon-xcode')).toEqual({ x: -1800, y: 40 });
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
