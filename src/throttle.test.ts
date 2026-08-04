import { describe, expect, it } from 'vitest';
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { Node, NodeId } from './node.js';
import { FakeClock } from './test-utils/fake-clock.js';
import { Publisher, systemClock } from './throttle.js';

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
