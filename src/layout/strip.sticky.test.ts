import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost } from '../container-host.js';
import { asNodeId, Store } from '../index.js';
import type { LayoutItem } from '../layout-types.js';
import { stuckRect } from './sticky.js';
import { stripStrategy } from './strip.js';

const tab = (id: string, w: number, sticky = false): LayoutItem => ({
  id,
  placement: { size: { w } },
  ...(sticky ? { meta: { size: { w }, sticky: true } } : {}),
});

const row = [tab('p1', 40, true), tab('p2', 40, true), tab('a', 200), tab('b', 200), tab('c', 200)];
const SCROLL = { overflowMode: 'scroll', gap: 4, padding: 6 };

const run = (options: Record<string, unknown>, items = row) =>
  stripStrategy.layout({ items, container: { w: 300, h: 30 }, state: undefined, options });

describe('strip placement.sticky', () => {
  it('reports where each sticky pane sticks, stacked in order from the leading edge', () => {
    expect(run(SCROLL).sticky).toEqual(
      new Map([
        ['p1', { x: 6 }],
        ['p2', { x: 50 }],
      ]),
    );
  });

  it('sticks a pane further down the row after the ones before it', () => {
    const items = [tab('a', 200), tab('p', 40, true), tab('b', 200)];
    expect(run(SCROLL, items).sticky).toEqual(new Map([['p', { x: 6 }]]));
  });

  it('reports nothing unless the row scrolls', () => {
    expect(run({ gap: 4, padding: 6 }).sticky).toBeUndefined();
    expect(run({ ...SCROLL, overflowMode: 'squeeze' }).sticky).toBeUndefined();
  });

  it('reports nothing when no pane is sticky', () => {
    expect(run(SCROLL, [tab('a', 200), tab('b', 200)]).sticky).toBeUndefined();
  });

  it('sticks on the y axis of a vertical strip', () => {
    const items = [
      { id: 'h', placement: { size: { h: 20 } }, meta: { sticky: true } },
      { id: 'a', placement: { size: { h: 200 } } },
    ];
    expect(run({ ...SCROLL, axis: 'y' }, items).sticky).toEqual(new Map([['h', { y: 6 }]]));
  });

  it('draws a sticky pane and its seam above the panes that scroll under it', () => {
    const r = run(SCROLL);
    expect(r.placements.get('p1')?.z).toBe(2);
    expect(r.placements.get('a')?.z).toBe(0);
    const seam = r.affordances.find((a) => a.childId === 'p2');
    expect(seam?.rect.z).toBe(2);
    expect(r.affordances.find((a) => a.childId === 'a')?.rect.z).toBe(0);
  });

  it("gives a sticky pane's seam the pane's inset, at its trailing edge", () => {
    const seam = run(SCROLL).affordances.find((a) => a.childId === 'p2');
    expect(seam?.sticky).toEqual({ x: 50 + 40 - 2 });
  });
});

describe('stuckRect', () => {
  const rect = { x: 50, y: 0, z: 2, w: 40, h: 30 };

  it('leaves a pane in place until the scroll reaches it', () => {
    expect(stuckRect(rect, { x: 50 }, { x: 0, y: 0 })).toEqual(rect);
  });

  it('holds it at its inset from the visible edge once scrolled past', () => {
    expect(stuckRect(rect, { x: 50 }, { x: 120, y: 0 })).toEqual({ ...rect, x: 170 });
  });

  it('ignores the other axis', () => {
    expect(stuckRect(rect, { x: 50 }, { x: 0, y: 500 })).toEqual(rect);
  });

  it('returns the rect untouched with no inset', () => {
    expect(stuckRect(rect, undefined, { x: 120, y: 0 })).toBe(rect);
  });
});

describe('ContainerHost carries sticky insets', () => {
  it('publishes them beside the unscrolled placements, and keeps them across a scroll', () => {
    const Z = asNodeId('z');
    const store = new Store();
    store.registerNode(createNode({ id: Z, container: { strategyId: 'strip', config: SCROLL } }));
    for (const it of row) {
      const id = asNodeId(it.id);
      store.registerNode(
        createNode({
          id,
          parentId: Z,
          placement: {
            size: { w: it.placement?.size?.w ?? 0 },
            ...(it.meta ? { sticky: true } : {}),
          },
        }),
      );
      store.showNode(id);
    }
    const host = new ContainerHost(store, Z, new Map([['strip', stripStrategy as never]]));
    host.setViewport({ w: 300, h: 30 });
    expect(host.layout().sticky?.get(asNodeId('p2'))).toEqual({ x: 50 });
    host.setScroll({ x: 100, y: 0 });
    expect(host.layout().sticky?.get(asNodeId('p2'))).toEqual({ x: 50 });
    expect(host.layout().placements.get(asNodeId('p2'))?.x).toBe(50);
  });
});
