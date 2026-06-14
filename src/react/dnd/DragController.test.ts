import { describe, expect, it, vi } from 'vitest';
import {
  type LayoutStrategy,
  Store,
  asNodeId,
  createPanel,
  createZone,
  splitStrategy,
} from '../../index.js';
import { DragController } from './DragController.js';

function buildStore(): Store {
  const s = new Store();
  s.registerNode(createZone({ id: asNodeId('z1'), strategyId: 'stack', config: {} }));
  s.registerNode(createZone({ id: asNodeId('z2'), strategyId: 'stack', config: {} }));
  s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z1') }));
  return s;
}

describe('DragController', () => {
  it('tryBegin succeeds for a slotted unlocked node', () => {
    const s = buildStore();
    const c = new DragController(s);
    expect(c.tryBegin(asNodeId('p'))).toBe(true);
    expect(c.state()?.draggingId).toBe('p');
  });

  it('tryBegin returns false for locked node', () => {
    const s = buildStore();
    s.patchPlacement(asNodeId('p'), { locked: true });
    const c = new DragController(s);
    expect(c.tryBegin(asNodeId('p'))).toBe(false);
  });

  it('tryBegin returns false for unslotted (root) node', () => {
    const s = buildStore();
    const c = new DragController(s);
    expect(c.tryBegin(asNodeId('z1'))).toBe(false);
  });

  it('drop moves the node to the hovered accepted target', async () => {
    const s = buildStore();
    const c = new DragController(s);
    c.tryBegin(asNodeId('p'));
    // Simulate a drop target rect at known coords
    const fake = makeFakeElement(0, 0, 100, 100);
    c.registerDropTarget(asNodeId('z2'), fake);
    c.updateHoverByPoint(50, 50);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.state()?.hover?.targetId).toBe('z2');
    c.drop();
    expect(s.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['p']);
    expect(c.state()).toBeNull();
  });

  it('cancel clears state without moving', () => {
    const s = buildStore();
    const c = new DragController(s);
    c.tryBegin(asNodeId('p'));
    c.cancel('outside');
    expect(c.state()).toBeNull();
    expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
  });

  it('tryBegin returns false when parent has allowsDragOut=false', () => {
    const s = buildStore();
    s.setAllowsDragOut(asNodeId('z1'), false);
    const c = new DragController(s);
    expect(c.tryBegin(asNodeId('p'))).toBe(false);
  });

  it('hover is rejected when target has allowsDrop=false', async () => {
    const s = buildStore();
    s.setAllowsDrop(asNodeId('z2'), false);
    const c = new DragController(s);
    c.tryBegin(asNodeId('p'));
    c.registerDropTarget(asNodeId('z2'), makeFakeElement(0, 0, 100, 100));
    c.updateHoverByPoint(50, 50);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.state()?.hover?.targetId).toBe('z2');
    expect(c.state()?.hover?.accepted).toBe(false);
    c.drop();
    // p remains in z1 because hover wasn't accepted.
    expect(s.getContainerView(asNodeId('z1'))?.childOrder).toEqual(['p']);
  });

  it("strategy canAccept rejects drops the strategy can't lay out", async () => {
    // splitStrategy with recursive:false enforces exactly 2 items; z2 already
    // has 2, drop of a third should be rejected.
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z1'), strategyId: 'stack', config: {} }));
    s.registerNode(
      createZone({ id: asNodeId('z2'), strategyId: 'split', config: { recursive: false } }),
    );
    s.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z2') }));
    s.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z2') }));
    s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z1') }));
    const getStrategy = (sid: string): LayoutStrategy<unknown, string, unknown> | undefined =>
      sid === 'split' ? (splitStrategy as never) : undefined;
    const c = new DragController(s, getStrategy);
    c.tryBegin(asNodeId('p'));
    c.registerDropTarget(asNodeId('z2'), makeFakeElement(0, 0, 100, 100));
    c.updateHoverByPoint(50, 50);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.state()?.hover?.targetId).toBe('z2');
    expect(c.state()?.hover?.accepted).toBe(false);
  });

  it('subscribers fire on state change', () => {
    const s = buildStore();
    const c = new DragController(s);
    const fn = vi.fn();
    c.subscribe(fn);
    c.tryBegin(asNodeId('p'));
    expect(fn).toHaveBeenCalled();
  });
});

describe('DragController — rAF throttle + cursor', () => {
  it('coalesces multiple updateHoverByPoint calls within one frame', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('tgt'), parentId: asNodeId('z') }));
    const controller = new DragController(store);

    const el = makeRectEl({ left: 0, top: 0, right: 100, bottom: 100 });
    controller.registerDropTarget(asNodeId('tgt'), el);
    controller.tryBegin(asNodeId('src'));

    const listener = vi.fn();
    controller.subscribe(listener);
    listener.mockClear();

    controller.updateHoverByPoint(10, 10);
    controller.updateHoverByPoint(20, 20);
    controller.updateHoverByPoint(30, 30);

    // Drain the rAF queue.
    await new Promise((r) => setTimeout(r, 20));

    // Only one hover update emitted (the latest), not three.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.state()?.cursor).toEqual({ x: 30, y: 30 });
  });

  it('cancels pending rAF on drop()', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('tgt'), parentId: asNodeId('z') }));
    const controller = new DragController(store);
    controller.registerDropTarget(
      asNodeId('tgt'),
      makeRectEl({ left: 0, top: 0, right: 100, bottom: 100 }),
    );
    controller.tryBegin(asNodeId('src'));

    controller.updateHoverByPoint(10, 10);
    controller.drop();
    await new Promise((r) => setTimeout(r, 20));
    // After drop, controller.active is null; no late hover update should
    // reintroduce state.
    expect(controller.state()).toBeNull();
  });

  it('drop() passes hover.insertIndex to moveNode', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('src-parent'), strategyId: 'stack', config: {} }));
    store.registerNode(createZone({ id: asNodeId('tgt'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('src'), parentId: asNodeId('src-parent') }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('tgt') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('tgt') }));
    const moveSpy = vi.spyOn(store, 'moveNode');
    const controller = new DragController(store);
    controller.registerDropTarget(
      asNodeId('tgt'),
      makeRectEl({ left: 0, top: 0, right: 100, bottom: 100 }),
      undefined,
      { getInsertionIndex: () => 1 },
    );
    controller.tryBegin(asNodeId('src'));
    controller.updateHoverByPoint(50, 50);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        controller.drop();
        expect(moveSpy).toHaveBeenCalledWith('src', 'tgt', 1);
        resolve();
      }, 20);
    });
  });
});

function makeRectEl(rect: { left: number; top: number; right: number; bottom: number }): Element {
  return {
    getBoundingClientRect: () => ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }),
    setAttribute() {},
    removeAttribute() {},
    parentElement: null,
  } as unknown as Element;
}

function makeFakeElement(x: number, y: number, w: number, h: number): Element {
  return {
    getBoundingClientRect: () => ({
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      width: w,
      height: h,
      x,
      y,
      toJSON: () => ({}),
    }),
    parentElement: null,
  } as unknown as Element;
}
