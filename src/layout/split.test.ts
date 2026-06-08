import { describe, it, expect, vi } from 'vitest';
import { splitStrategy, type SplitNode } from './split.js';

const leaf = (id: string): SplitNode => ({ kind: 'leaf', id });
const split = (
  direction: 'horizontal' | 'vertical',
  ratio: number,
  a: SplitNode,
  b: SplitNode,
): SplitNode => ({ kind: 'split', direction, ratio, a, b });

describe('splitStrategy', () => {
  it('initialState produces equal-ratio right-leaning tree', () => {
    const state = splitStrategy.initialState!([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(state).toEqual({
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', direction: 'horizontal', ratio: 0.5, a: leaf('b'), b: leaf('c') },
    });
  });

  it('initialState with 1 item returns single leaf', () => {
    const state = splitStrategy.initialState!([{ id: 'a' }]);
    expect(state).toEqual(leaf('a'));
  });

  it('layout places a single leaf to fill the container', () => {
    const result = splitStrategy.layout({
      items: [{ id: 'a' }],
      container: { w: 100, h: 100 },
      state: leaf('a'),
      options: {},
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.affordances).toEqual([]);
  });

  it('layout for one horizontal split emits one drag-x affordance', () => {
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const result = splitStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 100 },
      state,
      options: { gutterSize: 4 },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 98, h: 100 });
    expect(result.placements.get('b')).toEqual({ x: 102, y: 0, w: 98, h: 100 });
    expect(result.affordances).toHaveLength(1);
    expect(result.affordances[0]).toMatchObject({ kind: 'drag-x', cursor: 'col-resize' });
    expect((result.affordances[0]!.meta as { path: number[] }).path).toEqual([]);
  });

  it('nested splits emit per-split affordances with distinct paths', () => {
    const state = split('horizontal', 0.5, split('vertical', 0.5, leaf('a'), leaf('b')), leaf('c'));
    const result = splitStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      container: { w: 200, h: 200 },
      state,
      options: { gutterSize: 4 },
    });
    expect(result.affordances).toHaveLength(2);
    const paths = result.affordances.map((a) => (a.meta as { path: number[] }).path);
    expect(paths).toEqual(expect.arrayContaining([[], [0]]));
  });

  it('reduce updates the ratio at the targeted path', () => {
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const result = splitStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 100 },
      state,
      options: {},
    });
    const aff = result.affordances[0]!;
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: aff.id, kind: 'drag', payload: { dx: 20, dy: 0 } },
      { container: { w: 200, h: 100 }, options: {}, items: [{ id: 'a' }, { id: 'b' }] },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
  });

  it('reduce honors child hints.minSize on a leaf', () => {
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const items = [
      { id: 'a', hints: { minSize: { w: 80, h: 0 } } },
      { id: 'b' },
    ];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: -1000, dy: 0 } },
      { container: { w: 200, h: 100 }, options: {}, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBe(0.4); // 80/200
  });

  it('reduce sums minSize across leaves on the same axis', () => {
    // root: horizontal split. right side itself splits horizontally into c+d.
    // Each leaf wants 30px width → right side total = 60px → maxR = 1 - 60/200
    const state = split(
      'horizontal',
      0.5,
      leaf('a'),
      split('horizontal', 0.5, leaf('c'), leaf('d')),
    );
    const items = [
      { id: 'a' },
      { id: 'c', hints: { minSize: { w: 30, h: 0 } } },
      { id: 'd', hints: { minSize: { w: 30, h: 0 } } },
    ];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: 1000, dy: 0 } },
      { container: { w: 200, h: 100 }, options: {}, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(1 - 60 / 200, 5);
  });

  it('orphan leaf is dropped and warned once', () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(m);
    try {
      const state = split('horizontal', 0.5, leaf('a'), leaf('orphan'));
      const result = splitStrategy.layout({
        items: [{ id: 'a' }],
        container: { w: 100, h: 100 },
        state,
        options: {},
      });
      expect(result.placements.has('orphan')).toBe(false);
      expect(warns.some((w) => w.includes('orphan'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });
});

describe('splitStrategy — placement.size', () => {
  it('honors placement.size.h on the top pane of a vertical split', () => {
    const tree: SplitNode = {
      kind: 'split',
      direction: 'vertical',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'top' },
      b: { kind: 'leaf', id: 'bot' },
    };
    const result = splitStrategy.layout({
      items: [
        { id: 'top', placement: { size: { h: 100 } } } as never,
        { id: 'bot' },
      ],
      container: { w: 200, h: 400 },
      state: tree,
      options: { gutterSize: 0 },
    });
    expect(result.placements.get('top')?.h).toBe(100);
    expect(result.placements.get('bot')?.h).toBe(300);
  });

  it('honors placement.size.w on the left pane of a horizontal split', () => {
    const tree: SplitNode = {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'l' },
      b: { kind: 'leaf', id: 'r' },
    };
    const result = splitStrategy.layout({
      items: [
        { id: 'l', placement: { size: { w: 80 } } } as never,
        { id: 'r' },
      ],
      container: { w: 200, h: 50 },
      state: tree,
      options: { gutterSize: 0 },
    });
    expect(result.placements.get('l')?.w).toBe(80);
    expect(result.placements.get('r')?.w).toBe(120);
  });

  it('dispatchAffordance on a gutter clears placement.size on both panes', () => {
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn((_id: string) => ({
        slot: { placement: { size: { h: 100 }, pinned: true } },
      })),
    };
    const tree: SplitNode = {
      kind: 'split',
      direction: 'vertical',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'top' },
      b: { kind: 'leaf', id: 'bot' },
    };
    splitStrategy.dispatchAffordance?.({
      event: { affordanceId: 'split-', kind: 'drag', payload: { dx: 0, dy: 10 } },
      affordance: {
        id: 'split-',
        kind: 'drag-y',
        rect: { x: 0, y: 0, w: 200, h: 4 },
        meta: { path: [], direction: 'vertical' } as never,
      },
      store: fakeStore as never,
      parentId: 'root' as never,
      container: { w: 200, h: 400 },
      options: {},
      items: [{ id: 'top' }, { id: 'bot' }],
    } as never);
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('top', { size: undefined });
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('bot', { size: undefined });
  });
});

describe('splitStrategy — sibling-add bounds', () => {
  it('pins current per-leaf behavior: explicit pane gets its intent, sibling takes the remainder', () => {
    // Split's clamp is rectwise (per leaf), not summed. With container h=200
    // and top explicit at 150, bot just gets the remaining 50 even if its
    // hints.minSize.h says 80. Stricter shrink-to-fit is a follow-up.
    const tree: SplitNode = {
      kind: 'split',
      direction: 'vertical',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'top' },
      b: { kind: 'leaf', id: 'bot' },
    };
    const result = splitStrategy.layout({
      items: [
        { id: 'top', placement: { size: { h: 150 } } } as never,
        { id: 'bot', hints: { minSize: { w: 0, h: 80 } } },
      ],
      container: { w: 50, h: 200 },
      state: tree,
      options: { gutterSize: 0 },
    });
    expect(result.placements.get('top')?.h).toBe(150);
    expect(result.placements.get('bot')?.h).toBe(50);
  });
});

describe('splitStrategy — preview', () => {
  it('marks isPreview=true on the result when preview is set', () => {
    const result = splitStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }],
      container: { w: 200, h: 200 },
      state: splitStrategy.initialState!([{ id: 'a' }, { id: 'ghost' }]),
      options: { axis: 'x' },
      preview: { insertId: 'ghost', cursor: { x: 100, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.has('ghost')).toBe(true);
  });
});
