import { describe, expect, it } from 'vitest';
import { type CollapsePolicy, collapse } from '../collapse.js';
import { asNodeId, createNode, type Rect, Store } from '../index.js';
import { DragEngine } from './DragEngine.js';

const ROOT = asNodeId('root');
const SIDE = asNodeId('side');
const MAIN = asNodeId('main');
const DOC = asNodeId('doc');

const MAIN_RECT: Rect = { x: 0, y: 0, z: 0, w: 400, h: 300 };
/** Where `side` sits when it is shut: a line down the left edge of `main`. */
const SHUT_RECT: Rect = { x: 0, y: 0, z: 0, w: 0, h: 300 };

/** root ▸ [side (empty), main ▸ [doc]]. */
function scene(policy?: CollapsePolicy, sideConfig: Record<string, unknown> = {}) {
  const store = new Store(policy ? { collapsePolicy: policy } : {});
  store.registerNode(
    createNode({ kind: 'zone', id: ROOT, container: { strategyId: 'strip', config: {} } }),
  );
  store.registerNode(
    createNode({
      kind: 'group',
      id: SIDE,
      parentId: ROOT,
      container: { strategyId: 'strip', config: sideConfig },
    }),
  );
  store.registerNode(
    createNode({
      kind: 'group',
      id: MAIN,
      parentId: ROOT,
      container: { strategyId: 'strip', config: {} },
    }),
  );
  store.registerNode(createNode({ kind: 'panel', focus: true, id: DOC, parentId: MAIN }));
  for (const id of [ROOT, SIDE, MAIN, DOC]) store.showNode(id);
  const engine = new DragEngine(store);
  engine.addDropTarget(MAIN, { bounds: () => MAIN_RECT });
  // Deeper than `main`, so it wins any point the two share.
  engine.addDropTarget(SIDE, { bounds: () => SHUT_RECT, depth: () => 1 });
  return { store, engine };
}

describe('DragEngine with a collapse policy', () => {
  it('describes no drag until one begins, and none once it ends', () => {
    const { engine } = scene(collapse());
    expect(engine.collapseDrag()).toBeNull();
    engine.tryBegin(DOC);
    expect(engine.collapseDrag()?.ids).toEqual([DOC]);
    engine.cancel();
    expect(engine.collapseDrag()).toBeNull();
  });

  it('describes one drag with one object, so a host can compare by identity', () => {
    const { engine } = scene(collapse());
    engine.tryBegin(DOC);
    const drag = engine.collapseDrag();
    engine.updateHoverByPoint(200, 100);
    expect(engine.collapseDrag()).toBe(drag);
  });

  it('says whether a container would take the drag', () => {
    const { engine } = scene(collapse());
    engine.tryBegin(DOC);
    expect(engine.collapseDrag()?.accepts(SIDE)).toBe(true);
  });

  it('says a container that refuses drops would not', () => {
    const { engine } = scene(collapse(), { accepts: false });
    engine.tryBegin(DOC);
    expect(engine.collapseDrag()?.accepts(SIDE)).toBe(false);
  });

  it('hovers a zero-width target on its line with no policy', () => {
    const { engine } = scene();
    engine.tryBegin(DOC);
    engine.updateHoverByPoint(0, 100);
    expect(engine.state()?.hover?.targetId).toBe(SIDE);
  });

  it('passes over a container collapsed to nothing', () => {
    const { engine } = scene(collapse());
    engine.tryBegin(DOC);
    engine.updateHoverByPoint(0, 100);
    expect(engine.state()?.hover?.targetId).toBe(MAIN);
  });

  it('hovers a container the policy opened for this drag', () => {
    const { engine } = scene(collapse({ dragTo: 200 }));
    engine.tryBegin(DOC);
    engine.updateHoverByPoint(0, 100);
    expect(engine.state()?.hover?.targetId).toBe(SIDE);
  });
});
