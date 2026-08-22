import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, Store } from '../index.js';
import { DragController } from './DragController.js';

function makeFakeElement(x: number, y: number, w: number, h: number): Element {
  return {
    getBoundingClientRect: () => ({ x, y, width: w, height: h, left: x, top: y }),
    setAttribute: () => {},
    removeAttribute: () => {},
    parentElement: null,
  } as unknown as Element;
}

const Z1 = asNodeId('z1');
const Z2 = asNodeId('z2');

/** `z1` holds a, b, c; `z2` is empty. */
function buildStore(): Store {
  const s = new Store();
  for (const z of [Z1, Z2]) {
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'stack', config: {} }, id: z }),
    );
  }
  for (const c of ['a', 'b', 'c']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: asNodeId(c), parentId: Z1 }));
  }
  return s;
}

/** Drag `sourceId` onto `targetId` at `insertIndex` and drop. */
async function dropOnto(
  c: DragController,
  sourceId: string,
  targetId: typeof Z1,
  insertIndex?: number,
): Promise<void> {
  c.tryBegin(asNodeId(sourceId));
  c.registerDropTarget(targetId, makeFakeElement(0, 0, 100, 100), undefined, {
    getInsertionIndex: () => insertIndex,
  });
  c.updateHoverByPoint(50, 50);
  await new Promise((r) => setTimeout(r, 20));
  c.drop();
}

const orderOf = (s: Store, id: typeof Z1) => s.getContainerView(id)?.childOrder;

describe('controlled child order', () => {
  it('hands the host the order a reorder would have produced', async () => {
    const s = buildStore();
    const c = new DragController(s);
    const commit = vi.fn();
    c.registerOrderControl(Z1, commit);

    await dropOnto(c, 'c', Z1, 0);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0]).toEqual(['c', 'a', 'b']);
    expect(commit.mock.calls[0]?.[1]).toEqual({
      movedId: 'c',
      fromParentId: Z1,
      toParentId: Z1,
    });
  });

  it('does not write the store, so the host is the only writer', async () => {
    const s = buildStore();
    const c = new DragController(s);
    c.registerOrderControl(Z1, () => {});

    await dropOnto(c, 'c', Z1, 0);

    expect(orderOf(s, Z1)).toEqual(['a', 'b', 'c']);
  });

  it('still commits normally for an uncontrolled parent', async () => {
    const s = buildStore();
    const c = new DragController(s);

    await dropOnto(c, 'c', Z1, 0);

    expect(orderOf(s, Z1)).toEqual(['c', 'a', 'b']);
  });

  it('resolves a pinned prefix the way the store would', async () => {
    // A controlled parent that disagreed with an uncontrolled one about pins
    // would make the pinned prefix depend on who owns order, which it must not.
    const controlled = buildStore();
    controlled.setPinned(asNodeId('a'), 0);
    const cc = new DragController(controlled);
    let handed: string[] = [];
    cc.registerOrderControl(Z1, (next) => {
      handed = next as unknown as string[];
    });
    await dropOnto(cc, 'c', Z1, 0);

    const uncontrolled = buildStore();
    uncontrolled.setPinned(asNodeId('a'), 0);
    await dropOnto(new DragController(uncontrolled), 'c', Z1, 0);

    expect(handed).toEqual(orderOf(uncontrolled, Z1));
  });

  it('notifies both sides of a cross-parent drop and writes neither', async () => {
    const s = buildStore();
    const c = new DragController(s);
    const from = vi.fn();
    const to = vi.fn();
    c.registerOrderControl(Z1, from);
    c.registerOrderControl(Z2, to);

    await dropOnto(c, 'b', Z2, 0);

    expect(to.mock.calls[0]?.[0]).toEqual(['b']);
    expect(from.mock.calls[0]?.[0]).toEqual(['a', 'c']);
    expect(orderOf(s, Z1)).toEqual(['a', 'b', 'c']);
    expect(orderOf(s, Z2)).toEqual([]);
  });

  it('suppresses the write when only the source side is controlled', async () => {
    // Committing the move here and asking the host to commit it too would
    // apply one gesture twice; the uncontrolled counterpart is the host's.
    const s = buildStore();
    const c = new DragController(s);
    const from = vi.fn();
    c.registerOrderControl(Z1, from);

    await dropOnto(c, 'b', Z2, 0);

    expect(from).toHaveBeenCalledTimes(1);
    expect(orderOf(s, Z1)).toEqual(['a', 'b', 'c']);
    expect(orderOf(s, Z2)).toEqual([]);
  });

  it('goes back to writing the store once the control is unregistered', async () => {
    const s = buildStore();
    const c = new DragController(s);
    const off = c.registerOrderControl(Z1, () => {});
    off();

    await dropOnto(c, 'c', Z1, 0);

    expect(orderOf(s, Z1)).toEqual(['c', 'a', 'b']);
  });

  it('leaves a direct store call alone — that is the host acting on itself', () => {
    const s = buildStore();
    const c = new DragController(s);
    c.registerOrderControl(Z1, () => {
      throw new Error('must not intercept an imperative reorder');
    });
    s.reorderInParent(asNodeId('c'), 0);
    expect(orderOf(s, Z1)).toEqual(['c', 'a', 'b']);
  });
});
