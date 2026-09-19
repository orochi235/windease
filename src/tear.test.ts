import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  CycleError,
  createNode,
  desktopStrategy,
  type FloatingState,
  floatingStrategy,
  InvariantViolationError,
  LockedError,
  type NodeId,
  runStrategyForContainer,
  Store,
  stackStrategy,
  stripStrategy,
} from './index.js';
import { dockNode, floatAncestor, floatNode } from './tear.js';

const floating = floatingStrategy(stripStrategy);
const desktop = desktopStrategy();
const STRATEGIES: Record<string, unknown> = {
  'floating-strip': floating,
  desktop,
  stack: stackStrategy,
  strip: stripStrategy,
};
const lookup = (id: string) => STRATEGIES[id] as never;

const id = asNodeId;
const ROOT = id('root');
const STACK = id('stack');

/** root (`rootStrategy`) → stack (tear) → a, b. */
function makeStore(rootStrategy = 'floating-strip'): Store {
  const s = new Store();
  s.registerNode(
    createNode({ id: ROOT, kind: 'zone', container: { strategyId: rootStrategy, config: {} } }),
  );
  s.registerNode(
    createNode({
      id: STACK,
      kind: 'group',
      parentId: ROOT,
      container: { strategyId: 'stack', config: { tear: 'float', headerSize: 20 } },
    }),
  );
  s.showNode(STACK);
  for (const t of ['a', 'b']) {
    s.registerNode(createNode({ id: id(t), kind: 'panel', focus: true, parentId: STACK }));
    s.showNode(id(t));
  }
  return s;
}

function txnCount(s: Store): () => number {
  let n = 0;
  s.events.on('transaction.begin', () => {
    n += 1;
  });
  return () => n;
}

describe('floatNode', () => {
  it('floats a tab in a floating container at the point, keeping the position in state', () => {
    const s = makeStore();
    floatNode(s, floating as never, id('a'), ROOT, {
      at: { x: 40, y: 50 },
      size: { w: 120, h: 90 },
    });

    expect(s.getParent(id('a'))?.id).toBe(ROOT);
    expect(s.getPlacement(id('a')).floating).toBe(true);
    expect(s.getNode(id('a'))?.hints?.preferredSize).toEqual({ w: 120, h: 90 });
    const state = s.getContainerState(ROOT) as FloatingState;
    expect(state.at.a).toEqual({ x: 40, y: 50, anchor: null });

    const result = runStrategyForContainer(s, ROOT, { w: 400, h: 300 }, floating, state as never);
    expect(result.placements.get(id('a'))).toMatchObject({ x: 40, y: 50, w: 120, h: 90 });
  });

  it('floats a tab in a desktop at placement x / y', () => {
    const s = makeStore('desktop');
    floatNode(s, desktop as never, id('a'), ROOT, {
      at: { x: 30, y: 60 },
      size: { w: 100, h: 80 },
    });

    expect(s.getPlacement(id('a'))).toMatchObject({ x: 30, y: 60 });
    expect(s.getContainerState(ROOT)).toBeUndefined();
    const result = runStrategyForContainer(s, ROOT, { w: 400, h: 300 }, desktop, {
      inner: undefined,
    });
    expect(result.placements.get(id('a'))).toMatchObject({ x: 30, y: 60, w: 100, h: 80 });
  });

  it('is one transaction, with one move', () => {
    const s = makeStore();
    const txns = txnCount(s);
    let moves = 0;
    s.events.on('node.moved', () => {
      moves += 1;
    });
    floatNode(s, floating as never, id('a'), ROOT, { at: { x: 0, y: 0 } });
    expect(txns()).toBe(1);
    expect(moves).toBe(1);
  });

  it('leaves hints alone when no size is given', () => {
    const s = makeStore();
    floatNode(s, floating as never, id('a'), ROOT, { at: { x: 0, y: 0 } });
    expect(s.getNode(id('a'))?.hints?.preferredSize).toBeUndefined();
  });

  it('refuses a parent locked against arrange before writing anything', () => {
    const s = makeStore();
    s.setLock(ROOT, { arrange: true });
    expect(() => floatNode(s, floating as never, id('a'), ROOT, { at: { x: 5, y: 5 } })).toThrow(
      LockedError,
    );
    expect(s.getParent(id('a'))?.id).toBe(STACK);
    expect(s.getPlacement(id('a')).floating).toBeUndefined();
    expect(s.getContainerState(ROOT)).toBeUndefined();
  });

  it('refuses a strategy that does not float children', () => {
    const s = makeStore();
    expect(() =>
      floatNode(s, stripStrategy as never, id('a'), ROOT, { at: { x: 0, y: 0 } }),
    ).toThrow(InvariantViolationError);
  });

  it('refuses a move into the node itself', () => {
    const s = makeStore();
    expect(() => floatNode(s, floating as never, STACK, STACK, { at: { x: 0, y: 0 } })).toThrow(
      CycleError,
    );
  });
});

describe('dockNode', () => {
  it('moves a floating child into a stack and clears what floating wrote', () => {
    const s = makeStore();
    floatNode(s, floating as never, id('a'), ROOT, { at: { x: 10, y: 10 } });
    dockNode(s, id('a'), STACK, { at: 0, from: floating as never });

    expect(s.getNode(STACK)?.container?.childOrder).toEqual(['a', 'b']);
    expect('floating' in s.getPlacement(id('a'))).toBe(false);
  });

  it('clears x / y after a desktop', () => {
    const s = makeStore('desktop');
    floatNode(s, desktop as never, id('a'), ROOT, { at: { x: 10, y: 20 } });
    dockNode(s, id('a'), STACK, { from: desktop as never });
    expect(s.getPlacement(id('a'))).toEqual({});
  });

  it('is a plain move without a strategy to clear for', () => {
    const s = makeStore();
    floatNode(s, floating as never, id('a'), ROOT, { at: { x: 10, y: 10 } });
    const txns = txnCount(s);
    dockNode(s, id('a'), STACK);
    expect(s.getPlacement(id('a')).floating).toBe(true);
    expect(txns()).toBe(1);
  });
});

describe('floatAncestor', () => {
  it('finds the nearest container whose strategy floats', () => {
    const s = makeStore();
    expect(floatAncestor(s, lookup, STACK)).toBe(ROOT);
    expect(floatAncestor(s, lookup, id('a'))).toBe(ROOT);
  });

  it('skips containers that tile', () => {
    const s = makeStore();
    const mid: NodeId = id('mid');
    s.registerNode(
      createNode({
        id: mid,
        kind: 'group',
        parentId: ROOT,
        container: { strategyId: 'strip', config: {} },
      }),
    );
    s.moveNode(STACK, mid);
    expect(floatAncestor(s, lookup, STACK)).toBe(ROOT);
  });

  it('is null with no floating ancestor', () => {
    const s = makeStore('strip');
    expect(floatAncestor(s, lookup, STACK)).toBeNull();
  });
});
