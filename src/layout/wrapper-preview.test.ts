import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost, type ContainerLayout } from '../container-host.js';
import type { LayoutPreview, LayoutStrategy, StrategyRegistry } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { desktopStrategy } from './desktop.js';
import { floatingStrategy } from './floating.js';
import { gridStrategy } from './grid.js';
import { pageStrategy } from './page.js';
import { stripStrategy } from './strip.js';
import { swell, tilt, warp } from './warp.js';

/** `gridStrategy`, counting how often its fast path answers. */
function countingGrid() {
  const counter = { calls: 0 };
  const grid: LayoutStrategy<void, string> = {
    ...gridStrategy,
    getDropPreview(input) {
      counter.calls++;
      return gridStrategy.getDropPreview?.(input) ?? null;
    },
  };
  return { grid: grid as LayoutStrategy<never, string, unknown>, counter };
}

/** Mulberry32: a seeded generator, so a failing case replays. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Child {
  id: string;
  placement?: Record<string, unknown>;
  size?: { w: number; h: number };
}

interface Case {
  name: string;
  make: (grid: LayoutStrategy<never, string, unknown>) => LayoutStrategy<never, string, unknown>;
  config: Record<string, unknown>;
  children: Child[];
  state?: unknown;
  pointer?: { x: number; y: number };
  /** Children a same-parent drag can pick up, beside an arrival from elsewhere. */
  movable: string[];
  /** Whether some preview reaches the inner grid's fast path. */
  reachesInner: boolean;
  /** Whether the wrapper draws handles of its own, which a drag must keep. */
  handles?: true;
}

const VIEWPORT = { w: 400, h: 300 };
const tiles = (n: number, extra: Record<string, unknown> = {}): Child[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, placement: { ...extra } }));

const CASES: Case[] = [
  {
    name: 'floating(grid)',
    make: (g) => floatingStrategy(g) as never,
    config: { snapToPanes: true, inner: { cols: 3, gap: 6 } },
    children: [
      ...tiles(5),
      { id: 'f1', placement: { floating: true }, size: { w: 80, h: 60 } },
      { id: 'f2', placement: { floating: true }, size: { w: 50, h: 40 } },
    ],
    state: { at: { f1: { x: 30, y: 40, anchor: null }, f2: { x: 0, y: 0, anchor: 'top-right' } } },
    movable: ['t1', 't4'],
    reachesInner: true,
    handles: true,
  },
  {
    name: 'desktop(grid), mirrored',
    make: (g) => desktopStrategy(g) as never,
    config: {
      iconFrom: 'top-right',
      drag: true,
      resizable: true,
      inner: { cols: 4, cell: { h: 50 }, gap: 4 },
    },
    children: [
      ...tiles(4, { icon: true }),
      { id: 'w1', placement: { x: 40, y: 30, size: { w: 160, h: 120 } } },
      { id: 'w2', placement: { x: 300, y: 250, size: { w: 200, h: 100 } } },
    ],
    movable: ['t0', 't2', 'w1'],
    reachesInner: true,
    handles: true,
  },
  {
    name: 'page(grid), assigned',
    make: (g) => pageStrategy(g) as never,
    config: { pages: 3, bar: 24, barSide: 'top', inner: { cols: 3, gap: 4 } },
    children: [
      ...tiles(3, { page: 0 }),
      { id: 'p1a', placement: { page: 1 } },
      { id: 'p1b', placement: { page: 1 } },
    ],
    state: { page: 1 },
    movable: ['p1a', 'p1b'],
    reachesInner: true,
    handles: true,
  },
  {
    name: 'page(grid), flowed',
    make: (g) => pageStrategy(g) as never,
    config: { mode: 'flowed', inner: { cols: 2, rows: 2 } },
    children: tiles(7),
    state: { page: 1 },
    movable: ['t2', 't5'],
    reachesInner: false,
  },
  {
    name: 'page(desktop(grid))',
    make: (g) => pageStrategy(desktopStrategy(g)) as never,
    config: { bar: 20, inner: { drag: true, inner: { cols: 3 } } },
    children: [
      ...tiles(3, { icon: true, page: 0 }),
      { id: 'w1', placement: { x: 10, y: 10, page: 0, size: { w: 100, h: 80 } } },
    ],
    movable: ['t1', 'w1'],
    reachesInner: true,
    handles: true,
  },
  {
    name: 'warp(grid, tilt, swell)',
    make: (g) => warp(g, [tilt({ tilt: 0.6 }), swell({ gain: 1.6, reach: 140 })]) as never,
    config: { cols: 4, gap: 5 },
    children: tiles(6),
    pointer: { x: 170, y: 120 },
    movable: ['t0', 't3', 't5'],
    reachesInner: true,
  },
  {
    name: 'warp(floating(grid), tilt)',
    make: (g) => warp(floatingStrategy(g) as never, [tilt({ tilt: 0.4 })]) as never,
    config: { inner: { cols: 2 } },
    children: [...tiles(3), { id: 'f1', placement: { floating: true }, size: { w: 60, h: 60 } }],
    state: { at: { f1: { x: 100, y: 90, anchor: null } } },
    movable: ['t1'],
    reachesInner: true,
    handles: true,
  },
];

const Z = asNodeId('z');

function host(c: Case, strategy: LayoutStrategy<never, string, unknown>): ContainerHost {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', id: Z, container: { strategyId: 'x', config: c.config } }),
  );
  for (const child of c.children) {
    const id = asNodeId(child.id);
    store.registerNode(
      createNode({
        kind: 'panel',
        id,
        parentId: Z,
        ...(child.placement ? { placement: child.placement } : {}),
        ...(child.size ? { hints: { preferredSize: child.size } } : {}),
      }),
    );
    store.showNode(id);
  }
  const registry: StrategyRegistry = new Map([['x', strategy as never]]);
  const h = new ContainerHost(store, Z, registry);
  if (c.state !== undefined) {
    const seeded = strategy.initialState?.([], c.config) as Record<string, unknown> | undefined;
    store.setContainerState(Z, { ...seeded, ...(c.state as Record<string, unknown>) });
  }
  h.setViewport(VIEWPORT);
  if (c.pointer) h.setPointer(c.pointer);
  return h;
}

/**
 * Everything a layout carries that a drag shows.
 * No preview below names a `cell`: grid's own `layout({ preview })` ignores one
 * where its `getDropPreview` honors it, so the oracle would disagree with itself.
 */
const comparable = (l: ContainerLayout) => ({
  placements: l.placements,
  affordances: l.affordances.map((a) => ({ id: a.id, rect: a.rect })),
  isPreview: l.isPreview,
  unplaced: l.unplaced,
  overflow: l.overflow,
  channels: l.channels,
  sticky: l.sticky,
});

function previews(c: Case, random: () => number): LayoutPreview[] {
  const out: LayoutPreview[] = [];
  const n = c.children.length;
  for (let k = 0; k < 24; k++) {
    const pick = Math.floor(random() * (c.movable.length + 1));
    const insertId = c.movable[pick] ?? 'arrival';
    const at = random();
    const preview: LayoutPreview = {
      insertId,
      cursor: { x: Math.round(random() * VIEWPORT.w), y: Math.round(random() * VIEWPORT.h) },
    };
    if (at > 0.15) preview.insertIndex = Math.floor(random() * (n + 1));
    out.push(preview);
  }
  return out;
}

describe('a wrapper forwards getDropPreview into its own frame', () => {
  CASES.forEach((c, index) => {
    it(`${c.name}: matches layout({ preview })`, () => {
      const { grid, counter } = countingGrid();
      const strategy = c.make(grid);
      expect(strategy.getDropPreview).toBeDefined();
      const { getDropPreview: _fast, ...slow } = strategy;
      const fastHost = host(c, strategy);
      const slowHost = host(c, slow);
      let handles = 0;
      for (const preview of previews(c, rng(index + 1))) {
        fastHost.setPreview(preview);
        slowHost.setPreview(preview);
        const fast = comparable(fastHost.layout());
        const slowLayout = comparable(slowHost.layout());
        expect(fast, JSON.stringify(preview)).toEqual(slowLayout);
        handles += fast.affordances.length;
      }
      if (c.handles) expect(handles).toBeGreaterThan(0);
      if (c.reachesInner) expect(counter.calls).toBeGreaterThan(0);
      else expect(counter.calls).toBe(0);
      fastHost.destroy();
      slowHost.destroy();
    });
  });

  it('a wrapper over a strategy with no fast path adds none', () => {
    expect(floatingStrategy(stripStrategy).getDropPreview).toBeUndefined();
    expect(desktopStrategy().getDropPreview).toBeUndefined();
    expect(pageStrategy(desktopStrategy()).getDropPreview).toBeUndefined();
    expect(warp(stripStrategy, [tilt()]).getDropPreview).toBeUndefined();
  });

  it('desktop carries a cell to the inner grid unmirrored, and mirrors the answer', () => {
    const strategy = desktopStrategy(gridStrategy);
    const options = { iconFrom: 'top-right', inner: { cols: 4, cell: { h: 50 } } };
    const r = strategy.getDropPreview?.({
      items: [{ id: 'i0', meta: { icon: true } }],
      container: { w: 400, h: 300 },
      options,
      insertId: 'i0',
      insertIndex: 0,
      cursor: { x: 390, y: 10 },
      cell: { col: 0, row: 1 },
    });
    expect(r?.placements.get('i0')).toMatchObject({ x: 300, y: 50, w: 100, h: 50 });
  });

  it('page carries a cell to the inner grid below its bar', () => {
    const strategy = pageStrategy(gridStrategy);
    const options = { bar: 20, barSide: 'top', inner: { cols: 2, cell: { h: 40 } } };
    const r = strategy.getDropPreview?.({
      items: [{ id: 'a' }],
      container: { w: 200, h: 200 },
      options,
      insertId: 'new',
      insertIndex: 1,
      cursor: { x: 150, y: 100 },
      cell: { col: 1, row: 1 },
      state: { page: 0, inner: undefined },
    });
    expect(r?.accepted).toBe(true);
    expect(r?.placements.get('new')).toMatchObject({ x: 100, y: 60, w: 100, h: 40 });
  });
});
