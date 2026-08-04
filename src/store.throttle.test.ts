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

  // Task 8 repoints `store.nodes` at the published projection; until then it
  // still reads truth, so this fails by design. Re-enable in Task 8.
  it.skip('allocates a separate projection when throttled', () => {
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
