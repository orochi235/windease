import { describe, expect, it } from 'vitest';
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { Node, NodeId } from './node.js';
import { FakeClock } from './test-utils/fake-clock.js';
import { Publisher, systemClock, type ThrottlePolicy } from './throttle.js';

describe('systemClock', () => {
  it('reports a monotonic-ish now()', () => {
    const a = systemClock.now();
    expect(typeof a).toBe('number');
    expect(systemClock.now()).toBeGreaterThanOrEqual(a);
  });

  it('schedules and cancels timers', async () => {
    let fired = false;
    const h = systemClock.setTimeout(() => {
      fired = true;
    }, 0);
    systemClock.clearTimeout(h);
    await new Promise((r) => setTimeout(r, 5));
    expect(fired).toBe(false);
  });
});

const nid = (s: string) => s as NodeId;
const tick = () => new Promise<void>((r) => queueMicrotask(() => r()));

function makeNode(id: string): Node {
  return { id: nid(id), lifecycle: createLifecycleMachine() };
}

function harness(policy?: undefined) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  let focusedId: NodeId | null = null;
  let notifies = 0;
  const pub = new Publisher({
    truth,
    policy,
    clock: new FakeClock(),
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
  });
  return {
    pub,
    truth,
    notifies: () => notifies,
    setRootIds: (ids: NodeId[]) => {
      rootIds = ids;
    },
    setFocused: (id: NodeId | null) => {
      focusedId = id;
    },
  };
}

describe('Publisher — passthrough', () => {
  it('reports passthrough when no policy is given', () => {
    const { pub } = harness();
    expect(pub.passthrough).toBe(true);
  });

  it('exposes truth by identity', () => {
    const { pub, truth } = harness();
    expect(pub.nodes).toBe(truth);
  });

  it('coalesces many marks into one microtask notify', async () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'));
    h.pub.markDirty(nid('b'));
    h.pub.markDirty(nid('a'));
    expect(h.notifies()).toBe(0);
    await tick();
    expect(h.notifies()).toBe(1);
  });

  it('reflects a mutation immediately, before any flush', () => {
    const h = harness();
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
  });
});

function throttledHarness(policy: ThrottlePolicy) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  let focusedId: NodeId | null = null;
  let notifies = 0;
  const clock = new FakeClock();
  const pub = new Publisher({
    truth,
    policy,
    clock,
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
  });
  return {
    pub,
    truth,
    clock,
    notifies: () => notifies,
    setRootIds: (ids: NodeId[]) => {
      rootIds = ids;
    },
  };
}

describe('Publisher — notifyMs window', () => {
  it('is not passthrough and allocates its own map', () => {
    const h = throttledHarness({ notifyMs: 32 });
    expect(h.pub.passthrough).toBe(false);
    expect(h.pub.nodes).not.toBe(h.truth);
  });

  it('withholds a mutation until the window elapses', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();
    expect(h.notifies()).toBe(0);

    h.clock.advance(31);
    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();

    h.clock.advance(1);
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);
  });

  it('coalesces a burst across the window into one notify', () => {
    const h = throttledHarness({ notifyMs: 32 });
    for (const id of ['a', 'b', 'c']) {
      h.truth.set(nid(id), makeNode(id));
      h.pub.markDirty(nid(id));
      h.clock.advance(5);
    }
    expect(h.notifies()).toBe(0);
    h.clock.advance(32);
    expect(h.notifies()).toBe(1);
    expect(h.pub.nodes.size).toBe(3);
  });

  it('publishes the latest truth, not the value at mark time', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    const latest = makeNode('a');
    h.truth.set(nid('a'), latest);
    h.clock.advance(32);
    expect(h.pub.nodes.get(nid('a'))).toBe(latest);
  });

  it('drops a node deleted from truth before the flush', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.clock.advance(32);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);

    h.truth.delete(nid('a'));
    h.pub.markDirty(nid('a'));
    h.clock.advance(32);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);
  });

  it('flushNow() publishes immediately and cancels the pending timer', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    h.pub.flushNow();
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);
    expect(h.clock.pending).toBe(0);

    h.clock.advance(100);
    expect(h.notifies()).toBe(1);
  });

  it('projects rootIds only on flush', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.setRootIds([nid('a')]);
    h.pub.markGlobalsDirty();
    expect(h.pub.rootIds).toEqual([]);
    h.clock.advance(32);
    expect(h.pub.rootIds).toEqual([nid('a')]);
  });

  it('reset() snaps published to truth and cancels timers', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    h.pub.reset();
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.clock.pending).toBe(0);
  });
});
