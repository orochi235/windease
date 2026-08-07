import { describe, expect, it } from 'vitest';
import { InvalidThrottlePolicyError } from './errors.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { Node, NodeId } from './node.js';
import { captureTrace } from './test-utils/capture-trace.js';
import { FakeClock } from './test-utils/fake-clock.js';
import {
  type Clock,
  Publisher,
  systemClock,
  type ThrottlePendingPayload,
  type ThrottlePolicy,
  type ThrottlePublishedPayload,
} from './throttle.js';

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

type RecordedEvent =
  | { kind: 'pending'; payload: ThrottlePendingPayload }
  | { kind: 'published'; payload: ThrottlePublishedPayload };

function harness(policy?: undefined) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  let focusedId: NodeId | null = null;
  let notifies = 0;
  const events: RecordedEvent[] = [];
  const pub = new Publisher({
    truth,
    policy,
    clock: new FakeClock(),
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
    onPending: (payload) => {
      events.push({ kind: 'pending', payload });
    },
  });
  return {
    pub,
    truth,
    notifies: () => notifies,
    events,
    pendingEvents: () =>
      events
        .filter((e): e is Extract<RecordedEvent, { kind: 'pending' }> => e.kind === 'pending')
        .map((e) => e.payload),
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

  it('reset() touches neither the clock nor the heap when there is no drain', () => {
    const base = new FakeClock();
    let nowCalls = 0;
    const clock: Clock = {
      now: () => {
        nowCalls++;
        return base.now();
      },
      setTimeout: (fn, ms) => base.setTimeout(fn, ms),
      clearTimeout: (h) => base.clearTimeout(h),
    };
    const truth = new Map<NodeId, Node>();
    const pub = new Publisher({
      truth,
      policy: undefined,
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
    });
    truth.set(nid('a'), makeNode('a'));
    pub.markDirty(nid('a'));

    const before = nowCalls;
    pub.reset();
    // Passthrough tracks nothing, so there is nothing to drain and no
    // reason to timestamp the drain.
    expect(nowCalls - before).toBe(0);
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
  const events: RecordedEvent[] = [];
  const pub = new Publisher({
    truth,
    policy,
    clock,
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
    onPending: (payload) => {
      events.push({ kind: 'pending', payload });
    },
    onPublished: (payload) => {
      events.push({ kind: 'published', payload });
    },
  });
  return {
    pub,
    truth,
    clock,
    notifies: () => notifies,
    events,
    pendingEvents: () =>
      events
        .filter((e): e is Extract<RecordedEvent, { kind: 'pending' }> => e.kind === 'pending')
        .map((e) => e.payload),
    publishedEvents: () =>
      events
        .filter((e): e is Extract<RecordedEvent, { kind: 'published' }> => e.kind === 'published')
        .map((e) => e.payload),
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

  it('markDirty opts do not change publish timing under a notifyMs-only policy', () => {
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

describe('Publisher — stagger', () => {
  const policy = { notifyMs: 10, stagger: { batch: 2, ms: 40 } };

  function seedMany(h: ReturnType<typeof throttledHarness>, ids: string[]) {
    for (const id of ids) {
      h.truth.set(nid(id), makeNode(id));
      h.pub.markDirty(nid(id));
    }
  }

  it('publishes at most `batch` nodes per wave', () => {
    const h = throttledHarness(policy);
    seedMany(h, ['a', 'b', 'c', 'd', 'e']);

    h.clock.advance(10);
    expect(h.pub.nodes.size).toBe(2);

    h.clock.advance(40);
    expect(h.pub.nodes.size).toBe(4);

    h.clock.advance(40);
    expect(h.pub.nodes.size).toBe(5);
  });

  it('publishes in oldest-dirty-first order', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('old'), makeNode('old'));
    h.pub.markDirty(nid('old'));
    h.clock.advance(1);
    h.truth.set(nid('mid'), makeNode('mid'));
    h.pub.markDirty(nid('mid'));
    h.clock.advance(1);
    h.truth.set(nid('new'), makeNode('new'));
    h.pub.markDirty(nid('new'));

    h.clock.advance(10);
    expect([...h.pub.nodes.keys()]).toEqual([nid('old'), nid('mid')]);
  });

  it('is deterministic across identical runs', () => {
    const run = () => {
      const h = throttledHarness(policy);
      seedMany(h, ['e', 'd', 'c', 'b', 'a']);
      h.clock.advance(10);
      return [...h.pub.nodes.keys()];
    };
    expect(run()).toEqual(run());
  });

  it('does not batch when no stagger policy is configured', () => {
    const h = throttledHarness({ notifyMs: 10 });
    seedMany(h, ['a', 'b', 'c', 'd', 'e']);
    h.clock.advance(10);
    expect(h.pub.nodes.size).toBe(5);
  });

  it('flushNow() ignores the stagger budget', () => {
    const h = throttledHarness(policy);
    seedMany(h, ['a', 'b', 'c', 'd', 'e']);
    h.pub.flushNow();
    expect(h.pub.nodes.size).toBe(5);
  });

  it('a dwell-held node is filtered out before the stagger slice, so it never occupies wave budget', () => {
    // dwell holds 'held' ineligible for 100ms; batch is only 2, so if
    // eligibility were checked *after* slicing instead of before, 'held'
    // would consume one of the two wave slots and only one real node
    // ('a') would publish this wave instead of two.
    const dwellPolicy = { notifyMs: 10, dwell: { lifecycle: 100 }, stagger: { batch: 2, ms: 40 } };
    const h = throttledHarness(dwellPolicy);

    h.truth.set(nid('held'), makeNode('held'));
    h.pub.markDirty(nid('held'), { machine: 'lifecycle' });

    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('b'));
    h.truth.set(nid('c'), makeNode('c'));
    h.pub.markDirty(nid('c'));

    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('held'))).toBe(false);
    expect(h.pub.nodes.size).toBe(2);
    expect([...h.pub.nodes.keys()]).toEqual([nid('a'), nid('b')]);
  });
});

function buildPublisher(policy: ThrottlePolicy): Publisher {
  return new Publisher({
    truth: new Map(),
    policy,
    clock: new FakeClock(),
    readGlobals: () => ({ rootIds: [], focusedId: null }),
    notify: () => {},
  });
}

describe('Publisher — policy validation', () => {
  // Fix 1 regression coverage: `stagger.batch: 0` (or any value below 1)
  // makes the batch computed at src/throttle.ts:254 —
  // `full ? eligible.length : (this.policy?.stagger?.batch ?? eligible.length)`
  // — evaluate to 0 on every flush, forever, because `??` only catches
  // `undefined`. A dirty node then never becomes eligible for a wave and a
  // recheck timer keeps re-arming indefinitely. Construction must reject
  // this instead of silently starving.
  it('rejects stagger.batch: 0', () => {
    expect(() => buildPublisher({ stagger: { batch: 0, ms: 40 } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a negative stagger.batch', () => {
    expect(() => buildPublisher({ stagger: { batch: -1, ms: 40 } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a non-integer stagger.batch', () => {
    expect(() => buildPublisher({ stagger: { batch: 1.5, ms: 40 } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a NaN stagger.batch', () => {
    expect(() => buildPublisher({ stagger: { batch: Number.NaN, ms: 40 } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a negative stagger.ms', () => {
    expect(() => buildPublisher({ stagger: { batch: 4, ms: -1 } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a NaN stagger.ms', () => {
    expect(() => buildPublisher({ stagger: { batch: 4, ms: Number.NaN } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a negative notifyMs', () => {
    expect(() => buildPublisher({ notifyMs: -1 })).toThrow(InvalidThrottlePolicyError);
  });

  it('rejects a NaN notifyMs', () => {
    expect(() => buildPublisher({ notifyMs: Number.NaN })).toThrow(InvalidThrottlePolicyError);
  });

  it('rejects an infinite notifyMs', () => {
    expect(() => buildPublisher({ notifyMs: Number.POSITIVE_INFINITY })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a negative dwell value', () => {
    expect(() => buildPublisher({ dwell: { lifecycle: -1 } })).toThrow(InvalidThrottlePolicyError);
  });

  it('rejects a NaN dwell value', () => {
    expect(() => buildPublisher({ dwell: { lifecycle: Number.NaN } })).toThrow(
      InvalidThrottlePolicyError,
    );
  });

  it('rejects a negative maxWaitMs', () => {
    expect(() => buildPublisher({ maxWaitMs: -1 })).toThrow(InvalidThrottlePolicyError);
  });

  it('rejects a NaN maxWaitMs', () => {
    expect(() => buildPublisher({ maxWaitMs: Number.NaN })).toThrow(InvalidThrottlePolicyError);
  });

  it('accepts and honors notifyMs: 0 — a real zero-delay window, not "omitted"', () => {
    const h = throttledHarness({ notifyMs: 0 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    // Nothing published synchronously — a timer is armed even for a 0ms
    // window, distinct from the omitted-notifyMs microtask path.
    expect(h.pub.nodes.has(nid('a'))).toBe(false);
    h.clock.advance(0);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('accepts an omitted throttle policy fields (defaults intact)', () => {
    expect(() => buildPublisher({})).not.toThrow();
    const h = throttledHarness({});
    expect(h.pub.passthrough).toBe(false);
  });

  it('accepts maxWaitMs: 0 (disables the starvation cap rather than forcing immediate publish)', () => {
    expect(() =>
      buildPublisher({ notifyMs: 10, dwell: { lifecycle: 100 }, maxWaitMs: 0 }),
    ).not.toThrow();
  });

  it('accepts a valid stagger policy at the boundary (batch: 1)', () => {
    expect(() => buildPublisher({ stagger: { batch: 1, ms: 0 } })).not.toThrow();
  });
});

describe('Publisher — dwell debounce restart (Fix 2 regression)', () => {
  const policy = { notifyMs: 10, dwell: { lifecycle: 150 }, maxWaitMs: 600 };

  it('an untagged markDirty on a dwelling node does not restart the debounce clock', () => {
    // Reproduction: seed a dwell via a lifecycle transition, then send
    // ordinary (untagged) markDirty calls the way setActivity/patchPlacement
    // /setMeta do via replaceNode/replaceSlot. Per the design doc
    // (dwell.lifecycle=150, maxWaitMs=600) the node must publish after
    // dwellMs of FSM quiet, not linger until maxWaitMs.
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    for (let t = 0; t < 100; t += 50) {
      h.clock.advance(50);
      h.pub.markDirty(nid('a')); // no machine tag — an ordinary field write
    }
    // t=100: still within dwell (touched should still be t=0).
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(49); // t=149
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(1); // t=150 — dwellMs of quiet since the FSM touch at t=0
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('a genuine second FSM transition still restarts the debounce (bounce suppression)', () => {
    // This is the behavior the whole feature exists for; the Fix 2 change
    // must not regress it.
    const h = throttledHarness(policy);
    const first = makeNode('a');
    h.truth.set(nid('a'), first);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(80);
    const second = makeNode('a');
    h.truth.set(nid('a'), second);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(70); // t=150 from the first touch — but debounce restarted at t=80
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(80); // t=230 — 150ms after the restart at t=80
    expect(h.pub.nodes.get(nid('a'))).toBe(second);
  });

  it('an untagged markDirty does not reset "since", so maxWaitMs still eventually forces a publish', () => {
    // If untagged calls reset `since` instead of leaving it alone, a
    // permanently-noisy non-FSM node held by an earlier dwell could starve
    // past maxWaitMs. Confirm `since` keeps counting from the original
    // dirty time even across untagged touches.
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    // Untagged touches every 10ms — far more frequent than dwellMs, so if
    // `touched` were restarted the node would never publish. It must still
    // publish exactly at dwellMs (150) since the untagged calls must not
    // extend `touched` either.
    for (let t = 0; t < 150; t += 10) {
      h.clock.advance(10);
      h.pub.markDirty(nid('a'));
    }
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });
});

describe('Publisher — getPending', () => {
  it('returns null in passthrough even with a dirty node', () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))).toBeNull();
  });

  it('returns null for a node that was never marked dirty', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    expect(h.pub.getPending(nid('nope'))).toBeNull();
  });

  it('describes a dwell-gated node', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pub.getPending(nid('a'))).toEqual({
      since: 0,
      touched: 0,
      dwellMs: 150,
      machine: 'lifecycle',
      bypass: false,
      coalesced: 0,
      eligibleAt: 150,
    });
  });

  it('reports eligibleAt as since for a bypassing node', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.clock.advance(40);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });

    const pending = h.pub.getPending(nid('a'));
    expect(pending?.bypass).toBe(true);
    expect(pending?.eligibleAt).toBe(40);
    expect(pending?.since).toBe(40);
  });

  it('reports eligibleAt as since for a node with no dwell gate', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));

    const pending = h.pub.getPending(nid('a'));
    expect(pending?.dwellMs).toBe(0);
    expect(pending?.eligibleAt).toBe(0);
  });

  it('clamps eligibleAt to the maxWaitMs starvation cap', () => {
    // dwell 150 restarts on every touch; maxWait 200 from `since` wins
    // once the node has been noisy for long enough.
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 }, maxWaitMs: 200 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(100);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    const pending = h.pub.getPending(nid('a'));
    // touched=100 → byDwell=250; since=0 → byMaxWait=200. Min wins.
    expect(pending?.touched).toBe(100);
    expect(pending?.eligibleAt).toBe(200);
  });

  it('counts coalesced changes, not the first one', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))?.coalesced).toBe(0);

    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))?.coalesced).toBe(2);
  });

  it('returns null once the node publishes, and starts a fresh episode after', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 50 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(500);
    expect(h.pub.getPending(nid('a'))).toBeNull();

    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    const fresh = h.pub.getPending(nid('a'));
    expect(fresh?.coalesced).toBe(0);
    expect(fresh?.since).toBe(500);
    expect(fresh?.touched).toBe(500);
  });

  it('returns an independent snapshot, not a live view', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    const held = h.pub.getPending(nid('a'));

    h.clock.advance(10);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(held?.coalesced).toBe(0);
    expect(held?.touched).toBe(0);
    expect(h.pub.getPending(nid('a'))).not.toBe(held);
    expect(h.pub.getPending(nid('a'))?.coalesced).toBe(1);
  });

  it('keeps reporting a node whose gate is open but is stagger-deferred', () => {
    const h = throttledHarness({ notifyMs: 16, stagger: { batch: 1, ms: 1000 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'));
    h.pub.markDirty(nid('b'));

    h.clock.advance(16);
    // One published, one held back by the wave budget — its gate opened
    // long ago, which is exactly why eligibleAt is not a publish time.
    const deferred = h.pub.getPending(nid('b'));
    expect(h.pub.nodes.size).toBe(1);
    expect(deferred).not.toBeNull();
    expect(deferred?.eligibleAt).toBe(0);
  });

  it('merges a sticky bypass with the largest dwell', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { transit: 80, lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'transit' });
    h.clock.advance(50);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });

    const pending = h.pub.getPending(nid('a'));
    expect(pending?.dwellMs).toBe(150);
    expect(pending?.machine).toBe('lifecycle');
    expect(pending?.bypass).toBe(true);
    expect(pending?.since).toBe(0);
    expect(pending?.touched).toBe(50);
    // Literal, not `pending?.since` — comparing two fields of one object
    // can never fail. bypass short-circuits to `since`, so a shortcut
    // that returned `touched` would read 50 here and this would catch it.
    expect(pending?.eligibleAt).toBe(0);
  });

  it('keeps the machine that set the winning dwell when a smaller one marks later', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { transit: 80, lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'transit' });

    const pending = h.pub.getPending(nid('a'));
    // transit marked last, but lifecycle's 150 still governs the
    // deadline — the reported machine must be the one that set dwellMs,
    // not the most recent marker.
    expect(pending?.dwellMs).toBe(150);
    expect(pending?.machine).toBe('lifecycle');
  });

  it('keeps eligibleAt finite when the starvation cap is disabled', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 }, maxWaitMs: 0 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    const pending = h.pub.getPending(nid('a'));
    expect(pending?.eligibleAt).toBe(150);
    expect(Number.isFinite(pending?.eligibleAt ?? Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('Publisher — throttle.pending event', () => {
  it('does not fire in passthrough', () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'));
    expect(h.pendingEvents()).toEqual([]);
  });

  it('tolerates a throttled Publisher constructed without the callback', () => {
    const pub = buildPublisher({ notifyMs: 32, dwell: { lifecycle: 150 } });
    expect(() => pub.markDirty(nid('a'), { machine: 'lifecycle' })).not.toThrow();
  });

  it('fires once when a node first goes dirty', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pendingEvents()).toEqual([{ id: nid('a'), since: 0 }]);
  });

  it('fires once for a mutation that marks the node twice', () => {
    // This is the real `showNode` shape: an untagged mark from
    // `replaceNode` creates the entry, then a machine-tagged mark raises
    // the dwell. Only the first fires the event — which is exactly why
    // the payload carries no `dwellMs`: it isn't settled yet.
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pendingEvents()).toEqual([{ id: nid('a'), since: 0 }]);
    expect(h.pub.getPending(nid('a'))?.dwellMs).toBe(150);
  });

  it('does not re-fire on subsequent touches of the same entry', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'));

    expect(h.pendingEvents()).toHaveLength(1);
  });

  it('fires again for a new pending episode after the node publishes', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 50 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(500);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pendingEvents()).toHaveLength(2);
    expect(h.pendingEvents()[1]?.since).toBe(500);
  });

  it('reports one event per node', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('b'), { machine: 'lifecycle' });

    expect(h.pendingEvents().map((e) => e.id)).toEqual([nid('a'), nid('b')]);
  });
});

describe('Publisher — throttle.published event', () => {
  it('reports heldMs and coalesced for a node that settled', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 100 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(20);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(500);

    // FakeClock runs a timer with now() at its DUE time, not the end of
    // the advance window. Dirty at 0, touched at 20, 100ms dwell opens
    // the gate at 120 — so heldMs is 120, not 520.
    expect(h.publishedEvents()).toEqual([
      { id: nid('a'), heldMs: 120, coalesced: 1, forced: false },
    ]);
  });

  it('marks forced when flushNow bypasses an unsatisfied dwell', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.flushNow();

    const [event] = h.publishedEvents();
    expect(event?.forced).toBe(true);
    expect(event?.heldMs).toBe(0);
  });

  it('marks forced when the maxWaitMs cap wins over a restarting dwell', () => {
    const h = throttledHarness({ notifyMs: 10, dwell: { lifecycle: 100 }, maxWaitMs: 150 });
    h.truth.set(nid('a'), makeNode('a'));
    // Keep touching it so the dwell debounce never settles; maxWait must
    // eventually force the publish.
    for (let i = 0; i < 5; i++) {
      h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
      h.clock.advance(40);
    }
    h.clock.advance(200);

    const events = h.publishedEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.forced).toBe(true);
    expect(events[0]?.id).toBe(nid('a'));
  });

  it('does not mark forced for a bypassing node that was never gated', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });
    h.clock.advance(500);

    expect(h.publishedEvents()[0]?.forced).toBe(false);
  });

  it('does not mark forced when flushNow drains a node that already settled', () => {
    const h = throttledHarness({ notifyMs: 1000, dwell: { lifecycle: 50 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(200);
    // The gate opened at 50; it's the long notifyMs window still holding
    // this node. flushNow publishes it — but it did go quiet, so the
    // publish is not forced.
    h.pub.flushNow();

    expect(h.publishedEvents()[0]?.forced).toBe(false);
    expect(h.publishedEvents()[0]?.heldMs).toBe(200);
  });

  it('fires for a node that was unregistered while pending', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 100 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.truth.delete(nid('a'));
    h.clock.advance(500);

    // Publishing a deletion is publishing — otherwise this node's
    // `pending` event would be permanently unpaired.
    expect(h.publishedEvents().map((e) => e.id)).toEqual([nid('a')]);
    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();
  });

  // `removed` reaches no payload and no return value, so the trace is the
  // only place it is observable at all.
  it('marks the trace (removed) only when the node is gone from truth', () => {
    const cap = captureTrace('throttle');
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 100 } });
    h.truth.set(nid('gone'), makeNode('gone'));
    h.truth.set(nid('stays'), makeNode('stays'));
    h.pub.markDirty(nid('gone'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('stays'), { machine: 'lifecycle' });
    h.truth.delete(nid('gone'));
    h.clock.advance(500);

    expect(cap.matching(/^\[windease:throttle\] published:/)).toEqual([
      '[windease:throttle] published: gone held 100ms, 0 coalesced (removed)',
      '[windease:throttle] published: stays held 100ms, 0 coalesced',
    ]);
  });

  it('emits before notify, with the published view already updated', () => {
    // The shared harness records events for later inspection, which can't
    // observe ordering. This one samples state *inside* the callback.
    // Referencing `pub` from the callback is safe: it only ever runs
    // during a flush, long after the const is initialized.
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    let notifies = 0;
    let notifiesAtEmit = -1;
    let publishedAtEmit = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 50 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {
        notifies++;
      },
      onPublished: () => {
        notifiesAtEmit = notifies;
        publishedAtEmit = pub.nodes.has(nid('a'));
      },
    });

    truth.set(nid('a'), makeNode('a'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    clock.advance(500);

    expect(publishedAtEmit).toBe(true);
    expect(notifiesAtEmit).toBe(0);
    expect(notifies).toBe(1);
  });

  it('pairs one published event with each pending event under churn', () => {
    const h = throttledHarness({ notifyMs: 10, dwell: { lifecycle: 40 }, maxWaitMs: 120 });
    for (let i = 0; i < 6; i++) h.truth.set(nid(`n${i}`), makeNode(`n${i}`));

    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 6; i++) h.pub.markDirty(nid(`n${i}`), { machine: 'lifecycle' });
      h.clock.advance(25);
    }
    h.clock.advance(2000);

    const open = new Set<NodeId>();
    let unbalanced = 0;
    for (const e of h.events) {
      if (e.kind === 'pending') {
        if (open.has(e.payload.id)) unbalanced++;
        open.add(e.payload.id);
      } else {
        if (!open.delete(e.payload.id)) unbalanced++;
      }
    }
    expect(unbalanced).toBe(0);
    expect([...open]).toEqual([]);
  });

  it('survives a listener that re-enters flush during the same wave', () => {
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    const published: NodeId[] = [];
    let reentered = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32 },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPublished: (p) => {
        published.push(p.id);
        // "When a lands, flush the rest" — a plausible consumer
        // coordination pattern, and one that drains entries the outer
        // wave loop is still iterating over.
        if (!reentered) {
          reentered = true;
          pub.flushNow();
        }
      },
    });

    truth.set(nid('a'), makeNode('a'));
    truth.set(nid('b'), makeNode('b'));
    pub.markDirty(nid('a'));
    pub.markDirty(nid('b'));
    clock.advance(100);

    expect(published.filter((id) => id === nid('a'))).toHaveLength(1);
    expect(published.filter((id) => id === nid('b'))).toHaveLength(1);
  });
});

describe('Publisher — reset drains pending', () => {
  it('emits a published event for every dropped entry', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('b'), { machine: 'lifecycle' });
    h.clock.advance(30);

    h.pub.reset();

    const published = h.publishedEvents();
    expect(published.map((e) => e.id)).toEqual([nid('a'), nid('b')]);
    expect(published.every((e) => e.heldMs === 30)).toBe(true);
    // Both were still dwelling at 30ms into a 150ms gate.
    expect(published.every((e) => e.forced)).toBe(true);
    expect(h.pub.getPending(nid('a'))).toBeNull();
  });

  it('does not mark forced when the drained node had already settled', () => {
    const h = throttledHarness({ notifyMs: 1000, dwell: { lifecycle: 50 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(200);
    // Gate opened at 50; the long notifyMs window is what still holds it.
    h.pub.reset();

    expect(h.publishedEvents()[0]?.forced).toBe(false);
  });

  it('emits nothing when there was nothing pending', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.pub.reset();
    expect(h.publishedEvents()).toEqual([]);
  });

  it('leaves the pending set balanced across a reset', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.reset();

    const open = new Set<NodeId>();
    for (const e of h.events) {
      if (e.kind === 'pending') open.add(e.payload.id);
      else open.delete(e.payload.id);
    }
    expect([...open]).toEqual([]);
  });

  it('keeps an entry created by a listener during the drain', () => {
    // The drain captures ids up front, then deletes and emits per id, one
    // at a time. A listener's markDirty here creates a fresh entry for an
    // id outside that captured snapshot, so it isn't touched by the drain
    // loop at all — nothing left to wipe it.
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    const pending: NodeId[] = [];
    const published: NodeId[] = [];
    let reentered = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 150 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPending: (p) => {
        pending.push(p.id);
      },
      onPublished: (p) => {
        published.push(p.id);
        if (!reentered) {
          reentered = true;
          pub.markDirty(nid('b'), { machine: 'lifecycle' });
        }
      },
    });

    truth.set(nid('a'), makeNode('a'));
    truth.set(nid('b'), makeNode('b'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    pub.reset();

    expect(pending).toEqual([nid('a'), nid('b')]);
    expect(published).toEqual([nid('a')]);
    // `b`'s entry must have survived the drain — it is still withheld,
    // and will get its own `published` later.
    expect(pub.getPending(nid('b'))).not.toBeNull();
  });

  it('lets a listener re-dirty an id still queued to drain without unpairing it', () => {
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    const log: string[] = [];
    let reentered = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 150 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPending: (p) => log.push(`p:${p.id}`),
      onPublished: (p) => {
        log.push(`P:${p.id}`);
        if (!reentered) {
          reentered = true;
          pub.markDirty(nid('b'), { machine: 'lifecycle' });
        }
      },
    });

    truth.set(nid('a'), makeNode('a'));
    truth.set(nid('b'), makeNode('b'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    pub.markDirty(nid('b'), { machine: 'lifecycle' });
    pub.reset();

    // `b` was still queued to drain, so the re-dirty coalesced into its
    // existing entry — no second `pending`, and a withheld-set built from
    // this log ends empty AND correct.
    expect(log).toEqual(['p:a', 'p:b', 'P:a', 'P:b']);
    expect(pub.getPending(nid('b'))).toBeNull();
  });

  it('has already resynced the published view when the drain emits', () => {
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    let seenInPublished = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 150 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPublished: (p) => {
        seenInPublished = pub.nodes.get(p.id) !== undefined;
      },
    });

    truth.set(nid('a'), makeNode('a'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(pub.nodes.get(nid('a'))).toBeUndefined();
    pub.reset();

    // Emitting before the resync would show this listener an absent node.
    expect(seenInPublished).toBe(true);
  });

  it('stamps every drained entry with a single clock read', () => {
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    const held: number[] = [];
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 1000, dwell: { lifecycle: 150 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPublished: (p) => {
        held.push(p.heldMs);
        clock.advance(100);
      },
    });

    truth.set(nid('a'), makeNode('a'));
    truth.set(nid('b'), makeNode('b'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    pub.markDirty(nid('b'), { machine: 'lifecycle' });
    clock.advance(30);
    pub.reset();

    // A listener burning clock time must not inflate later entries —
    // the drain reads the clock once, up front.
    expect(held).toEqual([30, 30]);
  });

  it('publishes a truth change a listener makes during the drain', () => {
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    let reentered = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 150 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPublished: (p) => {
        if (reentered || p.id !== nid('a')) return;
        reentered = true;
        // Mutate truth for an id still queued to drain. The wholesale
        // resync already ran, so only the per-id sync in the drain loop
        // can carry this through. A fresh makeNode('b') call keeps the
        // `id` field matching the map key while giving the record a new
        // identity — that's the "truth mutation" being tested.
        truth.set(nid('b'), makeNode('b'));
        pub.markDirty(nid('b'), { machine: 'lifecycle' });
      },
    });

    truth.set(nid('a'), makeNode('a'));
    truth.set(nid('b'), makeNode('b'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    pub.markDirty(nid('b'), { machine: 'lifecycle' });
    pub.reset();

    // Nothing is left pending to heal a miss, so the published view must
    // already agree with truth.
    expect(pub.getPending(nid('b'))).toBeNull();
    expect(pub.nodes.get(nid('b'))).toBe(truth.get(nid('b')));
  });

  it('lets a listener re-dirty the id whose published it is handling', () => {
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    const log: string[] = [];
    let reentered = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 150 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {},
      onPending: (p) => log.push(`p:${p.id}`),
      onPublished: (p) => {
        log.push(`P:${p.id}`);
        if (reentered) return;
        reentered = true;
        truth.set(nid('a'), makeNode('a'));
        pub.markDirty(nid('a'), { machine: 'lifecycle' });
      },
    });

    const first = makeNode('a');
    truth.set(nid('a'), first);
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    pub.reset();

    // The entry is already gone when the listener runs, so the re-dirty
    // opens a genuinely new episode with its own `pending` rather than
    // coalescing into an entry about to be destroyed.
    expect(log).toEqual(['p:a', 'P:a', 'p:a']);
    expect(pub.getPending(nid('a'))).not.toBeNull();
    expect(pub.nodes.get(nid('a'))).toBe(first);
  });
});
