import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { stripStrategy } from './layout/strip.js';
import type { LayoutPreview, StrategyRegistry } from './layout-types.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const Z = asNodeId('z');
const A = asNodeId('a');
const B = asNodeId('b');

function build(strategyId = 'strip'): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId, config: { axis: 'x', fill: true } },
      id: Z,
    }),
  );
  for (const id of [A, B]) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId: Z }));
    s.showNode(id);
  }
  return s;
}

function host(store: Store, registry?: StrategyRegistry): ContainerHost {
  const h = new ContainerHost(
    store,
    Z,
    registry ?? (new Map([['strip', stripStrategy as never]]) as StrategyRegistry),
  );
  h.setViewport({ w: 200, h: 100 });
  return h;
}

const splitOntoB: LayoutPreview = {
  insertId: 'a',
  cursor: { x: 150, y: 5 },
  split: { ontoId: 'b', edge: 'start', axis: 'y' },
};

describe('ContainerHost split preview', () => {
  it('gives the group the slot the onto-child held, with the source gone from the parent', () => {
    const h = host(build());
    h.setPreview(splitOntoB);
    const { placements, isPreview } = h.layout();
    // `a` leaves the parent on drop, so `b`'s slot is the whole container —
    // halved on the split axis, source first because the edge is 'start'.
    expect(placements.get(A)).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    expect(placements.get(B)).toEqual({ x: 0, y: 50, w: 200, h: 50 });
    expect(isPreview).toBe(true);
  });

  it('keeps the parent laying out its other children around the freed slot', () => {
    const store = build();
    const C = asNodeId('c');
    store.registerNode(createNode({ kind: 'panel', focus: true, id: C, parentId: Z }));
    store.showNode(C);
    const h = host(store);
    h.setPreview(splitOntoB);
    const { placements } = h.layout();
    // Parent lays out `b` and `c` at 100 each; the split subdivides `b`'s.
    expect(placements.get(C)).toEqual({ x: 100, y: 0, w: 100, h: 100 });
    expect(placements.get(B)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
    expect(placements.get(A)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('honors the prospective group config', () => {
    const h = host(build());
    h.setPreview({ ...splitOntoB, split: { ...splitOntoB.split!, config: { gap: 10 } } });
    expect(h.layout().placements.get(A)).toEqual({ x: 0, y: 0, w: 200, h: 45 });
  });

  it('shows the un-split layout when no split strategy is registered', () => {
    // The container lays out fine; it is the strategy the *group* would get
    // that is missing, which is the only reason this reaches the fallback.
    const h = host(
      build('other'),
      new Map([['other', stripStrategy as never]]) as StrategyRegistry,
    );
    h.setPreview(splitOntoB);
    const { placements, isPreview } = h.layout();
    expect(placements.get(B)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(placements.has(A)).toBe(false);
    expect(isPreview).toBe(false);
  });

  it('leaves placements alone when the onto-child was not placed', () => {
    const h = host(build());
    h.setPreview({ ...splitOntoB, split: { ...splitOntoB.split!, ontoId: 'nope' } });
    const { placements, isPreview } = h.layout();
    expect(placements.get(B)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(placements.has(A)).toBe(false);
    expect(isPreview).toBe(false);
  });

  it('invalidates when the edge flips, so the preview does not stick mid-drag', () => {
    const h = host(build());
    h.setPreview(splitOntoB);
    expect(h.layout().placements.get(A)?.y).toBe(0);
    h.setPreview({ ...splitOntoB, split: { ...splitOntoB.split!, edge: 'end' } });
    expect(h.layout().placements.get(A)?.y).toBe(50);
  });

  it('holds the same layout object when nothing about the split changed', () => {
    const h = host(build());
    h.setPreview(splitOntoB);
    const first = h.layout();
    h.setPreview({ ...splitOntoB, split: { ...splitOntoB.split! } });
    expect(h.layout()).toBe(first);
  });

  it('still splices the source in for an ordinary insert preview', () => {
    const h = host(build());
    h.setPreview({ insertId: 'd', insertIndex: 0, cursor: { x: 0, y: 0 } });
    const { placements } = h.layout();
    expect(placements.get(asNodeId('d'))).toEqual({ x: 0, y: 0, w: 66.66666666666667, h: 100 });
  });
});
