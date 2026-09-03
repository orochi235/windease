import { describe, expect, it } from 'vitest';
import type { LayoutItem, Rect } from '../layout-types.js';
import {
  containerTarget,
  cornerOrigin,
  eligibleCorners,
  FLOATING_CORNERS,
  floatingStrategy,
  isFloating,
  rectOf,
  snapCorner,
} from './floating.js';
import { stackStrategy } from './stack.js';

const container = { w: 400, h: 300 };
const size = { w: 100, h: 80 };
const whole = containerTarget(container);
const only = (target: { rect: Rect }) => [
  { id: null, rect: target.rect },
];

describe('cornerOrigin', () => {
  it('insets from the named corner', () => {
    expect(cornerOrigin('top-left', size, whole.rect, 12)).toEqual({ x: 12, y: 12 });
    expect(cornerOrigin('top-right', size, whole.rect, 12)).toEqual({ x: 288, y: 12 });
    expect(cornerOrigin('bottom-left', size, whole.rect, 12)).toEqual({ x: 12, y: 208 });
    expect(cornerOrigin('bottom-right', size, whole.rect, 12)).toEqual({ x: 288, y: 208 });
  });

  it('insets from a pane corner in container coordinates', () => {
    const pane = { x: 200, y: 150, z: 0, w: 200, h: 150 };
    expect(cornerOrigin('top-left', size, pane, 12)).toEqual({ x: 212, y: 162 });
    expect(cornerOrigin('bottom-right', size, pane, 12)).toEqual({ x: 288, y: 208 });
  });
});

describe('snapCorner', () => {
  const eligible = FLOATING_CORNERS;

  it('captures a position resting exactly on the corner origin', () => {
    expect(snapCorner({ x: 12, y: 12 }, size, [whole], 12, 12, eligible)).toEqual({
      corner: 'top-left',
      to: null,
    });
  });

  it('captures the shoved-into-the-corner case that a radius metric rejects', () => {
    // (0,0) is 12 on each axis from the (12,12) origin, but 16.97 away by radius.
    expect(snapCorner({ x: 0, y: 0 }, size, [whole], 12, 12, eligible)?.corner).toBe('top-left');
  });

  it('rejects a position past the threshold on one axis only', () => {
    expect(snapCorner({ x: 12, y: 25 }, size, [whole], 12, 12, eligible)).toBeNull();
  });

  it('never captures a corner outside the eligible set', () => {
    expect(snapCorner({ x: 0, y: 0 }, size, [whole], 12, 12, ['bottom-right'])).toBeNull();
  });

  it('picks the closer corner when two are in range', () => {
    const tiny = { w: 10, h: 10 };
    const narrow = only(containerTarget({ w: 40, h: 300 }));
    // origins are x=12 (left) and x=18 (right); a position at x=17 is nearer the right.
    expect(
      snapCorner({ x: 17, y: 12 }, tiny, narrow, 12, 12, ['top-left', 'top-right'])?.corner,
    ).toBe('top-right');
  });

  it('names the pane it captured, and prefers the nearer of pane and container', () => {
    const pane = { id: 'p1', rect: { x: 200, y: 150, z: 0, w: 200, h: 150 } };
    // The pane's bottom-right origin coincides with the container's, so a hit
    // there is ambiguous — this one sits on the pane's top-left instead.
    expect(snapCorner({ x: 212, y: 162 }, size, [whole, pane], 12, 12, FLOATING_CORNERS)).toEqual({
      corner: 'top-left',
      to: 'p1',
    });
    expect(snapCorner({ x: 12, y: 12 }, size, [whole, pane], 12, 12, FLOATING_CORNERS)).toEqual({
      corner: 'top-left',
      to: null,
    });
  });
});

describe('isFloating', () => {
  it('is true only for an item whose placement bag sets floating', () => {
    expect(isFloating({ id: 'a', meta: { floating: true } })).toBe(true);
    expect(isFloating({ id: 'a', meta: { floating: false } })).toBe(false);
    expect(isFloating({ id: 'a' })).toBe(false);
  });
});

describe('eligibleCorners', () => {
  it('defaults to every corner', () => {
    expect(eligibleCorners({ id: 'a' })).toEqual(FLOATING_CORNERS);
  });

  it('honors a valid subset', () => {
    expect(eligibleCorners({ id: 'a', meta: { snapCorners: ['top-right'] } })).toEqual([
      'top-right',
    ]);
  });

  it('falls back to every corner when the subset names nothing real', () => {
    expect(eligibleCorners({ id: 'a', meta: { snapCorners: ['middle'] } })).toEqual(
      FLOATING_CORNERS,
    );
  });
});

describe('rectOf', () => {
  const item: LayoutItem = { id: 'a', meta: { floating: true }, natural: { w: 100, h: 80 } };

  it('resolves an anchored item against the corner, ignoring stored coordinates', () => {
    const rect = rectOf(item, { x: 999, y: 999, anchor: 'bottom-right' }, container, 12);
    expect(rect).toEqual({ x: 288, y: 208, z: 0, w: 100, h: 80 });
  });

  it('clamps a free item inside the container', () => {
    expect(rectOf(item, { x: -50, y: 999, anchor: null }, container, 12)).toEqual({
      x: 0,
      y: 220, z: 0,
      w: 100,
      h: 80,
    });
  });

  it('falls back to preferredSize when nothing has measured the item yet', () => {
    const unmeasured: LayoutItem = {
      id: 'a',
      meta: { floating: true },
      hints: { preferredSize: { w: 40, h: 20 } },
    };
    expect(rectOf(unmeasured, { x: 0, y: 0, anchor: null }, container, 12).w).toBe(40);
  });
});

const panel: LayoutItem = { id: 'legend', meta: { floating: true }, natural: { w: 100, h: 80 } };
const pane: LayoutItem = { id: 'main' };

describe('floatingStrategy.layout', () => {
  it('places a floating item at its default anchor with no inner strategy', () => {
    const s = floatingStrategy();
    const state = s.initialState([panel], {});
    const r = s.layout({ items: [panel], container, state, options: {} });
    expect(r.placements.get('legend')).toEqual({ x: 12, y: 208, z: 0, w: 100, h: 80 });
  });

  it('honors defaultAnchor when seeding state', () => {
    const s = floatingStrategy();
    const state = s.initialState([panel], { defaultAnchor: 'top-right' });
    const r = s.layout({
      items: [panel],
      container,
      state,
      options: { defaultAnchor: 'top-right' },
    });
    expect(r.placements.get('legend')).toEqual({ x: 288, y: 12, z: 0, w: 100, h: 80 });
  });

  it('gives the inner strategy the full container, unreduced by the panel', () => {
    const s = floatingStrategy(stackStrategy);
    const state = s.initialState([panel, pane], {});
    const r = s.layout({ items: [panel, pane], container, state, options: { activeId: 'main' } });
    expect(r.placements.get('main')).toEqual({ x: 0, y: 0, z: 0, w: 400, h: 300 });
  });

  it('never shows a floating item to the inner strategy', () => {
    const seen: string[][] = [];
    const spy = {
      name: 'spy',
      layout: ({ items }: { items: LayoutItem[] }) => {
        seen.push(items.map((i) => i.id));
        return { placements: new Map(), affordances: [] };
      },
    };
    const s = floatingStrategy(spy);
    s.layout({
      items: [panel, pane],
      container,
      state: s.initialState([panel, pane], {}),
      options: {},
    });
    expect(seen).toEqual([['main']]);
  });

  it('emits one namespaced drag-xy affordance per floating item', () => {
    const s = floatingStrategy();
    const r = s.layout({
      items: [panel],
      container,
      state: s.initialState([panel], {}),
      options: {},
    });
    expect(r.affordances).toHaveLength(1);
    expect(r.affordances[0]).toMatchObject({
      id: 'floating:drag:legend',
      kind: 'drag-xy',
      childId: 'legend',
      cursor: 'grab',
      rect: { x: 12, y: 208, z: 0, w: 100, h: 80 },
    });
  });

  it('confines the handle to a band at the top of the item when handleSize is set', () => {
    const s = floatingStrategy();
    const r = s.layout({
      items: [panel],
      container,
      state: s.initialState([panel], {}),
      options: { handleSize: 20 },
    });
    expect(r.affordances[0]?.rect).toEqual({ x: 12, y: 208, z: 0, w: 100, h: 20 });
  });

  it('withholds an item nothing has sized yet rather than placing it at 0x0', () => {
    const s = floatingStrategy();
    const unsized: LayoutItem = { id: 'ghost', meta: { floating: true } };
    const r = s.layout({
      items: [unsized],
      container,
      state: s.initialState([unsized], {}),
      options: {},
    });
    expect(r.placements.has('ghost')).toBe(false);
    expect(r.unplaced).toEqual(['ghost']);
    expect(r.affordances).toEqual([]);
  });

  it('never writes into the map the inner strategy returned', () => {
    const innerMap = new Map<string, Rect>();
    const spy = { name: 'spy', layout: () => ({ placements: innerMap, affordances: [] }) };
    const s = floatingStrategy(spy);
    const r = s.layout({
      items: [panel],
      container,
      state: s.initialState([panel], {}),
      options: {},
    });
    expect(innerMap.size).toBe(0);
    expect(r.placements.has('legend')).toBe(true);
  });

  it('carries the inner strategy unplaced through', () => {
    const s = floatingStrategy(stackStrategy);
    const items = [panel, pane, { id: 'other' }];
    const r = s.layout({
      items,
      container,
      state: s.initialState(items, {}),
      options: { activeId: 'main' },
    });
    expect(r.unplaced).toEqual(['other']);
  });

  it('places a floating item that state has never seen, at the default anchor', () => {
    const s = floatingStrategy();
    const r = s.layout({
      items: [panel],
      container,
      state: { at: {}, inner: undefined },
      options: {},
    });
    expect(r.placements.get('legend')).toEqual({ x: 12, y: 208, z: 0, w: 100, h: 80 });
  });

  it('declares every config key it reads', () => {
    expect(Object.keys(floatingStrategy().configSpec ?? {}).sort()).toEqual([
      'defaultAnchor',
      'handleSize',
      'inset',
      'snapThreshold',
      'snapToPanes',
    ]);
  });

  it('unions the inner strategy config keys into its own', () => {
    const keys = Object.keys(floatingStrategy(stackStrategy).configSpec ?? {});
    expect(keys).toContain('activeId');
    expect(keys).toContain('inset');
  });

  it('names itself after the strategy it wraps', () => {
    expect(floatingStrategy(stackStrategy).name).toBe('floating(stack)');
    expect(floatingStrategy().name).toBe('floating');
  });
});

describe('floatingStrategy delegation', () => {
  const inner = {
    name: 'picky',
    layout: () => ({ placements: new Map(), affordances: [] }),
    canAccept: (items: LayoutItem[]) => items.length < 3,
    navigate: () => 'from-inner' as const,
  };

  it('asks the inner strategy about a drop, without counting floating items', () => {
    const s = floatingStrategy(inner);
    // Two items, one of them floating: the inner strategy sees one, so it accepts.
    expect(s.canAccept?.([panel, pane], {})).toBe(true);
    expect(s.canAccept?.([pane, { id: 'third' }], {})).toBe(true);
    expect(s.canAccept?.([pane, { id: 'third' }, { id: 'fourth' }], {})).toBe(false);
  });

  it('accepts everything when nothing is wrapped', () => {
    expect(floatingStrategy().canAccept?.([panel, pane], {})).toBe(true);
  });

  it('lets the inner strategy answer navigation', () => {
    const s = floatingStrategy(inner);
    expect(s.navigate?.({ items: [pane], from: 'main', direction: 'left', options: {} })).toBe(
      'from-inner',
    );
  });
});
