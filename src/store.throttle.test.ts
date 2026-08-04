import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';
import { FakeClock } from './test-utils/fake-clock.js';

const tick = () => new Promise<void>((r) => queueMicrotask(() => r()));

// `NodeId` is a branded string and `createZone` requires `config`, so every
// test in this file builds nodes through these three helpers.
const nid = (s: string) => asNodeId(s);
const zone = (id: string) => createZone({ id: nid(id), strategyId: 'grid', config: {} });
const panel = (id: string, parentId: string) =>
  createPanel({ id: nid(id), parentId: nid(parentId) });

describe('Store construction', () => {
  it('still constructs with no arguments', () => {
    const store = new Store();
    expect(store.nodes.size).toBe(0);
  });

  it('is passthrough when no throttle policy is given', () => {
    const store = new Store();
    expect(store.nodes).toBe(store.nodesTruth);
  });

  it('allocates a separate projection when throttled', () => {
    const store = new Store({ throttle: { notifyMs: 32 }, clock: new FakeClock() });
    expect(store.nodes).not.toBe(store.nodesTruth);
  });

  it('notifies subscribers on a microtask when un-throttled', async () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(() => {
      calls++;
    });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    expect(calls).toBe(0);
    await tick();
    expect(calls).toBe(1);
  });
});

describe('Store published projection', () => {
  it('withholds a registration until the notify window elapses', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));

    expect(store.getNodeTruth(nid('z'))).toBeDefined();
    expect(store.getNode(nid('z'))).toBeUndefined();

    clock.advance(32);
    expect(store.getNode(nid('z'))).toBeDefined();
  });

  it('shares one Machine instance between truth and published', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));
    clock.advance(32);

    const published = store.getNode(nid('z'));
    const truth = store.getNodeTruth(nid('z'));
    expect(published).toBe(truth);
    expect(published?.lifecycle).toBe(truth?.lifecycle);
    expect(typeof published?.lifecycle.send).toBe('function');
  });

  it('projects rootIds on flush', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));
    expect(store.rootIds).toEqual([]);
    expect(store.rootIdsTruth).toEqual([nid('z')]);
    clock.advance(32);
    expect(store.rootIds).toEqual([nid('z')]);
  });

  it('flushNow() collapses pending latency', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 5000 }, clock });
    store.registerNode(zone('z'));
    expect(store.getNode(nid('z'))).toBeUndefined();
    store.flushNow();
    expect(store.getNode(nid('z'))).toBeDefined();
  });
});
