import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, type LayoutStrategy, type Rect, Store } from '../index.js';
import { captureTrace } from '../test-utils/capture-trace.js';
import { DragEngine, type DropTarget, type FrameScheduler } from './DragEngine.js';

/** Refuses anything but exactly 2 items. */
const exactlyTwoStrategy: LayoutStrategy<unknown, string, unknown> = {
  name: 'exactly-two',
  canAccept: (items) => items.length <= 2,
  layout: () => ({ placements: new Map(), affordances: [] }),
};

function zone(store: Store, id: string, strategyId = 'stack'): void {
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId, config: {} }, id: asNodeId(id) }),
  );
}

function panel(store: Store, id: string, parent: string): void {
  store.registerNode(
    createNode({ kind: 'panel', focus: true, id: asNodeId(id), parentId: asNodeId(parent) }),
  );
}

/** Two zones, one panel in the first. */
function buildStore(): Store {
  const s = new Store();
  zone(s, 'z1');
  zone(s, 'z2');
  panel(s, 'p', 'z1');
  return s;
}

function at(rect: Rect, extra: Partial<DropTarget> = {}): DropTarget {
  return { bounds: () => rect, ...extra };
}

const SQUARE: Rect = { x: 0, y: 0, z: 0, w: 100, h: 100 };

describe('DragEngine', () => {
  it('hovers the target whose bounds contain the point', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover).toEqual({ targetId: 'z2', accepted: true });
  });

  it('leaves hover null outside every target, and still tracks the cursor', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(500, 500);
    expect(e.state()?.hover).toBeNull();
    expect(e.state()?.cursor).toEqual({ x: 500, y: 500 });
  });

  it('gives an overlap to the deepest target', () => {
    const s = buildStore();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('inner'),
        parentId: asNodeId('z2'),
      }),
    );
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE, { depth: () => 2 }));
    e.addDropTarget(asNodeId('inner'), at(SQUARE, { depth: () => 5 }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.targetId).toBe('inner');
  });

  it('skips a target that has no geometry yet', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), { bounds: () => null });
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover).toBeNull();
  });

  it('rejects a hover the target lock refuses', () => {
    const s = buildStore();
    s.setLock(asNodeId('z2'), { accept: true });
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it("rejects a hover the strategy can't lay out", () => {
    const s = new Store();
    zone(s, 'z1');
    zone(s, 'z2', 'exactly-two');
    panel(s, 'a', 'z2');
    panel(s, 'b', 'z2');
    panel(s, 'p', 'z1');
    const e = new DragEngine(s, {
      getStrategy: (id) => (id === 'exactly-two' ? exactlyTwoStrategy : undefined),
    });
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('rejects a hover the consumer refuses', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE, { acceptPolicy: () => false }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('drops into the hovered target at the offered index', () => {
    const s = buildStore();
    panel(s, 'a', 'z2');
    panel(s, 'b', 'z2');
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE, { getInsertionIndex: () => 1 }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['a', 'p', 'b']);
    expect(e.state()).toBeNull();
  });

  it('a drop over nothing cancels instead of moving', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.tryBegin(asNodeId('p'));
    e.drop();
    expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
    expect(e.state()).toBeNull();
  });

  it('refuses a second drag while one is active', () => {
    const s = buildStore();
    panel(s, 'q', 'z1');
    const e = new DragEngine(s);
    expect(e.tryBegin(asNodeId('p'))).toBe(true);
    expect(e.tryBegin(asNodeId('q'))).toBe(false);
  });

  it('coalesces samples through the injected scheduler', () => {
    const s = buildStore();
    const queue: Array<() => void> = [];
    const schedule: FrameScheduler = {
      request(cb) {
        queue.push(cb);
        return queue.length;
      },
      cancel(handle) {
        queue[handle - 1] = () => {};
      },
    };
    const e = new DragEngine(s, { schedule });
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    const listener = vi.fn();
    e.subscribe(listener);

    e.updateHoverByPoint(10, 10);
    e.updateHoverByPoint(20, 20);
    e.updateHoverByPoint(30, 30);
    expect(queue.length).toBe(1);
    expect(listener).not.toHaveBeenCalled();

    for (const cb of queue.splice(0)) cb();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(e.state()?.cursor).toEqual({ x: 30, y: 30 });
  });

  it('drops a pending sample when the drag ends', () => {
    const s = buildStore();
    const queue: Array<() => void> = [];
    const schedule: FrameScheduler = {
      request(cb) {
        queue.push(cb);
        return queue.length;
      },
      cancel(handle) {
        queue[handle - 1] = () => {};
      },
    };
    const e = new DragEngine(s, { schedule });
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.cancel('escape');
    for (const cb of queue.splice(0)) cb();
    expect(e.state()).toBeNull();
    expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
  });

  /** The last pointermove before the release usually lands in the same frame
   *  as the pointerup, so its sample is still pending when `drop` runs.
   *  Discarding it resolves the drop against wherever the cursor was one
   *  frame earlier — a different zone entirely on a fast drag. */
  describe('a pending sample at release', () => {
    function deferred() {
      const queue: Array<() => void> = [];
      const schedule: FrameScheduler = {
        request(cb) {
          queue.push(cb);
          return queue.length;
        },
        cancel(handle) {
          queue[handle - 1] = () => {};
        },
      };
      return { queue, schedule };
    }

    it('drops where the cursor was released, not where the last frame sampled', () => {
      const s = buildStore();
      const { queue, schedule } = deferred();
      const e = new DragEngine(s, { schedule });
      e.addDropTarget(asNodeId('z1'), at({ x: 0, y: 0, z: 0, w: 100, h: 100 }));
      e.addDropTarget(asNodeId('z2'), at({ x: 200, y: 0, z: 0, w: 100, h: 100 }));
      e.tryBegin(asNodeId('p'));

      e.updateHoverByPoint(50, 50);
      for (const cb of queue.splice(0)) cb();
      expect(e.state()?.hover?.targetId).toBe('z1');

      // Released over z2, with the sample for it still queued.
      e.updateHoverByPoint(250, 50);
      e.drop();

      expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['p']);
      expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual([]);
    });

    it('refuses a release outside every target even though hover was over one', () => {
      const s = buildStore();
      const { queue, schedule } = deferred();
      const e = new DragEngine(s, { schedule });
      e.addDropTarget(asNodeId('z2'), at({ x: 200, y: 0, z: 0, w: 100, h: 100 }));
      e.tryBegin(asNodeId('p'));

      e.updateHoverByPoint(250, 50);
      for (const cb of queue.splice(0)) cb();
      expect(e.state()?.hover?.targetId).toBe('z2');

      e.updateHoverByPoint(900, 900);
      e.drop();

      expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
      expect(e.state()).toBeNull();
    });

    it('runs the flushed sample once, not again on the next frame', () => {
      const s = buildStore();
      const { queue, schedule } = deferred();
      const e = new DragEngine(s, { schedule });
      e.addDropTarget(asNodeId('z2'), at({ x: 200, y: 0, z: 0, w: 100, h: 100 }));
      e.tryBegin(asNodeId('p'));

      e.updateHoverByPoint(250, 50);
      e.drop();
      for (const cb of queue.splice(0)) cb();

      expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['p']);
      expect(e.state()).toBeNull();
    });
  });

  it('unregistering a target takes it out of the hit test', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    const off = e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.targetId).toBe('z2');
    off();
    e.updateHoverByPoint(51, 51);
    expect(e.state()?.hover).toBeNull();
  });
});

/** Holds hover samples until `run()`, as an animation frame would. */
function heldFrames(): FrameScheduler & { run(): void } {
  const frames: (() => void)[] = [];
  return {
    request(cb) {
      frames.push(cb);
      return frames.length;
    },
    cancel() {
      frames.length = 0;
    },
    run() {
      for (const cb of frames.splice(0)) cb();
    },
  };
}

describe('DragEngine — a hovered target that goes away', () => {
  it('re-samples at the cursor, so the hover leaves it', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    const off = e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    off();
    expect(e.state()?.hover).toBeNull();
    e.drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual([]);
  });

  it('cancels as unregistered on a drop before the re-sample runs', () => {
    const log = captureTrace('dnd');
    const s = buildStore();
    const frames = heldFrames();
    const e = new DragEngine(s, { schedule: frames });
    const off = e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    frames.run();
    expect(e.state()?.hover?.accepted).toBe(true);
    off();
    e.drop();
    expect(e.state()).toBeNull();
    expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
    expect(log.matching(/cancel \(unregistered\)/)).toHaveLength(1);
  });

  it('still drops on a target that re-registered in the same frame', () => {
    const s = buildStore();
    const frames = heldFrames();
    const e = new DragEngine(s, { schedule: frames });
    const off = e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    frames.run();
    off();
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['p']);
  });

  it('keeps a newer queued pointer sample over the cursor it re-samples at', () => {
    const s = buildStore();
    const frames = heldFrames();
    const e = new DragEngine(s, { schedule: frames });
    const off = e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    frames.run();
    e.updateHoverByPoint(70, 70);
    off();
    frames.run();
    expect(e.state()?.cursor).toEqual({ x: 70, y: 70 });
  });
});

describe('DragEngine — drop re-checks the verdict', () => {
  it('refuses a drop the target stopped accepting since the last sample', () => {
    const log = captureTrace('dnd');
    const s = buildStore();
    s.updateContainerConfig(asNodeId('z2'), { accepts: { max: 1 } });
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
    panel(s, 'q', 'z2');
    e.drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['q']);
    expect(log.matching(/cancel \(rejected\)/)).toHaveLength(1);
  });

  it('refuses a drop onto a target lock.accept now refuses', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    s.setLock(asNodeId('z2'), { accept: true });
    e.drop();
    expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
  });
});

describe('DragEngine — a seam among hidden children', () => {
  /** z2 holds `h` (hidden), `a`, `b`, and `m` (never shown) between them. */
  function withHidden(): Store {
    const s = buildStore();
    for (const id of ['h', 'a', 'm', 'b']) panel(s, id, 'z2');
    for (const id of ['h', 'a', 'b', 'p']) s.showNode(asNodeId(id));
    s.hideNode(asNodeId('h'));
    return s;
  }

  function dropAt(s: Store, source: string, seam: number, onto = 'z2'): DragEngine {
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId(onto), at(SQUARE, { getInsertionIndex: () => seam }));
    e.tryBegin(asNodeId(source));
    e.updateHoverByPoint(50, 50);
    return e;
  }

  it('reports the seam on hover as the rendered children count it', () => {
    expect(dropAt(withHidden(), 'p', 2).state()?.hover?.insertIndex).toBe(2);
  });

  it('lands a drop after the last rendered child there', () => {
    const s = withHidden();
    dropAt(s, 'p', 2).drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['h', 'a', 'm', 'b', 'p']);
  });

  it('lands a drop before a rendered child just before it', () => {
    const s = withHidden();
    dropAt(s, 'p', 1).drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['h', 'a', 'm', 'p', 'b']);
  });

  it('counts a reorder without the source', () => {
    const s = withHidden();
    dropAt(s, 'a', 1).drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['h', 'm', 'b', 'a']);
  });

  it('hands a controlled parent the same order', () => {
    const s = withHidden();
    const e = dropAt(s, 'p', 2);
    const commit = vi.fn();
    e.registerOrderControl(asNodeId('z2'), commit);
    e.drop();
    expect(commit.mock.calls[0]?.[0]).toEqual(['h', 'a', 'm', 'b', 'p']);
  });

  it('reports a pinned slot in rendered children too', () => {
    const s = withHidden();
    s.setPinned(asNodeId('a'), 1);
    // Rendered: a, b. Seam 0 asks for before a, which holds its slot.
    const e = dropAt(s, 'p', 0);
    expect(e.state()?.hover?.insertIndex).toBe(1);
    e.drop();
    const order = s.getContainerView(asNodeId('z2'))?.childOrder;
    expect(order?.indexOf(asNodeId('a'))).toBe(1);
    expect(order?.filter((id) => id !== 'h' && id !== 'm')).toEqual(['a', 'p', 'b']);
  });
});

describe('DragEngine — auto-scroll', () => {
  function scrolling(box: Rect, extra?: Partial<DropTarget>) {
    const by = vi.fn();
    const target = at(SQUARE, {
      scroll: { bounds: () => box, by, options: { margin: 20, maxRate: 8 } },
      ...extra,
    });
    return { target, by };
  }

  it('scrolls the box when the cursor nears its edge', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    const { target, by } = scrolling(SQUARE);
    e.addDropTarget(asNodeId('z1'), target);
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(2, 50);
    expect(by).toHaveBeenCalled();
    expect(by.mock.calls[0]?.[0]).toBeLessThan(0);
  });

  it('leaves the box alone in the middle', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    const { target, by } = scrolling(SQUARE);
    e.addDropTarget(asNodeId('z1'), target);
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(by).not.toHaveBeenCalled();
  });

  it('does nothing for a target with no scrolling box', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z1'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    expect(() => e.updateHoverByPoint(2, 50)).not.toThrow();
  });

  it('keeps going while the cursor is held still at the edge', () => {
    const s = buildStore();
    const frames: (() => void)[] = [];
    const deferred: FrameScheduler = {
      request(cb) {
        frames.push(cb);
        return frames.length;
      },
      cancel() {
        frames.length = 0;
      },
    };
    const e = new DragEngine(s, { schedule: deferred });
    const { target, by } = scrolling(SQUARE);
    e.addDropTarget(asNodeId('z1'), target);
    e.tryBegin(asNodeId('p'));

    e.updateHoverByPoint(2, 50);
    for (let i = 0; i < 3; i++) frames.shift()?.();
    // One per frame, with no further pointer input.
    expect(by.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not recurse under an inline scheduler', () => {
    const s = buildStore();
    const e = new DragEngine(s);
    const { target, by } = scrolling(SQUARE);
    e.addDropTarget(asNodeId('z1'), target);
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(2, 50);
    // One real sample plus the single re-entrant step the guard allows.
    expect(by.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
