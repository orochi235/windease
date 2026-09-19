import { describe, expect, it } from 'vitest';
import type { LayoutEvent, LayoutItem, LayoutStrategy, Size } from '../layout-types.js';
import { checkStrategyConfig } from './config-check.js';
import { type FloatingPlacement, type FloatingState, floatingStrategy } from './floating.js';

/** Two zones side by side, each half the container, at whatever width it is. */
const halves: LayoutStrategy<void, string> = {
  name: 'halves',
  layout: ({ items, container }) => ({
    placements: new Map(
      items.map(
        (item, i) =>
          [
            item.id,
            { x: (i * container.w) / 2, y: 0, z: 0, w: container.w / 2, h: container.h },
          ] as const,
      ),
    ),
    affordances: [],
  }),
};

const container: Size = { w: 400, h: 300 };
const win: LayoutItem = { id: 'win', meta: { floating: true }, natural: { w: 100, h: 80 } };
const zones: LayoutItem[] = [
  { id: 'left', meta: {} },
  { id: 'right', meta: {} },
];
const items = [...zones, win];
const fill = { snap: 'fill' };
const s = floatingStrategy(halves);

const state = (place: FloatingPlacement): FloatingState<undefined> => ({
  at: { win: place },
  inner: undefined,
});
const drag = (dx: number, dy: number, point?: { x: number; y: number }): LayoutEvent => ({
  affordanceId: 'floating:drag:win',
  kind: 'drag',
  payload: point ? { dx, dy, point } : { dx, dy },
});
const reduce = (st: FloatingState<undefined>, e: LayoutEvent, options = fill, c = container) =>
  s.reduce?.(st, e, { container: c, options, items }) as FloatingState<undefined>;
const layout = (st: FloatingState<undefined>, options = fill, c = container) =>
  s.layout({ items, container: c, state: st, options });

describe("floating snap: 'fill'", () => {
  it('binds the item to the zone the pointer is over', () => {
    const next = reduce(state({ x: 20, y: 20, anchor: null }), drag(250, 0, { x: 320, y: 40 }));
    expect(next.at.win?.fill).toBe('right');
  });

  it('lays a bound item out as its zone', () => {
    const r = layout(state({ x: 270, y: 20, anchor: null, fill: 'right' }));
    expect(r.placements.get('win')).toEqual({ x: 200, y: 0, z: 0, w: 200, h: 300 });
  });

  it('follows its zone when the layout changes', () => {
    const r = layout(state({ x: 270, y: 20, anchor: null, fill: 'right' }), fill, {
      w: 800,
      h: 300,
    });
    expect(r.placements.get('win')).toEqual({ x: 400, y: 0, z: 0, w: 400, h: 300 });
  });

  it('keeps its free position and size while bound, to return to', () => {
    const next = reduce(state({ x: 20, y: 20, anchor: null }), drag(250, 0, { x: 320, y: 40 }));
    expect(next.at.win).toMatchObject({ x: 270, y: 20, anchor: null });
  });

  it('frees the item at its own size once dragged off every zone', () => {
    const outside: LayoutStrategy<void, string> = {
      name: 'one',
      layout: () => ({
        placements: new Map([['left', { x: 0, y: 0, z: 0, w: 200, h: 150 }]]),
        affordances: [],
      }),
    };
    const one = floatingStrategy(outside);
    const bound = state({ x: 20, y: 20, anchor: null, fill: 'left' });
    // Grabbed at the zone's title band (10, 5) and dragged down out of it.
    const next = one.reduce?.(bound, drag(0, 200, { x: 10, y: 205 }), {
      container,
      options: fill,
      items,
    }) as FloatingState<undefined>;
    expect(next.at.win?.fill).toBeUndefined();
    const r = one.layout({ items, container, state: next, options: fill });
    expect(r.placements.get('win')).toMatchObject({ w: 100, h: 80 });
  });

  it('keeps the grab point under the pointer, in proportion, as a bound item shrinks back', () => {
    // Bound to 'left' (200×300); grabbed at its middle, (100, 150).
    const bound = state({ x: 20, y: 20, anchor: null, fill: 'left' });
    const next = reduce(bound, drag(4, 0, { x: 104, y: 150 }));
    // Half of 100×80 is (50, 40), so the free rect sits at (54, 110).
    expect(next.at.win).toMatchObject({ x: 54, y: 110, fill: 'left' });
  });

  it('moves a free item by the drag delta, as corner mode does', () => {
    const next = reduce(state({ x: 150, y: 100, anchor: null }), drag(10, 5, { x: 170, y: 110 }));
    expect(next.at.win).toMatchObject({ x: 160, y: 105 });
  });

  it("hit-tests the item's center when the event carries no pointer", () => {
    // Center moves from (200, 140) to (230, 140): into 'right'.
    const next = reduce(state({ x: 150, y: 100, anchor: null }), drag(30, 0));
    expect(next.at.win).toMatchObject({ x: 180, fill: 'right' });
  });

  it('never snaps to a corner', () => {
    const next = reduce(state({ x: 30, y: 30, anchor: null }), drag(-18, -18));
    expect(next.at.win?.anchor).toBeNull();
  });

  it('falls back to the free position when its zone goes away', () => {
    const st = state({ x: 40, y: 60, anchor: null, fill: 'gone' });
    expect(layout(st).placements.get('win')).toEqual({ x: 40, y: 60, z: 0, w: 100, h: 80 });
  });

  it("ignores the binding under snap: 'corner'", () => {
    const st = state({ x: 40, y: 60, anchor: null, fill: 'right' });
    expect(layout(st, { snap: 'corner' }).placements.get('win')).toMatchObject({ w: 100 });
  });

  it('survives a snapshot round trip', () => {
    const next = reduce(state({ x: 20, y: 20, anchor: null }), drag(250, 0, { x: 320, y: 40 }));
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  });

  it('drops the binding when the item is floated afresh', () => {
    const placed = s.float?.place({
      id: 'win',
      at: { x: 5, y: 5 },
      state: state({ x: 0, y: 0, anchor: null, fill: 'left' }),
      options: fill,
    });
    expect(placed?.state?.at.win).toEqual({ x: 5, y: 5, anchor: null });
  });

  it('declares snap in its configSpec', () => {
    expect(checkStrategyConfig('floating', { snap: 'fill' }, s.configSpec!)).toEqual([]);
    expect(checkStrategyConfig('floating', { snap: 'zone' }, s.configSpec!)).toHaveLength(1);
  });
});
