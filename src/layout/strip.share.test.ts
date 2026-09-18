import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode } from '../index.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { LayoutItem } from '../layout-types.js';
import { Store } from '../store.js';
import { captureTrace } from '../test-utils/capture-trace.js';
import { stripStrategy } from './strip.js';

type Placement = NonNullable<LayoutItem['placement']>;

const shared = (id: string, share: number, hints?: LayoutItem['hints']): LayoutItem => ({
  id,
  placement: { share },
  ...(hints ? { hints } : {}),
});
const sized = (id: string, w: number): LayoutItem => ({ id, placement: { size: { w } } });
const min = (w: number) => ({ minSize: { w, h: 0 } });
const max = (w: number) => ({ maxSize: { w, h: 0 } });

function widths(items: LayoutItem[], w = 600, options: object = {}) {
  const r = stripStrategy.layout({
    items,
    container: { w, h: 50 },
    state: undefined as void,
    options: { ...options },
  });
  return Object.fromEntries([...r.placements].map(([id, rect]) => [id, rect.w]));
}

describe('stripStrategy placement.share', () => {
  it('splits the row in proportion to the shares', () => {
    const w = widths([shared('a', 0.25), shared('b', 0.5), shared('c', 0.25)]);
    expect(w).toEqual({ a: 150, b: 300, c: 150 });
  });

  it('keeps its proportions when the container shrinks', () => {
    const row = [shared('a', 0.2), shared('b', 0.5), shared('c', 0.3)];
    const big = widths(row, 3840);
    const small = widths(row, 960);
    for (const id of ['a', 'b', 'c']) expect(small[id]! / 960).toBeCloseTo(big[id]! / 3840, 9);
  });

  it('fills the row when there is no fill pane, whatever the shares sum to', () => {
    expect(widths([shared('a', 1), shared('b', 3)])).toEqual({ a: 150, b: 450 });
    expect(widths([shared('a', 0.1), shared('b', 0.2)])).toEqual({ a: 200, b: 400 });
  });

  it('gives a fill pane what the shares leave, so it survives a smaller container', () => {
    // The pixel equivalent, saved at 3840 and shown at 960, squeezes the two
    // stored sizes into the whole row and leaves the middle column nothing.
    const row = [shared('a', 0.25), { id: 'b' }, shared('c', 0.25)];
    expect(widths(row, 960)).toEqual({ a: 240, b: 480, c: 240 });
    expect(widths([sized('a', 960), { id: 'b' }, sized('c', 2880)], 960).b).toBe(0);
  });

  it('splits fill panes equally in what the shares leave', () => {
    expect(widths([shared('a', 0.5), { id: 'b' }, { id: 'c' }])).toEqual({
      a: 300,
      b: 150,
      c: 150,
    });
  });

  it('shares over 1 beside a fill pane split the row after its floor', () => {
    const w = widths([shared('a', 0.75), shared('b', 0.75), { id: 'c', hints: min(60) }]);
    expect(w).toEqual({ a: 270, b: 270, c: 60 });
  });

  it('takes pixel sizes out first and shares split the rest', () => {
    expect(widths([sized('a', 100), shared('b', 0.5), shared('c', 0.5)])).toEqual({
      a: 100,
      b: 250,
      c: 250,
    });
  });

  it('squeezes pixel sizes to keep share floors, then shares get the rest', () => {
    const w = widths([sized('a', 800), shared('b', 0.5, min(100))]);
    expect(w).toEqual({ a: 500, b: 100 });
  });

  it('floors a share at its min, taking the difference from the other shares', () => {
    const w = widths([shared('a', 0.1, min(100)), shared('b', 0.45), shared('c', 0.45)]);
    expect(w.a).toBe(100);
    expect(w.b).toBeCloseTo(250, 9);
    expect(w.c).toBeCloseTo(250, 9);
  });

  it('caps a share at its max, and a fill pane takes the excess', () => {
    expect(widths([shared('a', 0.5, max(100)), { id: 'b' }])).toEqual({ a: 100, b: 500 });
  });

  it('caps a share at its max in a row of shares, leaving the excess empty', () => {
    expect(widths([shared('a', 0.5, max(100)), shared('b', 0.5)])).toEqual({ a: 100, b: 300 });
  });

  it('lets a pixel size outrank a share on the same pane', () => {
    const both: LayoutItem = { id: 'a', placement: { size: { w: 100 }, share: 0.9 } };
    expect(widths([both, shared('b', 0.5)])).toEqual({ a: 100, b: 500 });
  });

  it('stops the row from being sized by preferredSize, like any stated size', () => {
    const pref: LayoutItem = { id: 'b', hints: { preferredSize: { w: 50, h: 0 } } };
    expect(widths([shared('a', 0.5), pref])).toEqual({ a: 300, b: 300 });
  });

  it('shares what gaps and padding leave', () => {
    const w = widths([shared('a', 0.5), shared('b', 0.5)], 620, { gap: 10, padding: 5 });
    expect(w).toEqual({ a: 300, b: 300 });
  });

  it('reads the height on a y strip', () => {
    const r = stripStrategy.layout({
      items: [shared('a', 0.25), shared('b', 0.75)],
      container: { w: 50, h: 400 },
      state: undefined as void,
      options: { axis: 'y' },
    });
    expect(r.placements.get('a')?.h).toBe(100);
    expect(r.placements.get('b')?.h).toBe(300);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative', -0.5],
    ['zero', 0],
  ])('treats %s share as absent, and traces it', (_, bad) => {
    const cap = captureTrace('layout');
    const w = widths([shared('a', bad), shared('b', 0.5)]);
    expect(w).toEqual({ a: 300, b: 300 });
    expect(cap.matching(/ignoring placement\.share .* on a/)).not.toHaveLength(0);
  });

  it('reaches strategies through nodeToLayoutItem', () => {
    const store = new Store();
    store.registerNode(
      createNode({ id: asNodeId('z'), container: { strategyId: 'strip', config: {} } }),
    );
    store.registerNode(createNode({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchPlacement(asNodeId('p'), { share: 0.4 });
    expect(nodeToLayoutItem(store.getNode(asNodeId('p'))!).placement?.share).toBe(0.4);
  });

  it('is guarded by the resize lock, like size', () => {
    const store = new Store();
    store.registerNode(
      createNode({ id: asNodeId('z'), container: { strategyId: 'strip', config: {} } }),
    );
    store.registerNode(createNode({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.setLock(asNodeId('p'), { resize: true });
    expect(() => store.patchPlacement(asNodeId('p'), { share: 0.4 })).toThrow(/lock\.resize/);
  });
});

function fakeStore() {
  const patchPlacement = vi.fn();
  return {
    patchPlacement,
    getNode: () => ({ membership: { placement: {} } }),
  } as never as { patchPlacement: ReturnType<typeof vi.fn> };
}

/** Drags `childId`'s seam by `d`, merges every patch it wrote into the items'
 *  placement, and lays the row out again. `at` lays the result out in another
 *  container, to show it survives a resize. */
function dragAndRelayout(
  rows: LayoutItem[],
  childId: string,
  d: number,
  options: { axis?: 'x' | 'y' } & Record<string, unknown>,
  main = 600,
) {
  const axis = options.axis ?? 'x';
  const container = axis === 'x' ? { w: main, h: 50 } : { w: 50, h: main };
  const layout = (list: LayoutItem[], c = container) =>
    stripStrategy.layout({ items: list, container: c, state: undefined as void, options });
  const extent = (list: LayoutItem[], c = container) =>
    Object.fromEntries(
      [...layout(list, c).placements].map(([id, r]) => [id, axis === 'x' ? r.w : r.h]),
    );
  const start = (list: LayoutItem[]) =>
    Object.fromEntries(
      [...layout(list).placements].map(([id, r]) => [id, axis === 'x' ? r.x : r.y]),
    );
  const store = fakeStore();
  const kind = axis === 'x' ? 'resize-x' : 'resize-y';
  stripStrategy.dispatchAffordance?.({
    event: {
      affordanceId: `${kind}-${childId}`,
      kind: 'drag',
      payload: axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d },
    },
    affordance: { id: `${kind}-${childId}`, kind, rect: { x: 0, y: 0, z: 0, w: 4, h: 4 }, childId },
    store: store as never,
    parentId: 'root' as never,
    container,
    options,
    items: rows,
  });
  const patches = new Map<string, Record<string, unknown>>(
    store.patchPlacement.mock.calls.map((c) => [c[0] as string, c[1] as Record<string, unknown>]),
  );
  const after = rows.map((it): LayoutItem => {
    const patch = patches.get(it.id);
    if (!patch) return it;
    const placement: Record<string, unknown> = { ...it.placement, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete placement[k];
    return { ...it, placement: placement as Placement };
  });
  return {
    patches,
    before: extent(rows),
    after: extent(after),
    afterStart: start(after),
    at: (c: number) => extent(after, axis === 'x' ? { w: c, h: 50 } : { w: 50, h: c }),
  };
}

const shareOf = (p: Record<string, unknown> | undefined) => p?.share as number | undefined;

describe('a seam drag on a row of shares writes shares', () => {
  const three = () => [shared('a', 0.2), shared('b', 0.3), shared('c', 0.5)];

  it('by default, moving the seam by exactly the drag', () => {
    const { before, after, patches } = dragAndRelayout(three(), 'a', 40, {});
    expect(after.a).toBeCloseTo(before.a! + 40, 9);
    expect(after.b! + after.c!).toBeCloseTo(before.b! + before.c! - 40, 9);
    for (const p of patches.values()) expect(p).not.toHaveProperty('size');
    const sum = [...patches.values()].reduce((s, p) => s + shareOf(p)!, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it('so the dragged row keeps its proportions in a smaller container', () => {
    const { after, at } = dragAndRelayout(three(), 'a', 40, {});
    const small = at(300);
    for (const id of ['a', 'b', 'c']) expect(small[id]! / 300).toBeCloseTo(after[id]! / 600, 9);
  });

  it("under resizeMode 'neighbor', writing the pair and leaving the rest", () => {
    const { before, after, patches } = dragAndRelayout(three(), 'a', 30, {
      resizeMode: 'neighbor',
    });
    expect([...patches.keys()].sort()).toEqual(['a', 'b']);
    expect(shareOf(patches.get('a'))).toBeCloseTo(0.25, 9);
    expect(shareOf(patches.get('b'))).toBeCloseTo(0.25, 9);
    expect(after.a).toBeCloseTo(before.a! + 30, 9);
    expect(after.b).toBeCloseTo(before.b! - 30, 9);
    expect(after.c).toBeCloseTo(before.c!, 9);
  });

  it('turns a fill pane it resizes into a share, so the whole row stays proportional', () => {
    const rows = [shared('a', 0.5), { id: 'b' }];
    const { after, patches, at } = dragAndRelayout(rows, 'a', 60, { resizeMode: 'neighbor' });
    expect(shareOf(patches.get('b'))).toBeCloseTo(0.4, 9);
    expect(after).toEqual({ a: 360, b: 240 });
    expect(at(1200)).toEqual({ a: 720, b: 480 });
  });

  it('leaves a fill pane to absorb the drag by default, writing only the dragged share', () => {
    const rows = [shared('a', 0.25), { id: 'b' }, shared('c', 0.25)];
    const { before, after, patches } = dragAndRelayout(rows, 'a', 30, {});
    expect([...patches.keys()]).toEqual(['a']);
    expect(shareOf(patches.get('a'))).toBeCloseTo(0.3, 9);
    expect(after.a).toBeCloseTo(before.a! + 30, 9);
    expect(after.c).toBeCloseTo(before.c!, 9);
  });

  it('keeps writing pixels to a pane that holds a pixel size', () => {
    const rows = [sized('a', 100), shared('b', 0.5), shared('c', 0.5)];
    const { before, after, afterStart, patches } = dragAndRelayout(rows, 'a', 50, {
      resizeMode: 'neighbor',
    });
    expect(patches.get('a')).toEqual({ size: { w: 150 } });
    expect(patches.get('b')).not.toHaveProperty('size');
    expect(after.a).toBeCloseTo(before.a! + 50, 9);
    expect(after.b).toBeCloseTo(before.b! - 50, 9);
    expect(after.c).toBeCloseTo(before.c!, 9);
    expect(afterStart.c).toBeCloseTo(350, 9);
  });

  it('moves the seam of a pixel pane by the drag in the default mode too', () => {
    const rows = [sized('a', 100), shared('b', 0.5), shared('c', 0.5)];
    const { before, after } = dragAndRelayout(rows, 'a', 50, {});
    expect(after.a).toBeCloseTo(before.a! + 50, 9);
    expect(after.b! + after.c!).toBeCloseTo(before.b! + before.c! - 50, 9);
  });

  it('stops at a floor rather than writing past it', () => {
    const rows = [shared('a', 0.5), shared('b', 0.5, min(250))];
    const { after } = dragAndRelayout(rows, 'a', 200, { resizeMode: 'neighbor' });
    expect(after).toEqual({ a: 350, b: 250 });
  });

  it('clears the share of a pane dragged to nothing rather than storing a zero', () => {
    const rows = [shared('a', 0.5), shared('b', 0.5)];
    const { after, patches } = dragAndRelayout(rows, 'a', -400, { resizeMode: 'neighbor' });
    expect(patches.get('a')).toEqual({ share: undefined });
    expect(shareOf(patches.get('b'))).toBeCloseTo(1, 9);
    expect(after).toEqual({ a: 0, b: 600 });
  });

  it('works on a y strip', () => {
    const rows = [shared('a', 0.5), shared('b', 0.5)];
    const { before, after } = dragAndRelayout(rows, 'a', 40, { axis: 'y' }, 400);
    expect(after.a).toBeCloseTo(before.a! + 40, 9);
    expect(after.b).toBeCloseTo(before.b! - 40, 9);
  });
});
