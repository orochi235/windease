import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, type LayoutStrategy, type Rect, Store } from '../index.js';
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

const SQUARE: Rect = { x: 0, y: 0, w: 100, h: 100 };

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
    e.addDropTarget(asNodeId('z2'), at(SQUARE, { canAccept: () => false }));
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
      e.addDropTarget(asNodeId('z1'), at({ x: 0, y: 0, w: 100, h: 100 }));
      e.addDropTarget(asNodeId('z2'), at({ x: 200, y: 0, w: 100, h: 100 }));
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
      e.addDropTarget(asNodeId('z2'), at({ x: 200, y: 0, w: 100, h: 100 }));
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
      e.addDropTarget(asNodeId('z2'), at({ x: 200, y: 0, w: 100, h: 100 }));
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
