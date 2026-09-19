import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost } from '../container-host.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { Affordance, LayoutItem, LayoutStrategy, Size } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { desktopStrategy } from './desktop.js';
import { shelfStrategy } from './shelf.js';

const Z = asNodeId('z');
const CONTAINER = { w: 400, h: 300 };

interface Win {
  id: string;
  placement?: Record<string, unknown>;
  w?: number;
  h?: number;
  minSize?: Size;
  maxSize?: Size;
}

function desktop(config: Record<string, unknown>, wins: Win[]): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'zone', id: Z, container: { strategyId: 'desktop', config } }));
  for (const { id, placement = {}, w = 100, h = 80, minSize, maxSize } of wins) {
    const nid = asNodeId(id);
    const hints: Record<string, Size> = { preferredSize: { w, h } };
    if (minSize) hints.minSize = minSize;
    if (maxSize) hints.maxSize = maxSize;
    s.registerNode(createNode({ kind: 'window', id: nid, parentId: Z, placement, hints }));
    s.showNode(nid);
  }
  return s;
}

type Inner = LayoutStrategy<unknown, string, unknown>;

function harness(inner?: Inner) {
  const strategy = desktopStrategy(inner);
  const itemsOf = (s: Store): LayoutItem[] => s.getChildren(Z).map((n) => nodeToLayoutItem(n));
  const optionsOf = (s: Store) =>
    (s.getNode(Z)?.container?.config ?? {}) as Record<string, unknown>;
  const layoutOf = (s: Store, container: Size = CONTAINER) => {
    const items = itemsOf(s);
    const options = optionsOf(s);
    return strategy.layout({
      items,
      container,
      state: strategy.initialState(items, options),
      options,
    });
  };
  const affordance = (s: Store, id: string): Affordance => {
    const aff = layoutOf(s).affordances.find((a) => a.id === id);
    if (!aff) throw new Error(`no affordance ${id}`);
    return aff;
  };
  const drag = (s: Store, id: string, dx: number, dy: number) =>
    strategy.dispatchAffordance?.({
      event: { affordanceId: id, kind: 'drag', payload: { dx, dy } },
      affordance: affordance(s, id),
      store: s,
      parentId: Z,
      container: CONTAINER,
      options: optionsOf(s),
      items: itemsOf(s),
    });
  return { strategy, layoutOf, affordance, drag };
}

const placementOf = (s: Store, id: string) => s.getNode(asNodeId(id))?.membership?.placement ?? {};

describe('desktop resize', () => {
  const { strategy, layoutOf, affordance, drag } = harness();
  const ids = (s: Store) => layoutOf(s).affordances.map((a) => a.id);

  it('emits nothing to resize unless asked', () => {
    const s = desktop({}, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    expect(ids(s)).toEqual([]);
  });

  it('puts an affordance on each edge and corner of a window', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    const kinds = Object.fromEntries(layoutOf(s).affordances.map((a) => [a.id, a.kind]));
    expect(kinds).toEqual({
      'desktop:resize:n:a': 'resize-y',
      'desktop:resize:s:a': 'resize-y',
      'desktop:resize:w:a': 'resize-x',
      'desktop:resize:e:a': 'resize-x',
      'desktop:resize:nw:a': 'resize-xy',
      'desktop:resize:ne:a': 'resize-xy',
      'desktop:resize:sw:a': 'resize-xy',
      'desktop:resize:se:a': 'resize-xy',
    });
  });

  it('lays the edges 6px thick inside the window, with 12px corners between them', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    expect(affordance(s, 'desktop:resize:e:a').rect).toEqual({ x: 104, y: 32, z: 1, w: 6, h: 56 });
    expect(affordance(s, 'desktop:resize:n:a').rect).toEqual({ x: 22, y: 20, z: 1, w: 76, h: 6 });
    expect(affordance(s, 'desktop:resize:se:a').rect).toEqual({
      x: 98,
      y: 88,
      z: 1,
      w: 12,
      h: 12,
    });
  });

  it('honors edgeSize', () => {
    const s = desktop({ resize: true, edgeSize: 4 }, [{ id: 'a', placement: { x: 0, y: 0 } }]);
    expect(affordance(s, 'desktop:resize:s:a').rect).toEqual({ x: 8, y: 76, z: 1, w: 84, h: 4 });
    expect(affordance(s, 'desktop:resize:nw:a').rect).toMatchObject({ w: 8, h: 8 });
  });

  it('names the child it resizes, and a cursor for each direction', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 0, y: 0 } }]);
    expect(affordance(s, 'desktop:resize:ne:a')).toMatchObject({
      childId: 'a',
      affects: ['a'],
      cursor: 'nesw-resize',
      label: 'resize',
    });
    expect(affordance(s, 'desktop:resize:w:a').cursor).toBe('ew-resize');
    expect(affordance(s, 'desktop:resize:s:a').cursor).toBe('ns-resize');
    expect(affordance(s, 'desktop:resize:se:a').cursor).toBe('nwse-resize');
  });

  it("lets a window's placement override the container's resize", () => {
    const s = desktop({ resize: true }, [
      { id: 'a', placement: { resize: false } },
      { id: 'b', placement: { x: 0, y: 0 } },
    ]);
    expect(ids(s).some((id) => id.endsWith(':a'))).toBe(false);
    const t = desktop({}, [{ id: 'c', placement: { resize: true } }]);
    expect(ids(t)).toHaveLength(8);
  });

  it('gives a shaded window nothing to resize', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { minimized: true } }]);
    expect(ids(s)).toEqual([]);
  });

  it('draws the edges above the title band, and the minimize box above both', () => {
    const s = desktop({ resize: true, drag: true, minimizable: true }, [
      { id: 'a', placement: { x: 0, y: 0 } },
    ]);
    const order = ids(s);
    expect(order.indexOf('desktop:drag:a')).toBeLessThan(order.indexOf('desktop:resize:n:a'));
    expect(order.indexOf('desktop:resize:se:a')).toBeLessThan(order.indexOf('desktop:minimize:a'));
  });

  it('reports each edge as its position, with the range the drag can reach', () => {
    const s = desktop({ resize: true }, [
      {
        id: 'a',
        placement: { x: 100, y: 50 },
        minSize: { w: 40, h: 30 },
        maxSize: { w: 150, h: 500 },
      },
    ]);
    expect(affordance(s, 'desktop:resize:e:a').bounds).toEqual({
      orientation: 'horizontal',
      valueNow: 200,
      valueMin: 140,
      valueMax: 250,
      atMin: false,
      atMax: false,
    });
    // The top edge can rise to the container's top, and fall to the floor.
    expect(affordance(s, 'desktop:resize:n:a').bounds).toEqual({
      orientation: 'vertical',
      valueNow: 50,
      valueMin: 0,
      valueMax: 100,
      atMin: false,
      atMax: false,
    });
    expect(affordance(s, 'desktop:resize:se:a').bounds).toBeUndefined();
  });

  it('flags an edge that sits at the end of its range', () => {
    const s = desktop({ resize: true }, [
      { id: 'a', placement: { x: 0, y: 0 }, minSize: { w: 100, h: 10 } },
    ]);
    expect(affordance(s, 'desktop:resize:w:a').bounds).toMatchObject({ atMin: true, atMax: true });
    expect(affordance(s, 'desktop:resize:e:a').bounds).toMatchObject({ atMin: true, atMax: false });
  });

  it('writes placement.size from the right edge, keeping the other axis', () => {
    const s = desktop({ resize: true }, [
      { id: 'a', placement: { x: 10, y: 20, size: { h: 90 } } },
    ]);
    drag(s, 'desktop:resize:e:a', 30, 99);
    expect(placementOf(s, 'a')).toEqual({ x: 10, y: 20, size: { w: 130, h: 90 } });
    expect(layoutOf(s).placements.get('a')).toEqual({ x: 10, y: 20, z: 1, w: 130, h: 90 });
  });

  it('moves x with the left edge so the right edge stays put', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 50, y: 20 } }]);
    drag(s, 'desktop:resize:w:a', -20, 0);
    expect(placementOf(s, 'a')).toMatchObject({ x: 30, y: 20, size: { w: 120 } });
  });

  it('resizes both axes from a corner, moving y from a top corner', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 50, y: 60 } }]);
    drag(s, 'desktop:resize:ne:a', 10, -15);
    expect(layoutOf(s).placements.get('a')).toEqual({ x: 50, y: 45, z: 1, w: 110, h: 95 });
    drag(s, 'desktop:resize:se:a', -5, 5);
    expect(layoutOf(s).placements.get('a')).toEqual({ x: 50, y: 45, z: 1, w: 105, h: 100 });
  });

  it('writes the position a cascaded window shows at when its left edge moves', () => {
    const s = desktop({ resize: true, cascade: 30 }, [{ id: 'a' }, { id: 'b' }]);
    drag(s, 'desktop:resize:w:b', 10, 0);
    expect(placementOf(s, 'b')).toMatchObject({ x: 40, y: 30, size: { w: 90 } });
  });

  it('stops at hints.minSize and hints.maxSize', () => {
    const s = desktop({ resize: true }, [
      {
        id: 'a',
        placement: { x: 100, y: 100 },
        minSize: { w: 60, h: 50 },
        maxSize: { w: 120, h: 100 },
      },
    ]);
    drag(s, 'desktop:resize:se:a', 500, -500);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ w: 120, h: 50 });
    drag(s, 'desktop:resize:w:a', 500, 0);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: 160, w: 60 });
  });

  it('keeps a window twice the edge size across with no minSize', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 0, y: 0 } }]);
    drag(s, 'desktop:resize:se:a', -500, -500);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ w: 12, h: 12 });
  });

  it("stops a growing edge at the container's edge", () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 350, y: 10 } }]);
    drag(s, 'desktop:resize:e:a', 80, 0);
    // Already past the edge: it may not grow further, and is not pulled back.
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: 350, w: 100 });
    const t = desktop({ resize: true }, [{ id: 'b', placement: { x: 30, y: 10 } }]);
    drag(t, 'desktop:resize:w:b', -80, 0);
    expect(layoutOf(t).placements.get('b')).toMatchObject({ x: 0, w: 130 });
  });

  it('refuses to resize a window whose lock forbids resizing', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    s.setLock(asNodeId('a'), { resize: true });
    drag(s, 'desktop:resize:se:a', 30, 30);
    expect(placementOf(s, 'a')).toEqual({ x: 10, y: 20 });
  });

  it('moves no edge that would move a window whose lock forbids moving', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    s.setLock(asNodeId('a'), { move: true });
    drag(s, 'desktop:resize:ne:a', 30, -10);
    expect(layoutOf(s).placements.get('a')).toEqual({ x: 10, y: 20, z: 1, w: 130, h: 80 });
  });

  it('resizes through a ContainerHost with no DOM', () => {
    const s = desktop({ resize: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    const host = new ContainerHost(s, Z, new Map([['desktop', strategy as never]]));
    host.setViewport(CONTAINER);
    host.dispatchAffordance({
      affordanceId: 'desktop:resize:se:a',
      kind: 'drag',
      payload: { dx: 3, dy: 4 },
    });
    expect(host.layout().placements.get(asNodeId('a'))).toMatchObject({ w: 103, h: 84 });
    host.destroy();
  });

  it('declares resize and edgeSize in its config spec', () => {
    expect(strategy.configSpec).toMatchObject({ resize: 'boolean', edgeSize: 'number' });
  });
});

describe('desktop layer', () => {
  const { layoutOf, affordance } = harness();
  const zs = (s: Store, ids: string[]) => ids.map((id) => layoutOf(s).placements.get(id)?.z);

  it('draws a window on the top layer above every window without it', () => {
    const s = desktop({}, [
      { id: 'dock', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 'a', placement: { x: 10, y: 10 } },
      { id: 'b', placement: { x: 20, y: 20 } },
    ]);
    expect(zs(s, ['a', 'b', 'dock'])).toEqual([1, 2, 3]);
  });

  it('keeps child order within each layer', () => {
    const s = desktop({}, [
      { id: 't1', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 'a', placement: { x: 0, y: 0 } },
      { id: 't2', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 'b', placement: { x: 0, y: 0 } },
    ]);
    expect(zs(s, ['a', 'b', 't1', 't2'])).toEqual([1, 2, 3, 4]);
  });

  it('keeps a raised window under the top layer', () => {
    const s = desktop({}, [
      { id: 'a', placement: { x: 0, y: 0 } },
      { id: 'dock', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 'b', placement: { x: 0, y: 0 } },
    ]);
    s.raise(asNodeId('a'));
    expect(zs(s, ['b', 'a', 'dock'])).toEqual([1, 2, 3]);
  });

  it('raises a top-layer window among its own layer', () => {
    const s = desktop({}, [
      { id: 't1', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 't2', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 'a', placement: { x: 0, y: 0 } },
    ]);
    s.raise(asNodeId('t1'));
    expect(zs(s, ['a', 't2', 't1'])).toEqual([1, 2, 3]);
  });

  it("stacks a window's affordances at its layered z", () => {
    const s = desktop({ drag: true, resize: true }, [
      { id: 'dock', placement: { x: 0, y: 0, layer: 'top' } },
      { id: 'a', placement: { x: 0, y: 0 } },
    ]);
    expect(affordance(s, 'desktop:drag:dock').rect.z).toBe(2);
    expect(affordance(s, 'desktop:resize:se:dock').rect.z).toBe(2);
    expect(affordance(s, 'desktop:drag:a').rect.z).toBe(1);
  });

  it('treats any other layer value as the normal layer', () => {
    const s = desktop({}, [
      { id: 'a', placement: { x: 0, y: 0, layer: 'bottom' } },
      { id: 'b', placement: { x: 0, y: 0 } },
    ]);
    expect(zs(s, ['a', 'b'])).toEqual([1, 2]);
  });

  it('keeps the cascade in child order, whatever the layer', () => {
    const s = desktop({ cascade: 30 }, [{ id: 'dock', placement: { layer: 'top' } }, { id: 'a' }]);
    expect(layoutOf(s).placements.get('dock')).toMatchObject({ x: 0, y: 0, z: 2 });
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: 30, y: 30, z: 1 });
  });
});

describe('desktop iconFrom', () => {
  const icon = (id: string): LayoutItem => ({
    id,
    meta: { icon: true },
    hints: { preferredSize: { w: 64, h: 64 } },
  });
  const icons = (n: number) => Array.from({ length: n }, (_, i) => icon(`i${i + 1}`));
  function run(
    items: LayoutItem[],
    options: Record<string, unknown>,
    inner: Inner = shelfStrategy as Inner,
    container: Size = CONTAINER,
  ) {
    const s = desktopStrategy(inner);
    return s.layout({ items, container, state: s.initialState(items, options), options });
  }
  const at = (r: ReturnType<typeof run>, id: string) => {
    const p = r.placements.get(id);
    return p && { x: p.x, y: p.y };
  };

  it('lines icons up from the top-left by default', () => {
    const r = run(icons(2), {});
    expect([at(r, 'i1'), at(r, 'i2')]).toEqual([
      { x: 0, y: 0 },
      { x: 64, y: 0 },
    ]);
  });

  it('fills from the bottom-left with rows going up, as Windows 3.1 does', () => {
    const r = run(icons(7), { iconFrom: 'bottom-left' });
    expect(at(r, 'i1')).toEqual({ x: 0, y: 236 });
    expect(at(r, 'i6')).toEqual({ x: 320, y: 236 });
    expect(at(r, 'i7')).toEqual({ x: 0, y: 172 });
  });

  it('runs right to left from the top-right', () => {
    const r = run(icons(2), { iconFrom: 'top-right' });
    expect([at(r, 'i1'), at(r, 'i2')]).toEqual([
      { x: 336, y: 0 },
      { x: 272, y: 0 },
    ]);
  });

  it('starts in the bottom-right corner', () => {
    expect(at(run(icons(1), { iconFrom: 'bottom-right' }), 'i1')).toEqual({ x: 336, y: 236 });
  });

  it('reports rows past the top as overflow above, not below', () => {
    const r = run(icons(7), { iconFrom: 'bottom-left' }, undefined, { w: 400, h: 100 });
    expect(at(r, 'i7')).toEqual({ x: 0, y: -28 });
    expect(r.overflow).toEqual({ w: 0, h: 0, top: 28 });
  });

  it('leaves windows where they are', () => {
    const win: LayoutItem = {
      id: 'w',
      meta: { x: 10, y: 20 },
      hints: { preferredSize: { w: 50, h: 40 } },
    };
    const r = run([win, icon('i1')], { iconFrom: 'bottom-right' });
    expect(r.placements.get('w')).toEqual({ x: 10, y: 20, z: 1, w: 50, h: 40 });
  });

  it('puts the restore toggle over an iconified window where it now shows', () => {
    const win: LayoutItem = {
      id: 'w',
      meta: { minimized: true },
      hints: { preferredSize: { w: 50, h: 40 } },
    };
    const r = run([win], { iconFrom: 'bottom-left', minimize: 'icon', minimizable: true });
    const toggle = r.affordances.find((a) => a.id === 'desktop:minimize:w');
    expect(toggle?.rect).toMatchObject({ x: 0, y: 236, w: 64, h: 64 });
  });

  describe('with an inner strategy that emits and hears gestures', () => {
    const seen: Record<string, unknown>[] = [];
    const spy: Inner = {
      name: 'spy',
      layout: ({ items, preview }) => {
        if (preview) seen.push({ cursor: preview.cursor });
        return {
          placements: new Map(items.map((i) => [i.id, { x: 0, y: 0, z: 0, w: 10, h: 10 }])),
          affordances: [
            { id: 'spy:seam', kind: 'drag-xy', rect: { x: 0, y: 0, z: 0, w: 10, h: 20 } },
          ],
        };
      },
      reduce: (state, event) => {
        seen.push({ reduce: event.payload });
        return state;
      },
      dispatchAffordance: ({ event, affordance }) => {
        seen.push({ dispatch: event.payload, rect: affordance.rect });
      },
      navigate: ({ direction }) => {
        seen.push({ direction });
        return undefined;
      },
    };
    const options = { iconFrom: 'bottom-right' };
    const s = desktopStrategy(spy);
    const items = [icon('i1')];

    it('mirrors the inner affordances onto the icons', () => {
      const r = s.layout({
        items,
        container: CONTAINER,
        state: s.initialState(items, options),
        options,
      });
      expect(r.affordances[0]?.rect).toEqual({ x: 390, y: 280, z: 0, w: 10, h: 20 });
    });

    it('hands the inner strategy its own frame: the rect, the deltas and the point', () => {
      seen.length = 0;
      const event = {
        affordanceId: 'spy:seam',
        kind: 'drag' as const,
        payload: { dx: 5, dy: -3, point: { x: 395, y: 290 } },
      };
      const store = desktop(options, []);
      s.dispatchAffordance?.({
        event,
        affordance: {
          id: 'spy:seam',
          kind: 'drag-xy',
          rect: { x: 390, y: 280, z: 0, w: 10, h: 20 },
        },
        store,
        parentId: Z,
        container: CONTAINER,
        options,
        items,
      });
      s.reduce?.(s.initialState(items, options), event, { container: CONTAINER, options, items });
      const flipped = { dx: -5, dy: 3, point: { x: 5, y: 10 } };
      expect(seen).toEqual([
        { dispatch: flipped, rect: { x: 0, y: 0, z: 0, w: 10, h: 20 } },
        { reduce: flipped },
      ]);
    });

    it('mirrors a preview cursor and a navigation direction', () => {
      seen.length = 0;
      s.layout({
        items,
        container: CONTAINER,
        state: s.initialState(items, options),
        options,
        preview: { insertId: 'i1', cursor: { x: 390, y: 10 } },
      });
      s.navigate?.({ items, from: 'i1', direction: 'left', options });
      s.navigate?.({ items, from: 'i1', direction: 'up', options });
      expect(seen).toEqual([
        { cursor: { x: 10, y: 290 } },
        { direction: 'right' },
        { direction: 'down' },
      ]);
    });
  });

  it('declares iconFrom in its config spec', () => {
    expect(desktopStrategy().configSpec).toMatchObject({
      iconFrom: ['top-left', 'bottom-left', 'top-right', 'bottom-right'],
    });
  });
});
