import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { nodeToLayoutItem, runStrategyForContainer } from '../layout-node-adapter.js';
import type { Affordance, HiddenItem, LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { captureSeam, commitJoin, commitReveal } from './seam-join.js';
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

  it('leaves a pane locked against hiding out of its end of the join', () => {
    const locked = items.map((it) => (it.id === 'b' ? { ...it, lock: { hide: true } } : it));
    const [first, second] = stripStrategy.layout({
      items: locked,
      container: { w: 600, h: 200 },
      state: undefined,
      options: { resizeMode: 'neighbor', overshoot: 'hide' },
    }).affordances;
    expect(first?.join).toEqual({ atMin: 'a', threshold: 24, action: 'hide' });
    expect(second?.join).toEqual({ atMax: 'c', threshold: 24, action: 'hide' });
  });

  it('keeps a hide-locked pane in a join that destroys', () => {
    const locked = items.map((it) => (it.id === 'b' ? { ...it, lock: { hide: true } } : it));
    const [first] = stripStrategy.layout({
      items: locked,
      container: { w: 600, h: 200 },
      state: undefined,
      options: { resizeMode: 'neighbor', overshoot: 'join' },
    }).affordances;
    expect(first?.join).toEqual({ atMin: 'a', atMax: 'b', threshold: 24 });
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

/** `a` and `c` filling 600px, with whatever is hidden around them. */
function withHidden(hidden: HiddenItem[], options: Record<string, unknown> = {}) {
  return stripStrategy.layout({
    items: [items[0]!, items[2]!],
    container: { w: 600, h: 200 },
    state: undefined,
    options: { resizeMode: 'neighbor', fill: true, overshoot: 'hide', ...options },
    hidden,
  });
}

const handles = (affordances: Affordance[]) => affordances.filter((a) => a.reveal);

describe('strip reveal handles', () => {
  it('puts a handle where a hidden middle pane would open, beside the seam before it', () => {
    const { affordances, placements } = withHidden([{ id: 'b', before: 1 }]);
    expect(handles(affordances)).toEqual([
      {
        id: 'reveal-x-b',
        kind: 'resize-x',
        rect: { x: placements.get('c')!.x + 2, y: 0, z: 0, w: 4, h: 200 },
        cursor: 'ew-resize',
        label: 'show',
        childId: 'b',
        affects: ['b'],
        reveal: { id: 'b', threshold: 24, direction: 1 },
      },
    ]);
  });

  it('starts a hidden first pane at the head of the row', () => {
    const [handle] = handles(withHidden([{ id: 'z', before: 0 }]).affordances);
    expect(handle?.rect.x).toBe(0);
    expect(handle?.reveal?.direction).toBe(1);
  });

  it('opens a hidden last pane back from the end of a full row', () => {
    const [handle] = handles(withHidden([{ id: 'z', before: 2 }]).affordances);
    expect(handle?.rect.x).toBe(596);
    expect(handle?.reveal?.direction).toBe(-1);
  });

  it('opens a hidden last pane forward when the row stops short of the container', () => {
    const { affordances, placements } = withHidden([{ id: 'z', before: 2 }], {
      fill: false,
      defaultItemSize: 100,
    });
    const c = placements.get('c')!;
    const [handle] = handles(affordances);
    expect(handle?.rect.x).toBe(c.x + c.w);
    expect(handle?.reveal?.direction).toBe(1);
  });

  it('sets two panes hidden in the same slot side by side', () => {
    const { affordances, placements } = withHidden([
      { id: 'b1', before: 1 },
      { id: 'b2', before: 1 },
    ]);
    const at = placements.get('c')!.x;
    expect(handles(affordances).map((a) => [a.id, a.rect.x])).toEqual([
      ['reveal-x-b1', at + 2],
      ['reveal-x-b2', at + 6],
    ]);
  });

  it('runs down a column as reveal-y', () => {
    const { affordances, placements } = withHidden([{ id: 'b', before: 1 }], { axis: 'y' });
    const [handle] = handles(affordances);
    expect(handle?.id).toBe('reveal-y-b');
    expect(handle?.kind).toBe('resize-y');
    expect(handle?.cursor).toBe('ns-resize');
    expect(handle?.rect).toEqual({ x: 0, y: placements.get('c')!.y + 2, z: 0, w: 600, h: 4 });
  });

  it('uses the join threshold', () => {
    const [handle] = handles(
      withHidden([{ id: 'b', before: 1 }], { joinThreshold: 40 }).affordances,
    );
    expect(handle?.reveal?.threshold).toBe(40);
  });

  it('offers a way back when every pane is hidden', () => {
    const result = stripStrategy.layout({
      items: [],
      container: { w: 600, h: 200 },
      state: undefined,
      options: { resizeMode: 'neighbor', overshoot: 'hide' },
      hidden: [{ id: 'b', before: 0 }],
    });
    expect(handles(result.affordances).map((a) => [a.rect.x, a.reveal?.direction])).toEqual([
      [0, 1],
    ]);
  });

  it('leaves the seams between visible panes as they were', () => {
    const plain = withHidden([]).affordances;
    const seamsOnly = withHidden([{ id: 'b', before: 1 }]).affordances.filter((a) => !a.reveal);
    expect(seamsOnly).toEqual(plain);
  });

  it.each([
    ['a join that destroys', { overshoot: 'join' }],
    ['no overshoot at all', { overshoot: undefined }],
    ['redistribute', { resizeMode: 'redistribute' }],
    ['resizable: false', { resizable: false }],
  ])('emits none under %s', (_, options) => {
    expect(handles(withHidden([{ id: 'b', before: 1 }], options).affordances)).toEqual([]);
  });
});

describe('a hidden pane in a store', () => {
  it('reaches the strip through the adapter, in child order', () => {
    const store = seed('hide');
    store.hideNode(asNodeId('editor'));
    const [handle] = handles(layoutOf(store).affordances);
    expect(handle?.reveal).toEqual({ id: 'editor', threshold: 24, direction: 1 });
    expect(handle?.rect.x).toBe(layoutOf(store).placements.get(asNodeId('panel'))!.x + 2);
  });

  it('comes back at the size it had when a committed reveal shows it', () => {
    const store = seed('hide');
    const aff = seamAfter(store, 'side');
    const before = captureSeam(store, aff);
    dragToFloor(store);
    commitJoin(store, aff, asNodeId('side'), before);
    const [handle] = handles(layoutOf(store).affordances);
    commitReveal(store, handle!);
    expect(store.getNode(asNodeId('side'))?.lifecycle.state).toBe('visible');
    expect(widths(store).side).toBe(200);
    expect(handles(layoutOf(store).affordances)).toEqual([]);
  });

  it('shows nothing for a seam that reveals nothing', () => {
    const store = seed('hide');
    store.hideNode(asNodeId('side'));
    commitReveal(store, seamAfter(store, 'editor'));
    expect(store.getNode(asNodeId('side'))?.lifecycle.state).toBe('hidden');
  });
});
