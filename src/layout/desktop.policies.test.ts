import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost } from '../container-host.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { Affordance, LayoutEvent, LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { captureTrace } from '../test-utils/capture-trace.js';
import { desktopStrategy } from './desktop.js';

const Z = asNodeId('z');
const CONTAINER = { w: 400, h: 300 };

interface Win {
  id: string;
  placement?: Record<string, unknown>;
  w?: number;
  h?: number;
}

function desktop(config: Record<string, unknown>, wins: Win[]): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'zone', id: Z, container: { strategyId: 'desktop', config } }));
  for (const { id, placement = {}, w = 100, h = 80 } of wins) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'window',
        id: nid,
        parentId: Z,
        placement,
        hints: { preferredSize: { w, h } },
      }),
    );
    s.showNode(nid);
  }
  return s;
}

const strategy = desktopStrategy();

function itemsOf(s: Store): LayoutItem[] {
  return s.getChildren(Z).map((n) => nodeToLayoutItem(n));
}

function layoutOf(s: Store) {
  const options = (s.getNode(Z)?.container?.config ?? {}) as Record<string, unknown>;
  const items = itemsOf(s);
  return strategy.layout({
    items,
    container: CONTAINER,
    state: strategy.initialState(items, options),
    options,
  });
}

function affordance(s: Store, id: string): Affordance {
  const aff = layoutOf(s).affordances.find((a) => a.id === id);
  if (!aff) throw new Error(`no affordance ${id}`);
  return aff;
}

function dispatch(s: Store, affordanceId: string, event: Omit<LayoutEvent, 'affordanceId'>) {
  strategy.dispatchAffordance?.({
    event: { affordanceId, ...event },
    affordance: affordance(s, affordanceId),
    store: s,
    parentId: Z,
    container: CONTAINER,
    options: (s.getNode(Z)?.container?.config ?? {}) as Record<string, unknown>,
    items: itemsOf(s),
  });
}

const drag = (s: Store, id: string, dx: number, dy: number) =>
  dispatch(s, `desktop:drag:${id}`, { kind: 'drag', payload: { dx, dy } });

const placementOf = (s: Store, id: string) => s.getNode(asNodeId(id))?.membership?.placement ?? {};

describe('desktop drag', () => {
  it('emits nothing to drag unless asked', () => {
    const s = desktop({}, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    expect(layoutOf(s).affordances).toEqual([]);
  });

  it('puts a drag-xy band over each window title, 22 tall by default', () => {
    const s = desktop({ drag: true }, [
      { id: 'a', placement: { x: 10, y: 20 } },
      { id: 'b', placement: { x: 50, y: 60 } },
    ]);
    const a = affordance(s, 'desktop:drag:a');
    expect(a).toMatchObject({
      kind: 'drag-xy',
      rect: { x: 10, y: 20, z: 1, w: 100, h: 22 },
      childId: 'a',
    });
    expect(affordance(s, 'desktop:drag:b').rect.z).toBe(2);
  });

  it('honors handleSize, and never makes the band taller than the window', () => {
    const s = desktop({ drag: true, handleSize: 30, minimize: 'shade', shadeHeight: 12 }, [
      { id: 'a', placement: { x: 0, y: 0 } },
      { id: 'b', placement: { x: 0, y: 0, minimized: true } },
    ]);
    expect(affordance(s, 'desktop:drag:a').rect.h).toBe(30);
    expect(affordance(s, 'desktop:drag:b').rect.h).toBe(12);
  });

  it('emits drag-x or drag-y for an axis-bound drag', () => {
    expect(affordance(desktop({ drag: 'y' }, [{ id: 'a' }]), 'desktop:drag:a').kind).toBe('drag-y');
    expect(affordance(desktop({ drag: 'x' }, [{ id: 'a' }]), 'desktop:drag:a').kind).toBe('drag-x');
  });

  it("lets a window's placement override the container's drag", () => {
    const s = desktop({ drag: true }, [
      { id: 'a', placement: { drag: false } },
      { id: 'b', placement: { drag: 'y' } },
    ]);
    const ids = layoutOf(s).affordances.map((a) => [a.id, a.kind]);
    expect(ids).toEqual([['desktop:drag:b', 'drag-y']]);
    const t = desktop({}, [{ id: 'c', placement: { drag: true } }]);
    expect(affordance(t, 'desktop:drag:c').kind).toBe('drag-xy');
  });

  it('writes the moved position into the placement', () => {
    const s = desktop({ drag: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    drag(s, 'a', 5, -7);
    drag(s, 'a', 5, 0);
    expect(placementOf(s, 'a')).toMatchObject({ x: 20, y: 13 });
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: 20, y: 13 });
  });

  it('moves a cascaded window from where it shows, writing both axes', () => {
    const s = desktop({ drag: 'x', cascade: 30 }, [{ id: 'a' }, { id: 'b' }]);
    drag(s, 'b', 12, 40);
    expect(placementOf(s, 'b')).toMatchObject({ x: 42, y: 30 });
  });

  it("moves only vertically under drag: 'y'", () => {
    const s = desktop({ drag: 'y' }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    drag(s, 'a', 50, 40);
    expect(placementOf(s, 'a')).toMatchObject({ x: 10, y: 60 });
  });

  it('refuses to move a window whose lock forbids moving', () => {
    const s = desktop({ drag: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    s.setLock(asNodeId('a'), { move: true });
    drag(s, 'a', 50, 40);
    expect(placementOf(s, 'a')).toMatchObject({ x: 10, y: 20 });
  });

  it('drags through a ContainerHost with no DOM', () => {
    const s = desktop({ drag: true }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    const host = new ContainerHost(s, Z, new Map([['desktop', strategy as never]]));
    host.setViewport(CONTAINER);
    host.dispatchAffordance({
      affordanceId: 'desktop:drag:a',
      kind: 'drag',
      payload: { dx: 3, dy: 4 },
    });
    expect(host.layout().placements.get(asNodeId('a'))).toMatchObject({ x: 13, y: 24 });
    host.destroy();
  });

  it("hands the inner strategy's affordances to its own dispatch, over the icon layer", () => {
    const seen: string[][] = [];
    const inner = {
      name: 'spy',
      layout: () => ({ placements: new Map(), affordances: [] }),
      dispatchAffordance: ({ items }: { items: LayoutItem[] }) => {
        seen.push(items.map((i) => i.id));
      },
    };
    const s = desktop({}, [{ id: 'a' }, { id: 'i', placement: { icon: true } }]);
    desktopStrategy(inner).dispatchAffordance?.({
      event: { affordanceId: 'spy:seam', kind: 'drag', payload: { dx: 1 } },
      affordance: { id: 'spy:seam', kind: 'resize-x', rect: { x: 0, y: 0, z: 0, w: 1, h: 1 } },
      store: s,
      parentId: Z,
      container: CONTAINER,
      options: {},
      items: itemsOf(s),
    });
    expect(seen).toEqual([['i']]);
  });

  it('declares drag and handleSize in its config spec', () => {
    expect(strategy.configSpec).toMatchObject({
      drag: [true, false, 'x', 'y'],
      handleSize: 'number',
    });
  });
});

describe('desktop clamp', () => {
  it('does not clamp by default', () => {
    const s = desktop({}, [{ id: 'a', placement: { x: -1800, y: 500 } }]);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: -1800, y: 500 });
  });

  it("clamp: 'all' pulls a restored window back inside where it fits", () => {
    const s = desktop({ clamp: 'all' }, [{ id: 'a', placement: { x: -1800, y: 500 } }]);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: 0, y: 220 });
  });

  it("clamp: 'all' pins an oversized window to the top-left edge on that axis", () => {
    const s = desktop({ clamp: 'all' }, [{ id: 'a', placement: { x: 50, y: 50 }, w: 600 }]);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ x: 0, y: 50 });
  });

  it("clamp: 'bar' keeps the title band inside, and lets the body hang below", () => {
    const s = desktop({ clamp: 'bar' }, [
      { id: 'a', placement: { x: 390, y: 290 } },
      { id: 'b', placement: { x: -40, y: -10 } },
    ]);
    const r = layoutOf(s);
    expect(r.placements.get('a')).toMatchObject({ x: 300, y: 278 });
    expect(r.placements.get('b')).toMatchObject({ x: 0, y: 0 });
  });

  it("clamp: 'bar' measures the band with handleSize", () => {
    const s = desktop({ clamp: 'bar', handleSize: 40 }, [{ id: 'a', placement: { x: 0, y: 290 } }]);
    expect(layoutOf(s).placements.get('a')).toMatchObject({ y: 260 });
  });

  it('clamps a drag, writing the clamped position', () => {
    const s = desktop({ drag: true, clamp: 'all' }, [{ id: 'a', placement: { x: 10, y: 20 } }]);
    drag(s, 'a', -50, 1000);
    expect(placementOf(s, 'a')).toMatchObject({ x: 0, y: 220 });
    drag(s, 'a', 30, -10);
    expect(placementOf(s, 'a')).toMatchObject({ x: 30, y: 210 });
  });

  it('traces a window the clamp moved, and not one it left alone', () => {
    const traces = captureTrace('layout');
    layoutOf(
      desktop({ clamp: 'all' }, [
        { id: 'a', placement: { x: -5, y: 0 } },
        { id: 'b', placement: { x: 5, y: 5 } },
      ]),
    );
    expect(traces.matching(/desktop: a clamped/)).toHaveLength(1);
    expect(traces.matching(/desktop: b clamped/)).toHaveLength(0);
  });

  it('declares clamp in its config spec', () => {
    expect(strategy.configSpec).toMatchObject({ clamp: ['bar', 'all'] });
  });
});

describe('desktop overflow', () => {
  it('counts a window past the left and top edges under the default scroll', () => {
    const s = desktop({}, [{ id: 'a', placement: { x: -1800, y: -30 } }]);
    expect(layoutOf(s).overflow).toEqual({ w: 0, h: 0, left: 1800, top: 30 });
  });

  it('reports the far side of each axis alongside the near one', () => {
    const s = desktop({ overflow: 'scroll' }, [
      { id: 'a', placement: { x: -50, y: 10 } },
      { id: 'b', placement: { x: 350, y: 250 } },
    ]);
    expect(layoutOf(s).overflow).toEqual({ w: 50, h: 30, left: 50 });
  });

  it("reports no overflow at all under overflow: 'clip'", () => {
    const s = desktop({ overflow: 'clip' }, [
      { id: 'a', placement: { x: -50, y: -10 } },
      { id: 'b', placement: { x: 350, y: 250 } },
    ]);
    expect(layoutOf(s).overflow).toBeUndefined();
  });

  it('has nothing past the left edge once a clamp pulls the window back', () => {
    const s = desktop({ clamp: 'all' }, [{ id: 'a', placement: { x: -1800, y: 0 } }]);
    expect(layoutOf(s).overflow).toBeUndefined();
  });

  it('declares overflow in its config spec', () => {
    expect(strategy.configSpec).toMatchObject({ overflow: ['clip', 'scroll'] });
  });
});
