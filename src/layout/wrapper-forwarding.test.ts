import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost } from '../container-host.js';
import type { LayoutItem, LayoutStrategy, StrategyRegistry } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { desktopStrategy } from './desktop.js';
import { floatingStrategy } from './floating.js';
import { FORWARDED_HOOKS, type ForwardedHook } from './forward.js';
import { gridStrategy } from './grid.js';
import { pageStrategy } from './page.js';
import { stripStrategy } from './strip.js';
import { type Pass, warp } from './warp.js';

const REGISTRY: StrategyRegistry = new Map([
  ['floating', floatingStrategy(stripStrategy) as never],
]);
const Z = asNodeId('z');

function build(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'floating', config: { inner: { axis: 'y', fill: true } } },
      id: Z,
    }),
  );
  for (const id of ['p1', 'p2']) {
    const nid = asNodeId(id);
    s.registerNode(createNode({ kind: 'panel', id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

describe('floatingStrategy over a strip', () => {
  it("routes a drag on the strip's seam to the strip", () => {
    const store = build();
    const h = new ContainerHost(store, Z, REGISTRY);
    h.setViewport({ w: 200, h: 400 });
    const seam = h.layout().affordances.find((a) => !a.id.startsWith('floating:'));
    if (!seam) throw new Error('fixture has no seam to drag');
    h.dispatchAffordance({ affordanceId: seam.id, kind: 'drag', payload: { dx: 0, dy: 40 } });
    const sizes = ['p1', 'p2'].map((id) => store.getNode(asNodeId(id))?.membership?.placement.size);
    expect(sizes.some((s) => s !== undefined)).toBe(true);
    h.destroy();
  });
});

describe('floatingStrategy over a grid', () => {
  it("answers cellAt from the grid's tiled items", () => {
    const strategy = floatingStrategy(gridStrategy);
    const low: LayoutItem = { id: 'low', placement: { cell: { col: 0, row: 1 } } };
    const items: LayoutItem[] = [low, { id: 'f', meta: { floating: true } }];
    const input = { container: { w: 320, h: 110 }, point: { x: 230, y: 80 } };
    const options = { inner: { cols: 3, gap: 10, cell: { h: 50 } } };
    expect(strategy.cellAt?.({ ...input, items, options })).toEqual({ col: 2, row: 1 });
  });
});

describe('pageStrategy over a floating strategy', () => {
  const strategy = pageStrategy(desktopStrategy());
  const state = { page: 2, inner: { inner: undefined } };

  it('floats a child below a top bar, on the shown page', () => {
    const r = strategy.float?.place({
      id: 'w',
      at: { x: 10, y: 50 },
      state,
      options: { bar: 30, barSide: 'top' },
    });
    expect(r?.placement).toMatchObject({ x: 10, y: 20, page: 2 });
  });

  it('leaves the page to pagination under flowed mode', () => {
    const r = strategy.float?.place({
      id: 'w',
      at: { x: 10, y: 50 },
      state,
      options: { mode: 'flowed' },
    });
    expect(r?.placement).not.toHaveProperty('page');
  });

  it('clears the page along with the inner keys when a child docks out', () => {
    expect(strategy.float?.keys).toContain('page');
  });
});

describe('desktopStrategy over a grid', () => {
  const low: LayoutItem = {
    id: 'low',
    meta: { icon: true },
    placement: { cell: { col: 0, row: 1 } },
  };
  const container = { w: 320, h: 110 };
  const grid = { cols: 3, gap: 10, cell: { h: 50 } };

  it("answers cellAt from the icon layer's grid", () => {
    const strategy = desktopStrategy(gridStrategy);
    const r = strategy.cellAt?.({
      items: [low],
      container,
      options: { inner: grid },
      point: { x: 230, y: 80 },
    });
    expect(r).toEqual({ col: 2, row: 1 });
  });

  it('mirrors the point under a flipped iconFrom', () => {
    const strategy = desktopStrategy(gridStrategy);
    const options = { inner: grid, iconFrom: 'top-right' };
    const r = strategy.cellAt?.({
      items: [low],
      container,
      options,
      point: { x: 320 - 230, y: 80 },
    });
    expect(r).toEqual({ col: 2, row: 1 });
  });
});

/** An inner strategy with every forwardable hook, recording what each call is handed. */
function probe() {
  const calls: Record<string, unknown[]> = {};
  const log =
    <R>(hook: string, answer: R) =>
    (...args: unknown[]): R => {
      calls[hook] = args;
      return answer;
    };
  const strategy: LayoutStrategy<string, string, unknown> = {
    name: 'probe',
    initialState: () => 'seed',
    layout: () => ({ placements: new Map(), affordances: [] }),
    reduce: log('reduce', 'reduced'),
    dispatchAffordance: log('dispatchAffordance', undefined),
    command: log('command', 'commanded'),
    land: log('land', 'landed'),
    canAccept: log('canAccept', false),
    navigate: log('navigate', 'n1'),
    cellAt: log('cellAt', { col: 7, row: 7 }),
  };
  return { strategy, calls };
}

/** The ids of the children a recorded call was handed. */
const handedIds = (arg: unknown) => (arg as { items: LayoutItem[] }).items.map((i) => i.id);

const shiftX: Pass = {
  name: 'shift-x',
  moves: true,
  apply: (r) => r,
  invert: (p) => ({ x: p.x - 100, y: p.y }),
};

describe('every wrapper forwards every hook its inner strategy has', () => {
  const wrappers: [
    string,
    (inner: LayoutStrategy<string, string, unknown>) => LayoutStrategy<never>,
    ForwardedHook[],
  ][] = [
    ['floating', (i) => floatingStrategy(i) as never, []],
    ['desktop', (i) => desktopStrategy(i) as never, []],
    // Neither hook is handed container state, so page cannot tell which page shows.
    ['page', (i) => pageStrategy(i) as never, ['canAccept', 'cellAt']],
    ['warp', (i) => warp(i, [shiftX]) as never, []],
  ];
  for (const [name, wrap, withheld] of wrappers) {
    it(name, () => {
      const strategy = wrap(probe().strategy);
      const missing = FORWARDED_HOOKS.filter((h) => !withheld.includes(h) && !strategy[h]);
      expect(missing).toEqual([]);
    });
  }
});

describe('forwarded hooks reach the inner strategy in its own frame', () => {
  const container = { w: 300, h: 200 };

  it('desktop hands a command the inner state and stores the answer under inner', () => {
    const { strategy: inner, calls } = probe();
    const s = desktopStrategy(inner);
    const next = s.command?.(
      { inner: 'mine' },
      { type: 'next' },
      { container, options: {}, items: [] },
    );
    expect(calls.command?.[0]).toBe('mine');
    expect(next).toEqual({ inner: 'commanded' });
  });

  it('floating lands arrivals through the inner strategy, minus its floating children', () => {
    const { strategy: inner, calls } = probe();
    const s = floatingStrategy(inner);
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'f', meta: { floating: true } }];
    const next = s.land?.({
      ids: [asNodeId('a')],
      state: { at: {}, inner: 'mine' },
      store: new Store(),
      parentId: Z,
      container,
      options: {},
      items,
    });
    expect(handedIds(calls.land?.[0])).toEqual(['a']);
    expect(next).toEqual({ at: {}, inner: 'landed' });
  });

  it("floating's reduce hands the inner strategy only its tiled children", () => {
    const { strategy: inner, calls } = probe();
    const s = floatingStrategy(inner);
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'f', meta: { floating: true } }];
    s.reduce?.(
      { at: {}, inner: 'mine' },
      { affordanceId: 'seam', kind: 'drag', payload: { dx: 1 } },
      { container, options: {}, items },
    );
    expect(handedIds(calls.reduce?.[2])).toEqual(['a']);
  });

  it('page passes a command it does not know on to the inner strategy', () => {
    const { strategy: inner, calls } = probe();
    const s = pageStrategy(inner);
    const next = s.command?.(
      { page: 0, inner: 'mine' },
      { type: 'zoom' },
      { container, options: {}, items: [] },
    );
    expect(calls.command?.[1]).toEqual({ type: 'zoom' });
    expect(next).toEqual({ page: 0, inner: 'commanded' });
  });

  it('page still answers its own commands without asking the inner strategy', () => {
    const { strategy: inner, calls } = probe();
    pageStrategy(inner).command?.(
      { page: 0, inner: 'mine' },
      { type: 'next' },
      { container, options: {}, items: [] },
    );
    expect(calls.command).toBeUndefined();
  });

  it('warp answers cellAt through the inverted point', () => {
    const s = warp(gridStrategy, [shiftX]);
    const low: LayoutItem = { id: 'low', placement: { cell: { col: 0, row: 1 } } };
    const input = {
      items: [low],
      container: { w: 320, h: 110 },
      options: { cols: 3, gap: 10, cell: { h: 50 } },
    };
    expect(s.cellAt?.({ ...input, point: { x: 330, y: 80 } })).toEqual(
      gridStrategy.cellAt?.({ ...input, point: { x: 230, y: 80 } }),
    );
    expect(s.cellAt?.({ ...input, point: { x: 330, y: 80 } })).toEqual({ col: 2, row: 1 });
  });

  it('an affordance the wrapper owns never reaches the inner strategy', () => {
    const { strategy: inner, calls } = probe();
    const s = floatingStrategy(inner);
    s.reduce?.(
      { at: {}, inner: 'mine' },
      { affordanceId: 'floating:drag:x', kind: 'drag', payload: { dx: 1 } },
      { container, options: {}, items: [] },
    );
    expect(calls.reduce).toBeUndefined();
  });
});
