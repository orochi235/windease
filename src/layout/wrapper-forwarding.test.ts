import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost } from '../container-host.js';
import type { LayoutItem, StrategyRegistry } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { desktopStrategy } from './desktop.js';
import { floatingStrategy } from './floating.js';
import { gridStrategy } from './grid.js';
import { pageStrategy } from './page.js';
import { stripStrategy } from './strip.js';

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
  const state = { page: 2, inner: undefined };

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
