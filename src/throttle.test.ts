import { describe, expect, it } from 'vitest';
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { Node, NodeId } from './node.js';
import { FakeClock } from './test-utils/fake-clock.js';
import { Publisher, type ThrottlePolicy, systemClock } from './throttle.js';

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

  it('reset() notifies subscribers', () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));

    h.pub.reset();
    expect(h.notifies()).toBe(1);
  });

  it('reset() cancels a pending microtask so total notifies is 1, not 2', async () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));

    h.pub.reset();
    expect(h.notifies()).toBe(1);
    await tick();
    await tick();
    expect(h.notifies()).toBe(1);
  });
});

function throttledHarness(policy: ThrottlePolicy) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  const focusedId: NodeId | null = null;
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

  it('markDirty opts are accepted but change nothing observable today', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });

    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();
    expect(h.notifies()).toBe(0);

    h.clock.advance(32);
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);
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

  it('reset() notifies subscribers, cancelling the pending timer', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));

    h.pub.reset();
    expect(h.notifies()).toBe(1);
    expect(h.clock.pending).toBe(0);

    h.clock.advance(100);
    expect(h.notifies()).toBe(1);
  });
});

describe('Publisher — policy present, notifyMs omitted', () => {
  // `notifyMs` is optional on ThrottlePolicy, so a dwell-only policy like
  // `{ dwell: { lifecycle: 150 } }` is a valid non-passthrough policy that
  // still schedules via queueMicrotask (schedule() branches on
  // `windowMs === undefined`, not on `this.passthrough`). Nothing exercises
  // this combination elsewhere: the passthrough suite always passes
  // `policy: undefined`, and the notifyMs suite always sets `notifyMs`.
  const policy: ThrottlePolicy = { dwell: { lifecycle: 150 } };

  it('is not passthrough and allocates its own map', () => {
    const h = throttledHarness(policy);
    expect(h.pub.passthrough).toBe(false);
    expect(h.pub.nodes).not.toBe(h.truth);
  });

  it('publishes a markDirty after a microtask drain, not synchronously', async () => {
    const h = throttledHarness(policy);
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();
    expect(h.notifies()).toBe(0);

    await tick();
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);
  });

  it('flushNow() while a microtask is pending yields exactly one notify total', async () => {
    const h = throttledHarness(policy);
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    h.pub.flushNow();
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);

    await tick();
    await tick();
    expect(h.notifies()).toBe(1);
  });
});

describe('Publisher — dwell', () => {
  const policy = { notifyMs: 10, dwell: { lifecycle: 150 }, maxWaitMs: 600 };

  it('publishes an isolated transition after dwellMs of quiet', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(149);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('never publishes the intermediate state of a bounce', () => {
    const h = throttledHarness(policy);
    const first = makeNode('a');
    h.truth.set(nid('a'), first);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(80);
    const second = makeNode('a');
    h.truth.set(nid('a'), second);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    // The debounce restarted at t=80, so nothing is published at t=150.
    h.clock.advance(70);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(80);
    expect(h.pub.nodes.get(nid('a'))).toBe(second);
  });

  it('forces a publish at maxWaitMs under continuous churn', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    for (let t = 0; t < 600; t += 50) {
      h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
      h.clock.advance(50);
    }
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('does not dwell a node whose machines are stable', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('does not dwell a machine with no configured dwell', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'focus' });
    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('bypasses dwell for structural changes', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });
    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('holds a dwelling node while publishing its stable neighbor', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('b'));

    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('b'))).toBe(true);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);
  });

  it('holds with exactly one pending timer, never busy-spinning', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(20);
    // Still held. Exactly one timer should be armed for the wake-up — not a
    // re-armed notify window firing repeatedly for the whole dwell.
    expect(h.pub.nodes.has(nid('a'))).toBe(false);
    expect(h.clock.pending).toBe(1);
  });

  it('does not spin when notifyMs is 0 and a node is dwelling', () => {
    // A zero-length window plus a dwell-held node is the exact shape that
    // makes a naive `schedule()` re-arm at the same timestamp forever.
    const h = throttledHarness({ notifyMs: 0, dwell: { lifecycle: 150 }, maxWaitMs: 600 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(() => h.clock.advance(200)).not.toThrow();
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('defaults maxWaitMs to 4x the largest dwell', () => {
    const h = throttledHarness({ notifyMs: 10, dwell: { lifecycle: 100 } });
    h.truth.set(nid('a'), makeNode('a'));
    for (let t = 0; t < 400; t += 50) {
      h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
      h.clock.advance(50);
    }
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });
});
