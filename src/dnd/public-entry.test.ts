import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  createNode,
  DragController,
  DragEngine,
  insertionIndexByMidpoint,
  Store,
} from '../index.js';

/**
 * Guards the promise of the core relocation: a consumer using no framework
 * binding can drive a complete drag from the package entry point alone. Every
 * import here must come from '../index.js' — reaching into a module path or
 * into windease/react would defeat the test.
 */
function fakeElement(x: number, y: number, w: number, h: number): Element {
  return {
    getBoundingClientRect: () => ({ left: x, top: y, right: x + w, bottom: y + h }),
    setAttribute() {},
    removeAttribute() {},
    parentElement: null,
  } as unknown as Element;
}

describe('drag from the core entry point, with no binding', () => {
  it('begins, hovers, and drops a panel into another zone', async () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z1'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z2'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z1'),
      }),
    );

    const controller = new DragController(store);
    expect(controller.tryBegin(asNodeId('p'))).toBe(true);

    controller.registerDropTarget(asNodeId('z2'), fakeElement(0, 0, 100, 100));
    controller.updateHoverByPoint(50, 50);
    await new Promise((r) => setTimeout(r, 20));
    expect(controller.state()?.hover).toMatchObject({ targetId: 'z2', accepted: true });

    controller.drop();
    expect(store.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['p']);
    expect(store.getContainerView(asNodeId('z1'))?.childOrder).toEqual([]);
  });

  it('drives the same drag with no element at all', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z1'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z2'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z1'),
      }),
    );

    const engine = new DragEngine(store);
    engine.addDropTarget(asNodeId('z2'), { bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }) });
    expect(engine.tryBegin(asNodeId('p'))).toBe(true);
    engine.updateHoverByPoint(50, 50);
    expect(engine.state()?.hover).toMatchObject({ targetId: 'z2', accepted: true });
    engine.drop();
    expect(store.getContainerView(asNodeId('z2'))?.childOrder).toEqual(['p']);
  });

  it('honors lock.move without any binding in the loop', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z1'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z1'),
      }),
    );
    store.setLock(asNodeId('p'), { move: true });

    expect(new DragController(store).tryBegin(asNodeId('p'))).toBe(false);
  });

  it('exposes the insertion-index helper the drop targets need', () => {
    const rects = [
      { top: 0, bottom: 50 },
      { top: 50, bottom: 100 },
    ];
    expect(insertionIndexByMidpoint(rects, 10, 'y')).toBe(0);
    expect(insertionIndexByMidpoint(rects, 60, 'y')).toBe(1);
    expect(insertionIndexByMidpoint(rects, 90, 'y')).toBe(2);
  });
});
