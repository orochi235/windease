import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { nodeToLayoutItem, runStrategyForContainer } from '../layout-node-adapter.js';
import type { Affordance, LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { captureSeam, commitJoin } from './seam-join.js';
import { stripStrategy } from './strip.js';

const items: LayoutItem[] = [
  { id: 'a', hints: { minSize: { w: 80, h: 0 } } },
  { id: 'b', hints: { minSize: { w: 80, h: 0 } } },
  { id: 'c', hints: { minSize: { w: 80, h: 0 } } },
];

function seams(options: Record<string, unknown>): Affordance[] {
  return stripStrategy.layout({ items, container: { w: 600, h: 200 }, state: undefined, options })
    .affordances;
}

describe('strip overshoot declaration', () => {
  it("declares the same join for overshoot: 'join' as for joinOnOvershoot", () => {
    expect(seams({ resizeMode: 'neighbor', overshoot: 'join' }).map((a) => a.join)).toEqual(
      seams({ resizeMode: 'neighbor', joinOnOvershoot: true }).map((a) => a.join),
    );
  });

  it("marks the join as a hide under overshoot: 'hide'", () => {
    const [first] = seams({ resizeMode: 'neighbor', overshoot: 'hide' });
    expect(first?.join).toEqual({ atMin: 'a', atMax: 'b', threshold: 24, action: 'hide' });
  });

  it('lets overshoot outrank joinOnOvershoot', () => {
    const [first] = seams({ resizeMode: 'neighbor', overshoot: 'hide', joinOnOvershoot: true });
    expect(first?.join?.action).toBe('hide');
  });

  it('declares nothing under redistribute, which has no single victim', () => {
    for (const aff of seams({ overshoot: 'hide' })) expect(aff.join).toBeUndefined();
  });

  it('is in the config spec', () => {
    expect(stripStrategy.configSpec?.overshoot).toEqual(['join', 'hide']);
  });
});

const ROOT = asNodeId('root');

/** Three panes in a 600px neighbor strip: a sidebar at 200, the rest filling. */
function seed(overshoot: 'join' | 'hide') {
  const store = new Store();
  store.registerNode(
    createNode({
      id: ROOT,
      container: { strategyId: 'strip', config: { resizeMode: 'neighbor', fill: true, overshoot } },
    }),
  );
  for (const id of ['side', 'editor', 'panel']) {
    store.registerNode(
      createNode({
        id: asNodeId(id),
        parentId: ROOT,
        hints: { minSize: { w: 80, h: 0 } },
        ...(id === 'side' ? { placement: { size: { w: 200 } } } : {}),
      }),
    );
    store.showNode(asNodeId(id));
  }
  return store;
}

const layoutOf = (store: Store) =>
  runStrategyForContainer(store, ROOT, { w: 600, h: 100 }, stripStrategy, undefined);
const widths = (store: Store) =>
  Object.fromEntries([...layoutOf(store).placements].map(([id, r]) => [id, r.w]));
const seamAfter = (store: Store, id: string) =>
  layoutOf(store).affordances.find((a) => a.childId === id) as Affordance;

/** Drags `side`'s seam left to its floor, the way the gesture leaves the row
 *  when it arms. */
function dragToFloor(store: Store): void {
  const aff = seamAfter(store, 'side');
  stripStrategy.dispatchAffordance?.({
    event: { affordanceId: aff.id, kind: 'drag', payload: { dx: -500, dy: 0 } },
    affordance: aff,
    store,
    parentId: ROOT,
    container: { w: 600, h: 100 },
    options: store.getNode(ROOT)?.container?.config as Record<string, unknown>,
    items: store
      .getChildren(ROOT)
      .filter((n) => n.lifecycle.state === 'visible')
      .map(nodeToLayoutItem),
  });
}

describe('commitJoin', () => {
  it('destroys the victim of a join', () => {
    const store = seed('join');
    const aff = seamAfter(store, 'side');
    commitJoin(store, aff, asNodeId('side'));
    expect(store.getNode(asNodeId('side'))).toBeUndefined();
  });

  it('hides the victim of a hide and lets the rest take its space', () => {
    const store = seed('hide');
    const aff = seamAfter(store, 'side');
    const before = captureSeam(store, aff);
    dragToFloor(store);
    expect(widths(store).side).toBe(80);
    commitJoin(store, aff, asNodeId('side'), before);
    expect(store.getNode(asNodeId('side'))?.lifecycle.state).toBe('hidden');
    expect(widths(store)).toEqual({ editor: 300, panel: 300 });
  });

  it('remembers the size the pane had before the gesture, for showNode', () => {
    const store = seed('hide');
    const aff = seamAfter(store, 'side');
    const before = captureSeam(store, aff);
    dragToFloor(store);
    commitJoin(store, aff, asNodeId('side'), before);
    store.showNode(asNodeId('side'));
    expect(widths(store)).toEqual({ side: 200, editor: 200, panel: 200 });
  });

  it('hides without restoring anything when nothing was captured', () => {
    const store = seed('hide');
    const aff = seamAfter(store, 'side');
    dragToFloor(store);
    commitJoin(store, aff, asNodeId('side'));
    store.showNode(asNodeId('side'));
    expect(widths(store).side).toBe(80);
  });

  it('is one transaction', () => {
    const store = seed('hide');
    const aff = seamAfter(store, 'side');
    const before = captureSeam(store, aff);
    dragToFloor(store);
    let begins = 0;
    store.events.on('transaction.begin', () => begins++);
    commitJoin(store, aff, asNodeId('side'), before);
    expect(begins).toBe(1);
  });

  it('hides a destroy-locked pane, since nothing is destroyed', () => {
    const store = seed('hide');
    store.setLock(asNodeId('side'), { destroy: true });
    commitJoin(store, seamAfter(store, 'side'), asNodeId('side'));
    expect(store.getNode(asNodeId('side'))?.lifecycle.state).toBe('hidden');
  });
});
