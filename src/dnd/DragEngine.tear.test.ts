import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  createNode,
  desktopStrategy,
  type FloatingState,
  floatingStrategy,
  type Rect,
  Store,
  stackStrategy,
  stripStrategy,
} from '../index.js';
import { DragEngine } from './DragEngine.js';

const STRATEGIES: Record<string, unknown> = {
  'floating-strip': floatingStrategy(stripStrategy),
  desktop: desktopStrategy(),
  stack: stackStrategy,
  strip: stripStrategy,
};

const id = asNodeId;
const ROOT = id('root');
const STACK = id('stack');

const ROOT_BOX: Rect = { x: 100, y: 50, z: 0, w: 600, h: 400 };
const STACK_BOX: Rect = { x: 100, y: 50, z: 0, w: 200, h: 300 };

interface Setup {
  root?: string;
  rootConfig?: Record<string, unknown>;
  stackConfig?: Record<string, unknown>;
}

/** root → stack → a, b; the stack docked at the root's left edge. */
function setup({ root = 'floating-strip', rootConfig = {}, stackConfig }: Setup = {}) {
  const s = new Store();
  s.registerNode(
    createNode({ id: ROOT, kind: 'zone', container: { strategyId: root, config: rootConfig } }),
  );
  s.registerNode(
    createNode({
      id: STACK,
      kind: 'group',
      parentId: ROOT,
      container: {
        strategyId: 'stack',
        config: stackConfig ?? { tear: 'float', headerSize: 24, padding: 4 },
      },
    }),
  );
  s.showNode(STACK);
  for (const t of ['a', 'b']) {
    s.registerNode(createNode({ id: id(t), kind: 'panel', focus: true, parentId: STACK }));
    s.showNode(id(t));
  }
  const e = new DragEngine(s, { getStrategy: (sid) => STRATEGIES[sid] as never });
  // The stack is inside the root, so it claims its own box.
  e.addDropTarget(ROOT, { bounds: () => ROOT_BOX, depth: () => 1 });
  e.addDropTarget(STACK, {
    bounds: () => STACK_BOX,
    depth: () => 2,
    getInsertionIndex: () => 0,
  });
  return { s, e };
}

function transactions(s: Store): () => number {
  let n = 0;
  s.events.on('transaction.begin', () => {
    n += 1;
  });
  return () => n;
}

describe('DragEngine — tear: float', () => {
  it('hovering the floating ancestor outside the stack is an accepted tear', () => {
    const { e } = setup();
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    expect(e.state()?.hover).toEqual({ targetId: ROOT, accepted: true, tear: true });
  });

  it('hovering the stack itself is an ordinary reorder, not a tear', () => {
    const { e } = setup();
    e.tryBegin(id('a'));
    e.updateHoverByPoint(150, 100);
    expect(e.state()?.hover?.targetId).toBe(STACK);
    expect(e.state()?.hover?.tear).toBeUndefined();
  });

  it('a drop floats the tab at the cursor, at the size of the stack body', () => {
    const { s, e } = setup();
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    e.drop();

    expect(s.getParent(id('a'))?.id).toBe(ROOT);
    expect(s.getPlacement(id('a')).floating).toBe(true);
    const state = s.getContainerState(ROOT) as FloatingState;
    expect(state.at.a).toEqual({ x: 400, y: 150, anchor: null });
    // 200x300 less 4px padding each side and the 24px header.
    expect(s.getNode(id('a'))?.hints?.preferredSize).toEqual({ w: 192, h: 268 });
    expect(e.state()).toBeNull();
  });

  it('a configured tearSize wins over the body size', () => {
    const { s, e } = setup({ stackConfig: { tear: 'float', tearSize: { w: 240, h: 160 } } });
    e.tryBegin(id('b'));
    e.updateHoverByPoint(500, 200);
    e.drop();
    expect(s.getNode(id('b'))?.hints?.preferredSize).toEqual({ w: 240, h: 160 });
  });

  it('a desktop ancestor takes the tab at placement x / y', () => {
    const { s, e } = setup({ root: 'desktop' });
    e.tryBegin(id('a'));
    e.updateHoverByPoint(400, 300);
    e.drop();
    expect(s.getParent(id('a'))?.id).toBe(ROOT);
    expect(s.getPlacement(id('a'))).toMatchObject({ x: 300, y: 250 });
    expect(s.getContainerState(ROOT)).toBeUndefined();
  });

  it('is one undoable step', () => {
    const { s, e } = setup();
    const txns = transactions(s);
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    e.drop();
    expect(txns()).toBe(1);
  });

  it('without tear, the same drop is an ordinary move that tiles the tab', () => {
    const { s, e } = setup({ stackConfig: { headerSize: 24 } });
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    expect(e.state()?.hover?.tear).toBeUndefined();
    e.drop();
    expect(s.getParent(id('a'))?.id).toBe(ROOT);
    expect(s.getPlacement(id('a')).floating).toBeUndefined();
  });

  it('only the nearest floating ancestor tears', () => {
    const { s, e } = setup();
    const inner = id('inner');
    s.registerNode(
      createNode({
        id: inner,
        kind: 'group',
        parentId: ROOT,
        container: { strategyId: 'floating-strip', config: {} },
      }),
    );
    s.showNode(inner);
    s.moveNode(STACK, inner);
    e.addDropTarget(inner, { bounds: () => ({ ...ROOT_BOX, w: 300 }), depth: () => 1.5 });

    e.tryBegin(id('a'));
    e.updateHoverByPoint(650, 200);
    expect(e.state()?.hover).toMatchObject({ targetId: ROOT });
    expect(e.state()?.hover?.tear).toBeUndefined();
    e.updateHoverByPoint(350, 200);
    expect(e.state()?.hover).toEqual({ targetId: inner, accepted: true, tear: true });
  });

  it("accepts: 'tear' takes a tear and refuses any other drop", () => {
    const { s, e } = setup({ rootConfig: { accepts: 'tear' } });
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    expect(e.state()?.hover?.accepted).toBe(true);
    e.drop();

    // Now floating in the root: a drag within it is not a tear.
    e.tryBegin(id('a'));
    e.updateHoverByPoint(600, 300);
    expect(e.state()?.hover).toEqual({ targetId: ROOT, accepted: false, insertIndex: undefined });
    e.cancel();
    expect(s.getParent(id('a'))?.id).toBe(ROOT);
  });

  it('refuses a tear into a container locked against arrange', () => {
    const { s, e } = setup();
    s.setLock(ROOT, { arrange: true });
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    expect(e.state()?.hover).toEqual({ targetId: ROOT, accepted: false, tear: true });
  });

  it('counts the torn tab as floating, so a tiling cap does not refuse it', () => {
    // The strip under the floats holds one pane already, at its cap of 2.
    const { s, e } = setup({ rootConfig: { maxItems: 2 } });
    s.registerNode(createNode({ id: id('canvas'), kind: 'panel', parentId: ROOT }));
    s.showNode(id('canvas'));
    e.tryBegin(id('a'));
    e.updateHoverByPoint(500, 200);
    expect(e.state()?.hover?.accepted).toBe(true);
  });
});

describe('DragEngine — docking back', () => {
  function torn() {
    const env = setup();
    env.e.tryBegin(id('a'));
    env.e.updateHoverByPoint(500, 200);
    env.e.drop();
    return env;
  }

  it('a floating child dropped on a tear stack docks as a tab and stops floating', () => {
    const { s, e } = torn();
    e.tryBegin(id('a'));
    e.updateHoverByPoint(150, 100);
    expect(e.state()?.hover).toMatchObject({ targetId: STACK, accepted: true, insertIndex: 0 });
    e.drop();
    expect(s.getNode(STACK)?.container?.childOrder).toEqual(['a', 'b']);
    expect('floating' in s.getPlacement(id('a'))).toBe(false);
  });

  it('docking is one undoable step', () => {
    const { s, e } = torn();
    const txns = transactions(s);
    e.tryBegin(id('a'));
    e.updateHoverByPoint(150, 100);
    e.drop();
    expect(txns()).toBe(1);
  });

  it('a stack without tear takes the drop as a plain move', () => {
    const { s, e } = torn();
    s.updateContainerConfig(STACK, { tear: undefined });
    e.tryBegin(id('a'));
    e.updateHoverByPoint(150, 100);
    e.drop();
    expect(s.getParent(id('a'))?.id).toBe(STACK);
    expect(s.getPlacement(id('a')).floating).toBe(true);
  });
});
