import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, type LayoutStrategy, type Rect, Store } from '../index.js';
import { type AcceptContext, DragEngine, type DropTarget } from './DragEngine.js';

/** Refuses anything past 2 items — stands in for a strip at its maxItems cap. */
const exactlyTwoStrategy: LayoutStrategy<unknown, string, unknown> = {
  name: 'exactly-two',
  canAccept: (items) => items.length <= 2,
  layout: () => ({ placements: new Map(), affordances: [] }),
};

const SQUARE: Rect = { x: 0, y: 0, w: 100, h: 100 };

function at(rect: Rect, extra: Partial<DropTarget> = {}): DropTarget {
  return { bounds: () => rect, ...extra };
}

/** z2 already holds two panels, so the strategy refuses a third. */
function fullStore(): Store {
  const s = new Store();
  for (const z of ['z1', 'z2']) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'exactly-two', config: {} },
        id: asNodeId(z),
      }),
    );
  }
  for (const [p, parent] of [
    ['p', 'z1'],
    ['a', 'z2'],
    ['b', 'z2'],
  ] as const) {
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId(p), parentId: asNodeId(parent) }),
    );
  }
  return s;
}

function engineWith(s: Store, target: Partial<DropTarget>): DragEngine {
  const e = new DragEngine(s, { getStrategy: () => exactlyTwoStrategy });
  e.addDropTarget(asNodeId('z2'), at(SQUARE, target));
  e.tryBegin(asNodeId('p'));
  e.updateHoverByPoint(50, 50);
  return e;
}

describe('DragEngine — acceptPolicy', () => {
  it('true overrides a strategy rejection', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('undefined defers to the strategy, which refuses', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => undefined });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('false rejects even where the strategy would accept', () => {
    const s = new Store();
    for (const z of ['z1', 'z2']) {
      s.registerNode(
        createNode({
          kind: 'zone',
          container: { strategyId: 'exactly-two', config: {} },
          id: asNodeId(z),
        }),
      );
    }
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z1') }),
    );
    const e = engineWith(s, { acceptPolicy: () => false });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('sees the prospective post-drop child list and the container config', () => {
    const seen: AcceptContext[] = [];
    engineWith(fullStore(), {
      acceptPolicy: (ctx) => {
        seen.push(ctx);
        return true;
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.items.map((i) => i.id)).toEqual(['a', 'b', 'p']);
    expect(seen[0]?.sourceId).toBe('p');
    expect(seen[0]?.options).toEqual({});
  });

  it('lock.accept still refuses, whatever the policy says', () => {
    const s = fullStore();
    s.setLock(asNodeId('z2'), { accept: true });
    const e = engineWith(s, { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('the deprecated canAccept still vetoes after the policy accepted', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => true, canAccept: () => false });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('a policy that throws defers to the strategy instead of killing the drag', () => {
    const e = engineWith(fullStore(), {
      acceptPolicy: () => {
        throw new Error('boom');
      },
    });
    // fullStore's z2 is at the exactly-two cap, so the strategy refuses.
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('builds no prospective child list when nothing will read it', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z1'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z2'),
      }),
    );
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z1') }),
    );
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    // Spy after tryBegin: the begin path calls getChildren itself, so a spy
    // installed earlier is already dirty by the time the hover runs.
    const spy = vi.spyOn(s, 'getChildren');
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
