import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { stripStrategy } from './layout/strip.js';
import type { StrategyRegistry } from './layout-types.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const REGISTRY: StrategyRegistry = new Map([['stack', stripStrategy as never]]);
const Z = asNodeId('z');

function build(): Store {
  const s = new Store();
  s.registerNode(createZone({ id: Z, strategyId: 'stack', config: { axis: 'y', fill: true } }));
  for (const id of ['p1', 'p2']) {
    const nid = asNodeId(id);
    s.registerNode(createPanel({ id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

function host(store: Store): ContainerHost {
  const h = new ContainerHost(store, Z, REGISTRY);
  h.setViewport({ w: 200, h: 400 });
  return h;
}

describe('ContainerHost', () => {
  it('lays out with no DOM — setViewport is the whole requirement', () => {
    const h = host(build());
    expect([...h.layout().placements.keys()]).toEqual(['p1', 'p2']);
    h.destroy();
  });

  it('returns an identity-stable snapshot until something invalidates it', () => {
    const h = host(build());
    const a = h.layout();
    expect(h.layout()).toBe(a);
    h.setViewport({ w: 300, h: 400 });
    expect(h.layout()).not.toBe(a);
    h.destroy();
  });

  it('a repeated setViewport with equal dimensions does not invalidate', () => {
    const h = host(build());
    const a = h.layout();
    h.setViewport({ w: 200, h: 400 });
    expect(h.layout()).toBe(a);
    h.destroy();
  });

  it('sees a new child synchronously, with no tick in between', () => {
    const store = build();
    const h = host(store);
    h.layout();
    let calls = 0;
    h.subscribe(() => {
      calls += 1;
    });
    const p3 = asNodeId('p3');
    store.registerNode(createPanel({ id: p3, parentId: Z }));
    store.showNode(p3);
    // The value of the whole host: mutate, then read on the next line.
    expect(calls).toBeGreaterThan(0);
    expect([...h.layout().placements.keys()]).toContain('p3');
    h.destroy();
  });

  it('reflects a reorder synchronously', () => {
    const store = build();
    const h = host(store);
    expect([...h.layout().placements.keys()]).toEqual(['p1', 'p2']);
    store.reorderInParent(asNodeId('p2'), 0);
    expect([...h.layout().placements.keys()]).toEqual(['p2', 'p1']);
    h.destroy();
  });

  it('reflects a hidden child synchronously', () => {
    const store = build();
    const h = host(store);
    store.hideNode(asNodeId('p1'));
    expect([...h.layout().placements.keys()]).toEqual(['p2']);
    h.destroy();
  });

  it('notifies once per read however many events a mutation fires', () => {
    const store = build();
    const h = host(store);
    h.layout();
    let calls = 0;
    h.subscribe(() => {
      calls += 1;
    });
    const p3 = asNodeId('p3');
    store.registerNode(createPanel({ id: p3, parentId: Z }));
    store.showNode(p3);
    store.reorderInParent(p3, 0);
    // Several synchronous events plus the later catch-all, but nobody has
    // read since the first — one notification is all a listener needs.
    expect(calls).toBe(1);
    h.layout();
    store.hideNode(p3);
    expect(calls).toBe(2);
    h.destroy();
  });

  it('stops notifying after destroy', async () => {
    const store = build();
    const h = host(store);
    h.layout();
    let calls = 0;
    h.subscribe(() => {
      calls += 1;
    });
    h.destroy();
    store.registerNode(createPanel({ id: asNodeId('p9'), parentId: Z }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });

  it('re-runs when a *child* lock changes, which never alters the parent ref', () => {
    const store = build();
    const h = host(store);
    const before = h.layout();
    store.setLock(asNodeId('p1'), { resize: true });
    expect(h.layout()).not.toBe(before);
    h.destroy();
  });

  it('drops every affordance while the container is arrange-locked', () => {
    const store = build();
    const h = host(store);
    expect(h.layout().affordances.length).toBeGreaterThan(0);
    store.setLock(Z, { arrange: true });
    expect(h.layout().affordances).toEqual([]);
    h.destroy();
  });

  it('refuses dispatchAffordance under an arrange lock', () => {
    const store = build();
    const h = host(store);
    const aff = h.layout().affordances[0];
    if (!aff) throw new Error('fixture has no affordance to drag');
    store.setLock(Z, { arrange: true });
    h.dispatchAffordance({ affordanceId: aff.id, kind: 'drag', payload: { dx: 0, dy: 40 } });
    expect(store.getContainerState(Z)).toBeUndefined();
    h.destroy();
  });

  it('stops notifying on lock events after destroy', () => {
    const store = build();
    const h = host(store);
    let calls = 0;
    h.subscribe(() => {
      calls += 1;
    });
    h.destroy();
    store.setLock(asNodeId('p1'), { resize: true });
    expect(calls).toBe(0);
  });
});
