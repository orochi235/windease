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
      container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
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

describe('ContainerHost — scroll', () => {
  it('reports no scroll until told otherwise', () => {
    const { host } = seeded();
    expect(host.layout().scroll).toEqual({ x: 0, y: 0 });
  });

  it('reports what setScroll was given', () => {
    const { host } = seeded();
    host.setScroll({ x: 0, y: 40 });
    expect(host.layout().scroll).toEqual({ x: 0, y: 40 });
  });

  it('leaves placements alone — they are unscrolled', () => {
    const { host } = seeded();
    const before = new Map(host.layout().placements);
    host.setScroll({ x: 0, y: 40 });
    expect(host.layout().placements).toEqual(before);
  });

  it('notifies subscribers so a binding recomposes', () => {
    const { host } = seeded();
    host.layout();
    const seen = vi.fn();
    host.subscribe(seen);
    host.setScroll({ x: 0, y: 40 });
    expect(seen).toHaveBeenCalled();
  });

  it('does not re-run the strategy — a scroll arrives per frame', () => {
    const store = new Store();
    store.registerNode(
      createNode({ kind: 'zone', id: Z, container: { strategyId: 'spy', config: {} } }),
    );
    const p = asNodeId('p');
    store.registerNode(createNode({ kind: 'panel', focus: true, id: p, parentId: Z }));
    store.showNode(p);
    const layout = vi.fn(() => ({ placements: new Map(), affordances: [] }));
    const host = new ContainerHost(store, Z, new Map([['spy', { name: 'spy', layout } as never]]));
    host.setViewport({ w: 200, h: 100 });
    host.layout();
    expect(layout).toHaveBeenCalledTimes(1);

    host.setScroll({ x: 0, y: 40 });
    host.layout();
    host.setScroll({ x: 0, y: 80 });
    host.layout();
    expect(layout).toHaveBeenCalledTimes(1);
    expect(host.layout().scroll).toEqual({ x: 0, y: 80 });
  });

  it('ignores a repeated offset', () => {
    const { host } = seeded();
    host.layout();
    const seen = vi.fn();
    host.subscribe(seen);
    host.setScroll({ x: 0, y: 40 });
    host.setScroll({ x: 0, y: 40 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('survives a scroll reported before the first layout read', () => {
    const { host } = seeded();
    host.setScroll({ x: 5, y: 10 });
    expect(host.layout().scroll).toEqual({ x: 5, y: 10 });
  });
});

describe('ContainerHost — observeScroll', () => {
  function fakeScroller() {
    const listeners = new Set<() => void>();
    const el = {
      scrollLeft: 0,
      scrollTop: 0,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      fire: () => {
        for (const fn of listeners) fn();
      },
      count: () => listeners.size,
    };
    return el;
  }

  it('reads the element on attach and on every scroll', () => {
    const { host } = seeded();
    const el = fakeScroller();
    el.scrollTop = 12;
    const off = host.observeScroll(el as unknown as Element);
    expect(host.layout().scroll).toEqual({ x: 0, y: 12 });

    el.scrollTop = 64;
    el.fire();
    expect(host.layout().scroll).toEqual({ x: 0, y: 64 });
    off();
  });

  it('detaches on teardown and on destroy', () => {
    const { host } = seeded();
    const el = fakeScroller();
    const off = host.observeScroll(el as unknown as Element);
    expect(el.count()).toBe(1);
    off();
    expect(el.count()).toBe(0);

    host.observeScroll(el as unknown as Element);
    host.destroy();
    expect(el.count()).toBe(0);
  });

  it('replaces a previous subscription rather than stacking', () => {
    const { host } = seeded();
    const first = fakeScroller();
    const second = fakeScroller();
    host.observeScroll(first as unknown as Element);
    host.observeScroll(second as unknown as Element);
    expect(first.count()).toBe(0);
    expect(second.count()).toBe(1);
  });
});
