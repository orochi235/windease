import { describe, expect, it } from 'vitest';
import type { LayoutItem, LayoutStrategy } from '../layout-types.js';
import { captureTrace } from '../test-utils/capture-trace.js';
import { desktopStrategy } from './desktop.js';
import { gridStrategy } from './grid.js';
import { type PageState, pageStrategy } from './page.js';
import { stripStrategy } from './strip.js';

const container = { w: 100, h: 100 };

const win = (id: string, page?: unknown): LayoutItem =>
  page === undefined ? { id } : { id, meta: { page } };

const tiles = (n: number): LayoutItem[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

/** 50×50 cells in a 100×100 box: four to a page. */
const FLOWED = { mode: 'flowed', inner: { cell: { w: 50, h: 50 } } };

function run<T>(
  inner: LayoutStrategy<T, string, unknown>,
  items: LayoutItem[],
  options: Record<string, unknown> = {},
  page = 0,
) {
  const s = pageStrategy(inner);
  const state = { ...s.initialState(items, options), page };
  return s.layout({ items, container, state, options });
}

const ctx = (items: LayoutItem[], options: Record<string, unknown> = {}) => ({
  container,
  options,
  items,
});

describe('pageStrategy — assigned', () => {
  it('shows only the current page, and withholds the rest', () => {
    const r = run(stripStrategy, [win('a', 0), win('b', 1), win('c', 0)]);
    expect([...r.placements.keys()]).toEqual(['a', 'c']);
    expect(r.unplaced).toEqual(['b']);
  });

  it('shows the page state names', () => {
    const r = run(gridStrategy, [win('a', 0), win('b', 1)], {}, 1);
    expect([...r.placements.keys()]).toEqual(['b']);
    expect(r.placements.get('b')).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('puts a child with no page on page 0, and traces an invalid one there', () => {
    const t = captureTrace('layout');
    const r = run(stripStrategy, [win('a'), win('b', -1), win('c', 1.5), win('d', 1)]);
    expect([...r.placements.keys()]).toEqual(['a', 'b', 'c']);
    expect(t.matching(/b has page -1, shown on page 0/)).toHaveLength(1);
  });

  it('counts max(pages, highest page + 1) pages', () => {
    const count = (items: LayoutItem[], options: Record<string, unknown>) =>
      (
        run(stripStrategy, items, { ...options, bar: 10 }).affordances[0]?.meta as
          | { count: number }
          | undefined
      )?.count;
    expect(count([win('a', 0)], {})).toBe(1);
    expect(count([win('a', 0)], { pages: 4 })).toBe(4);
    expect(count([win('a', 5)], { pages: 4 })).toBe(6);
  });

  it('shows the last page when the stored page is past it', () => {
    const r = run(stripStrategy, [win('a', 0), win('b', 1)], {}, 7);
    expect([...r.placements.keys()]).toEqual(['b']);
  });

  it('reports every child page as a channel, over the inner channels', () => {
    const r = run(stripStrategy, [win('a', 0), win('b', 2)]);
    expect(r.channels?.get('a')).toEqual({ page: 0 });
    expect(r.channels?.get('b')).toEqual({ page: 2 });
  });
});

describe('pageStrategy — flowed', () => {
  it('fills a page with what inner places and spills the rest onto the next', () => {
    const r0 = run(gridStrategy, tiles(10), FLOWED);
    expect([...r0.placements.keys()]).toEqual(['t0', 't1', 't2', 't3']);
    const r2 = run(gridStrategy, tiles(10), FLOWED, 2);
    expect([...r2.placements.keys()]).toEqual(['t8', 't9']);
    expect(r2.channels?.get('t9')).toEqual({ page: 2 });
    expect(r2.channels?.get('t0')).toEqual({ page: 0 });
  });

  it('ignores placement.page', () => {
    const r = run(gridStrategy, [win('a', 3), win('b', 1)], FLOWED);
    expect([...r.placements.keys()]).toEqual(['a', 'b']);
  });

  it('gives a child that fits no page a page of its own, so the loop ends', () => {
    // Places anything but 'huge', one child per pass.
    const oneAtATime: LayoutStrategy<void, string, unknown> = {
      name: 'one',
      layout: ({ items }) => {
        const first = items.find((i) => i.id !== 'huge');
        const placements = new Map(first ? [[first.id, { x: 0, y: 0, z: 0, w: 1, h: 1 }]] : []);
        return {
          placements,
          affordances: [],
          unplaced: items.filter((i) => i !== first).map((i) => i.id),
        };
      },
    };
    const t = captureTrace('layout');
    const s = pageStrategy(oneAtATime);
    const options = { mode: 'flowed' };
    const items = [{ id: 'huge' }, { id: 'b' }];
    const state = s.initialState(items, options);
    const r = s.layout({ items, container, state, options });
    expect(r.channels?.get('b')).toEqual({ page: 0 });
    expect(r.channels?.get('huge')).toEqual({ page: 1 });
    expect(t.matching(/huge fits no page/)).toHaveLength(1);
  });

  it('puts everything on one page when inner never reports anything unplaced', () => {
    const sized = tiles(3).map((t) => ({ ...t, hints: { preferredSize: { w: 500, h: 500 } } }));
    const r = run(desktopStrategy(), sized, { mode: 'flowed' });
    expect(r.channels?.get('t2')).toEqual({ page: 0 });
  });
});

describe('pageStrategy — bar', () => {
  it('lays inner out in the area the bar leaves, below a top bar', () => {
    const r = run(gridStrategy, [win('a')], { bar: 20, barSide: 'top' });
    expect(r.placements.get('a')).toMatchObject({ x: 0, y: 20, w: 100, h: 80 });
  });

  it('emits one named click affordance per page, splitting the bar', () => {
    const r = run(stripStrategy, [win('a', 0), win('b', 1)], { bar: 20 }, 1);
    expect(r.placements.get('b')).toMatchObject({ y: 0, h: 80 });
    expect(r.affordances).toEqual([
      {
        id: 'page:0',
        kind: 'click',
        rect: { x: 0, y: 80, z: 0, w: 50, h: 20 },
        name: 'Page 1 of 2',
        meta: { page: 0, count: 2, current: false },
      },
      {
        id: 'page:1',
        kind: 'click',
        rect: { x: 50, y: 80, z: 0, w: 50, h: 20 },
        name: 'Page 2 of 2',
        meta: { page: 1, count: 2, current: true },
      },
    ]);
  });

  it('emits no switcher without a bar', () => {
    expect(run(stripStrategy, [win('a', 0), win('b', 1)]).affordances).toEqual([]);
  });
});

describe('pageStrategy — switching', () => {
  const s = pageStrategy(stripStrategy);
  const items = [win('a', 0), win('b', 1), win('c', 2)];
  const at = (page: number): PageState<void> => ({ page, inner: undefined });

  it('switches to a page when its affordance is clicked', () => {
    const next = s.reduce?.(
      at(0),
      { affordanceId: 'page:2', kind: 'click', payload: {} },
      ctx(items),
    );
    expect(next?.page).toBe(2);
  });

  it('returns the same state for a click on the page already shown', () => {
    const state = at(1);
    const next = s.reduce?.(
      state,
      { affordanceId: 'page:1', kind: 'click', payload: {} },
      ctx(items),
    );
    expect(next).toBe(state);
  });

  it('answers next, prev and page commands, stopping at either end', () => {
    const c = ctx(items);
    expect(s.command?.(at(0), { type: 'next' }, c).page).toBe(1);
    expect(s.command?.(at(2), { type: 'next' }, c).page).toBe(2);
    expect(s.command?.(at(0), { type: 'prev' }, c).page).toBe(0);
    expect(s.command?.(at(0), { type: 'page', to: 2 }, c).page).toBe(2);
    expect(s.command?.(at(0), { type: 'page', to: 9 }, c).page).toBe(2);
  });

  it('counts flowed pages for next', () => {
    const g = pageStrategy(gridStrategy);
    const c = ctx(tiles(10), FLOWED);
    expect(g.command?.({ page: 2, inner: undefined as never }, { type: 'next' }, c).page).toBe(2);
    expect(g.command?.({ page: 1, inner: undefined as never }, { type: 'next' }, c).page).toBe(2);
  });

  it('ignores a command it does not know, returning the same state', () => {
    const state = at(0);
    expect(s.command?.(state, { type: 'spin' }, ctx(items))).toBe(state);
  });
});

describe('pageStrategy — delegation', () => {
  it('forwards inner config from config.inner', () => {
    const r = run(gridStrategy, [win('a'), win('b')], { inner: { cols: 1 } });
    expect(r.placements.get('b')).toMatchObject({ x: 0, y: 50, w: 100, h: 50 });
  });

  it('routes an inner affordance to inner.reduce over the page shown', () => {
    const calls: string[][] = [];
    const inner: LayoutStrategy<number, string, unknown> = {
      name: 'probe',
      initialState: () => 0,
      layout: () => ({ placements: new Map(), affordances: [] }),
      reduce: (state, _event, context) => {
        calls.push(context.items.map((i) => i.id));
        return state + 1;
      },
    };
    const s = pageStrategy(inner);
    const items = [win('a', 0), win('b', 1)];
    const next = s.reduce?.(
      { page: 1, inner: 0 },
      { affordanceId: 'seam', kind: 'drag', payload: { dx: 1 } },
      ctx(items),
    );
    expect(next).toEqual({ page: 1, inner: 1 });
    expect(calls).toEqual([['b']]);
  });

  it('is named after the strategy it wraps', () => {
    expect(pageStrategy(gridStrategy).name).toBe('page(grid)');
  });
});
