import { describe, expect, it } from 'vitest';
import { DragEngine } from '../dnd/DragEngine.js';
import { runStrategyForContainer } from '../layout-node-adapter.js';
import type {
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Size,
} from '../layout-types.js';
import { asNodeId, type NodeId } from '../node.js';
import type { Store } from '../store.js';
import {
  dropped,
  malformedRects,
  outOfBounds,
  overlaps,
  prng,
  runScenario,
} from '../test-utils/exotic/invariants.js';
import {
  FANCYZONES,
  FLOATING_PATHOLOGY,
  OVERLAP_STRATEGIES,
  PHOTOSHOP_PANELS,
  PRESETS,
} from '../test-utils/exotic/overlap-scenarios.js';
import { type Preset, presetScenario, presetToStore } from '../test-utils/exotic/preset.js';
import { type FloatingState, floatingStrategy } from './floating.js';
import { gridStrategy } from './grid.js';

type State = FloatingState<unknown>;

/** Pins the inner state type to `unknown`, so one `State` serves every wrapped strategy. */
const floatingOver = (inner?: LayoutStrategy<unknown, string, unknown>) =>
  floatingStrategy<unknown>(inner);

const FLOATING_PRESETS = PRESETS.filter((p) => p.mechanics.strategy?.startsWith('floating'));

const drag = (id: string, dx: number, dy: number): LayoutEvent => ({
  affordanceId: `floating:drag:${id}`,
  kind: 'drag',
  payload: { dx, dy },
});

/** Replays `moves` through `reduce` from the strategy's own initial state. */
function dragged(
  strategy: ReturnType<typeof floatingOver>,
  items: LayoutItem[],
  container: Size,
  options: Record<string, unknown>,
  moves: LayoutEvent[],
): State {
  let state = strategy.initialState(items, options) as State;
  for (const e of moves) state = strategy.reduce!(state, e, { items, container, options }) as State;
  return state;
}

function layoutStore(store: Store, parent: string, viewport: Size) {
  const id = asNodeId(parent) as NodeId;
  const node = store.getNode(id)!;
  const strategy = OVERLAP_STRATEGIES[node.container!.strategyId]!;
  const items = presetLikeItems(store, parent);
  const state = strategy.initialState?.(items, node.container!.config as Record<string, unknown>);
  return runStrategyForContainer(
    store,
    id,
    viewport,
    strategy,
    state,
  ) as unknown as LayoutResult<string>;
}

function presetLikeItems(store: Store, parent: string): LayoutItem[] {
  return store.getChildren(asNodeId(parent) as NodeId).map((n) => ({
    id: n.id,
    meta: { ...(n.membership?.placement ?? {}) },
  }));
}

describe('floating presets: generic invariants', () => {
  it.each(FLOATING_PRESETS.map((p) => [p.id, p] as const))(
    '%s: no malformed rects, no silent drops, deterministic, floating items inside',
    (_, preset: Preset) => {
      const s = presetScenario(preset);
      const strategy = OVERLAP_STRATEGIES[preset.mechanics.strategy!]!;
      const r = runScenario(strategy, s);
      expect(malformedRects(r.placements)).toEqual([]);
      expect(dropped(s.items, r)).toEqual([]);
      expect(runScenario(strategy, s)).toEqual(r);
      const floatingIds = s.items.filter((i) => i.meta?.floating === true).map((i) => i.id);
      const floatingRects = new Map(floatingIds.map((id) => [id, r.placements.get(id)!]));
      expect(outOfBounds(floatingRects, s.container)).toEqual([]);
    },
  );

  // Stacking is not in the contract (TODO: "Floating chrome: z-order"), so it falls to DOM order.
  it('gives floating items the same z as the tiles under them', () => {
    const s = presetScenario(FANCYZONES);
    const r = runScenario(OVERLAP_STRATEGIES['floating-grid']!, s);
    expect(r.placements.get('fz-edge')?.z).toBe(0);
    expect(r.placements.get('fz-zone-left')?.z).toBe(0);
    expect(overlaps(r.placements).length).toBeGreaterThan(0);
  });
});

describe('FancyZones / Snap Layouts: tiled zones as snap targets', () => {
  const s = presetScenario(FANCYZONES);
  const strategy = floatingOver(gridStrategy as never);
  const zones = runScenario(strategy, s).placements;
  const center = zones.get('fz-zone-center')!;
  const seeded = runScenario(strategy, s).placements.get('fz-edge')!;

  /** Moves `id` so its origin lands `off` px past `target`, in one drag. */
  const moveTo = (
    id: string,
    from: { x: number; y: number },
    target: { x: number; y: number },
    off = 0,
  ) => drag(id, target.x + off - from.x, target.y + off - from.y);

  it('snaps a window dropped near a zone corner into that zone, inset', () => {
    const state = dragged(strategy, s.items, s.container, s.options, [
      moveTo('fz-edge', seeded, { x: center.x + 12, y: center.y + 12 }, 18),
    ]);
    expect(state.at['fz-edge']).toMatchObject({ anchor: 'top-left', anchorTo: 'fz-zone-center' });
    const r = strategy.layout({
      items: s.items,
      container: s.container,
      state,
      options: s.options,
    });
    expect(r.placements.get('fz-edge')).toMatchObject({ x: center.x + 12, y: center.y + 12 });
  });

  it('follows the zone when the monitor changes resolution', () => {
    const state = dragged(strategy, s.items, s.container, s.options, [
      moveTo('fz-edge', seeded, { x: center.x + 12, y: center.y + 12 }, 4),
    ]);
    const wide = { w: 1920, h: 1080 };
    const r = strategy.layout({ items: s.items, container: wide, state, options: s.options });
    const wideCenter = r.placements.get('fz-zone-center')!;
    expect(wideCenter.x).not.toBe(center.x);
    expect(r.placements.get('fz-edge')).toMatchObject({
      x: wideCenter.x + 12,
      y: wideCenter.y + 12,
    });
  });

  it('refuses a corner the window excludes, even inside the threshold', () => {
    const code = runScenario(strategy, s).placements.get('fz-code')!;
    const bottomLeft = { x: center.x + 12, y: center.y + center.h - code.h - 12 };
    const state = dragged(strategy, s.items, s.container, s.options, [
      moveTo('fz-code', code, bottomLeft, 2),
    ]);
    expect(state.at['fz-code']?.anchor).toBeNull();
  });

  it('drops a zone anchor back to the free position when the zone disappears', () => {
    const state = dragged(strategy, s.items, s.container, s.options, [
      moveTo('fz-edge', seeded, { x: center.x + 12, y: center.y + 12 }, 4),
    ]);
    const without = s.items.filter((i) => i.id !== 'fz-zone-center');
    const r = strategy.layout({
      items: without,
      container: s.container,
      state,
      options: s.options,
    });
    const at = state.at['fz-edge']!;
    expect(r.placements.get('fz-edge')).toMatchObject({ x: at.x, y: at.y });
  });

  it('keeps every window inside the desktop across 400 seeded random drags', () => {
    const rand = prng(3111);
    const moves = Array.from({ length: 400 }, () =>
      drag(rand(0, 1) ? 'fz-edge' : 'fz-code', rand(-300, 300), rand(-300, 300)),
    );
    let state = strategy.initialState(s.items, s.options) as State;
    for (const [k, e] of moves.entries()) {
      state = strategy.reduce!(state, e, {
        items: s.items,
        container: s.container,
        options: s.options,
      }) as State;
      const r = strategy.layout({
        items: s.items,
        container: s.container,
        state,
        options: s.options,
      });
      const rects = new Map(
        [...r.placements].filter(([id]) => id === 'fz-edge' || id === 'fz-code'),
      );
      expect(malformedRects(rects), `move ${k}`).toEqual([]);
      expect(outOfBounds(rects, s.container), `move ${k}`).toEqual([]);
    }
  });
});

describe('Photoshop: a tab torn out of a docked panel group', () => {
  const tearOut = (withSize: boolean) => {
    const store = presetToStore(PHOTOSHOP_PANELS);
    const id = asNodeId('ps-layers');
    store.moveNode(id, asNodeId('ps-workspace'));
    store.patchPlacement(id, { floating: true });
    if (withSize) store.setHints(id, { preferredSize: { w: 240, h: 300 } });
    return store;
  };

  it('seeds the torn-out palette at defaultAnchor', () => {
    const r = layoutStore(tearOut(true), 'ps-workspace', PHOTOSHOP_PANELS.viewport);
    expect(r.placements.get('ps-layers')).toMatchObject({
      x: 12,
      y: 12,
    });
  });

  it('withholds a torn-out tab that nothing has sized, rather than drawing it at 0×0', () => {
    const r = layoutStore(tearOut(false), 'ps-workspace', PHOTOSHOP_PANELS.viewport);
    expect(r.unplaced).toContain('ps-layers');
    expect(r.placements.has('ps-layers')).toBe(false);
  });

  it('seeds every new palette on the same corner, one over the other', () => {
    const r = layoutStore(tearOut(true), 'ps-workspace', PHOTOSHOP_PANELS.viewport);
    const a = r.placements.get('ps-layers')!;
    const b = r.placements.get('ps-color')!;
    expect({ x: a.x, y: a.y }).toEqual({ x: b.x, y: b.y });
  });

  it('leaves the docked strip tiling the canvas and dock as before', () => {
    const before = layoutStore(
      presetToStore(PHOTOSHOP_PANELS),
      'ps-workspace',
      PHOTOSHOP_PANELS.viewport,
    );
    const after = layoutStore(tearOut(true), 'ps-workspace', PHOTOSHOP_PANELS.viewport);
    expect(after.placements.get('ps-canvas')).toEqual(before.placements.get('ps-canvas'));
    expect(after.placements.get('ps-dock')).toEqual(before.placements.get('ps-dock'));
  });

  it('the group it left falls back to its next tab', () => {
    const store = tearOut(true);
    const r = layoutStore(store, 'ps-group-layers', { w: 280, h: 359 });
    expect([...r.placements.keys()]).toEqual(['ps-channels']);
  });
});

describe('Photoshop: tearing a panel out and docking it by its config', () => {
  const WORKSPACE = asNodeId('ps-workspace');
  const LAYERS = asNodeId('ps-group-layers');
  const PROPS = asNodeId('ps-group-props');

  /** The preset under a drag engine, with the dock's two groups stacked at the right edge. */
  const setup = () => {
    const store = presetToStore(PHOTOSHOP_PANELS);
    const e = new DragEngine(store, { getStrategy: (sid) => OVERLAP_STRATEGIES[sid] });
    e.addDropTarget(WORKSPACE, { bounds: () => ({ x: 0, y: 0, z: 0, w: 800, h: 520 }) });
    e.addDropTarget(LAYERS, {
      bounds: () => ({ x: 520, y: 0, z: 0, w: 280, h: 259 }),
      depth: () => 2,
      getInsertionIndex: () => 0,
    });
    e.addDropTarget(PROPS, {
      bounds: () => ({ x: 520, y: 261, z: 0, w: 280, h: 259 }),
      depth: () => 2,
      getInsertionIndex: () => 0,
    });
    return { store, e };
  };

  it('a tab dropped on the canvas floats there at the tearSize, and its group shows the next', () => {
    const { store, e } = setup();
    e.tryBegin(asNodeId('ps-layers'));
    e.updateHoverByPoint(100, 80);
    expect(e.state()?.hover).toEqual({ targetId: WORKSPACE, accepted: true, tear: true });
    e.drop();

    expect(store.getParent(asNodeId('ps-layers'))?.id).toBe(WORKSPACE);
    expect(store.getNode(asNodeId('ps-layers'))?.hints?.preferredSize).toEqual({ w: 240, h: 260 });
    expect(store.getPlacement(asNodeId('ps-layers')).floating).toBe(true);
    expect((store.getContainerState(WORKSPACE) as State).at['ps-layers']).toMatchObject({
      x: 100,
      y: 80,
    });
    const group = layoutStore(store, 'ps-group-layers', { w: 280, h: 259 });
    expect([...group.placements.keys()]).toEqual(['ps-channels']);
  });

  it('a floating panel dropped on a group docks there as a tab, no longer floating', () => {
    const { store, e } = setup();
    e.tryBegin(asNodeId('ps-color'));
    e.updateHoverByPoint(600, 300);
    expect(e.state()?.hover).toMatchObject({ targetId: PROPS, accepted: true });
    e.drop();

    expect(store.getParent(asNodeId('ps-color'))?.id).toBe(PROPS);
    expect(store.getPlacement(asNodeId('ps-color')).floating).toBeUndefined();
  });

  it('the workspace takes only tear-outs: the floating panel is not dropped back onto it', () => {
    const { e } = setup();
    e.tryBegin(asNodeId('ps-color'));
    e.updateHoverByPoint(100, 300);
    expect(e.state()?.hover).toMatchObject({ targetId: WORKSPACE, accepted: false });
  });
});

describe('unplugged monitor: saved free positions outside the container', () => {
  const palette: LayoutItem = {
    id: 'inspector',
    meta: { floating: true },
    natural: { w: 300, h: 500 },
  };
  const strategy = floatingOver();
  const state: State = { at: { inspector: { x: 2300, y: 900, anchor: null } }, inner: undefined };
  const laptop = { w: 1280, h: 800 };

  it('clamps the palette onto the remaining display', () => {
    const r = strategy.layout({ items: [palette], container: laptop, state, options: {} });
    expect(r.placements.get('inspector')).toMatchObject({ x: 980, y: 300 });
  });

  it('returns to the saved position when the display comes back, because layout never writes state', () => {
    strategy.layout({ items: [palette], container: laptop, state, options: {} });
    const r = strategy.layout({
      items: [palette],
      container: { w: 3840, h: 1600 },
      state,
      options: {},
    });
    expect(r.placements.get('inspector')).toMatchObject({ x: 2300, y: 900 });
  });

  it('first drag after the unplug moves from where the palette shows, not the saved spot', () => {
    const next = strategy.reduce!(state, drag('inspector', -10, 0), {
      items: [palette],
      container: laptop,
      options: {},
    }) as State;
    expect(next.at.inspector).toMatchObject({ x: 970, y: 300 });
  });

  it('survives a snapshot round trip of container state', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('pins an anchored palette taller than its container to the top edge, drag band in reach', () => {
    const anchored: State = {
      at: { inspector: { x: 0, y: 0, anchor: 'bottom-left' } },
      inner: undefined,
    };
    const r = strategy.layout({
      items: [palette],
      container: { w: 1280, h: 400 },
      state: anchored,
      options: { handleSize: 24 },
    });
    expect(r.placements.get('inspector')).toMatchObject({ x: 12, y: 0 });
    const handles = new Map(r.affordances.map((a) => [a.id, a.rect]));
    expect(outOfBounds(handles, { w: 1280, h: 400 })).toEqual([]);
  });
});

describe('floating pathology', () => {
  const byId = Object.fromEntries(FLOATING_PATHOLOGY.map((s) => [s.id, s]));
  const strategy = floatingOver();

  it('withholds zero and negative sizes', () => {
    const r = runScenario(strategy, byId['floating-unmeasured']!);
    expect(r.unplaced).toEqual(expect.arrayContaining(['zero', 'negative']));
    expect(r.placements.has('ok')).toBe(true);
    expect(dropped(byId['floating-unmeasured']!.items, r)).toEqual([]);
  });

  it('withholds an item whose measured size is NaN', () => {
    const r = runScenario(strategy, byId['floating-unmeasured']!);
    expect(malformedRects(r.placements)).toEqual([]);
  });

  it('places a free item at the origin of a 0×0 container', () => {
    const s = byId['floating-container-0x0']!;
    const state: State = { at: { p: { x: 40, y: 40, anchor: null } }, inner: undefined };
    const r = strategy.layout({ items: s.items, container: s.container, state, options: {} });
    expect(r.placements.get('p')).toMatchObject({ x: 0, y: 0, w: 120, h: 80 });
  });

  it('resolves every corner anchor to finite coordinates in a 0×0 container', () => {
    const s = byId['floating-container-0x0']!;
    for (const anchor of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const state: State = { at: { p: { x: 0, y: 0, anchor } }, inner: undefined };
      const r = strategy.layout({ items: s.items, container: s.container, state, options: {} });
      expect(malformedRects(r.placements), anchor).toEqual([]);
    }
  });

  it('ignores a NaN drag delta rather than saving it', () => {
    const items = byId['floating-unmeasured']!.items.filter((i) => i.id === 'ok');
    const container = { w: 800, h: 600 };
    const state = dragged(strategy, items, container, {}, [drag('ok', Number.NaN, 5)]);
    const r = strategy.layout({ items, container, state, options: {} });
    expect(malformedRects(r.placements)).toEqual([]);
  });

  it('absorbs an infinite drag delta at the container edge', () => {
    const items = byId['floating-unmeasured']!.items.filter((i) => i.id === 'ok');
    const container = { w: 800, h: 600 };
    const state = dragged(strategy, items, container, {}, [
      drag('ok', Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    ]);
    expect(state.at.ok).toMatchObject({ x: 600, y: 0 });
  });
});
