import { describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { asNodeId, Store } from './index.js';
import { stripStrategy } from './layout/strip.js';

const Z = asNodeId('z');

function seeded() {
  const store = new Store();
  store.registerNode(
    createNode({
      kind: 'zone',
      id: Z,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
    }),
  );
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    store.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    store.showNode(nid);
  }
  const host = new ContainerHost(store, Z, new Map([['strip', stripStrategy as never]]));
  host.setViewport({ w: 200, h: 100 });
  return { store, host };
}

describe('ContainerHost — view', () => {
  it('reports the identity view until told otherwise', () => {
    const { host } = seeded();
    expect(host.layout().view).toEqual({ x: 0, y: 0, scale: 1 });
    expect(host.view()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('reports what setView was given', () => {
    const { host } = seeded();
    host.setView({ x: 10, y: 5, scale: 0.5 });
    expect(host.layout().view).toEqual({ x: 10, y: 5, scale: 0.5 });
  });

  it('leaves placements alone — layout runs in layout pixels', () => {
    const { host } = seeded();
    const before = host.layout().placements;
    host.setView({ x: 10, y: 5, scale: 0.5 });
    expect(host.layout().placements).toBe(before);
  });

  it('notifies subscribers, and ignores an equal view', () => {
    const { host } = seeded();
    host.layout();
    const seen = vi.fn();
    host.subscribe(seen);
    host.setView({ x: 0, y: 0, scale: 2 });
    expect(seen).toHaveBeenCalledTimes(1);
    host.layout();
    host.setView({ x: 0, y: 0, scale: 2 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('refuses a scale that is not a positive finite number', () => {
    const { host } = seeded();
    host.setView({ x: 0, y: 0, scale: 0 });
    host.setView({ x: 0, y: 0, scale: Number.NaN });
    expect(host.view().scale).toBe(1);
  });

  it('keeps a seam drag in layout pixels: the host takes deltas already divided', () => {
    const { host } = seeded();
    host.setView({ x: 0, y: 0, scale: 0.5 });
    const seam = host.layout().affordances[0];
    expect(seam).toBeDefined();
    const aBefore = host.layout().placements.get(asNodeId('a'))!.w;
    host.dispatchAffordance({
      affordanceId: seam!.id,
      kind: 'drag',
      payload: { dx: 20, dy: 0 },
    });
    expect(host.layout().placements.get(asNodeId('a'))!.w).toBe(aBefore + 20);
  });
});
