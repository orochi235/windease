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

describe('splitStrategy — maxSize', () => {
  it('caps a pane on initial layout (ratio branch)', () => {
    // ratio 0.5 of a 400px-wide container would give 'l' 200px, but its
    // maxSize.w caps it at 120; sibling takes the remainder.
    const tree = split('horizontal', 0.5, leaf('l'), leaf('r'));
    const result = splitStrategy.layout({
      items: [
        { id: 'l', hints: { maxSize: { w: 120, h: 0 } } },
        { id: 'r' },
      ],
      container: { w: 400, h: 100 },
      state: tree,
      options: { gutterSize: 0 },
    });
    expect(result.placements.get('l')?.w).toBe(120);
    expect(result.placements.get('r')?.w).toBe(280);
  });

  it('caps the explicit-size branch (placement.size larger than maxSize)', () => {
    // top asks for 300px via placement.size but maxSize.h caps it at 150.
    const tree = split('vertical', 0.5, leaf('top'), leaf('bot'));
    const result = splitStrategy.layout({
      items: [
        { id: 'top', placement: { size: { h: 300 } }, hints: { maxSize: { w: 0, h: 150 } } } as never,
        { id: 'bot' },
      ],
      container: { w: 200, h: 400 },
      state: tree,
      options: { gutterSize: 0 },
    });
    expect(result.placements.get('top')?.h).toBe(150);
    expect(result.placements.get('bot')?.h).toBe(250);
  });

  it('caps a pane during a drag (reduce)', () => {
    // dragging the gutter far right would grow 'a' past its maxSize.w of 100;
    // the ratio is clamped to maxSize.w / total = 100/400 = 0.25.
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const items = [{ id: 'a', hints: { maxSize: { w: 100, h: 0 } } }, { id: 'b' }];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: 1000, dy: 0 } },
      { container: { w: 400, h: 100 }, options: { gutterSize: 0 }, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(0.25, 5);
  });

  it("maxSize on the sibling raises the lower ratio bound during a drag", () => {
    // dragging left would grow 'b' past its maxSize.w of 100; 'a' must keep at
    // least 300 → minR = 1 - 100/400 = 0.75.
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const items = [{ id: 'a' }, { id: 'b', hints: { maxSize: { w: 100, h: 0 } } }];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: -1000, dy: 0 } },
      { container: { w: 400, h: 100 }, options: { gutterSize: 0 }, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(0.75, 5);
  });

  it('maxSize wins over a sibling minSize when both bound the same side', () => {
    // 'a' maxSize.w=100 → maxR=0.25; 'b' minSize.w=50 → maxR=min(0.25, 0.875).
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const items = [
      { id: 'a', hints: { maxSize: { w: 100, h: 0 } } },
      { id: 'b', hints: { minSize: { w: 50, h: 0 } } },
    ];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: 1000, dy: 0 } },
      { container: { w: 400, h: 100 }, options: { gutterSize: 0 }, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(0.25, 5);
  });

  it('over-constrained (min > max on the same side) is a no-op in reduce', () => {
    // 'a' minSize.w=300 (minR=0.75) conflicts with maxSize.w=100 (maxR=0.25);
    // minR > maxR ⇒ the drag leaves state unchanged.
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const items = [
      { id: 'a', hints: { minSize: { w: 300, h: 0 }, maxSize: { w: 100, h: 0 } } },
      { id: 'b' },
    ];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: 50, dy: 0 } },
      { container: { w: 400, h: 100 }, options: { gutterSize: 0 }, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBe(0.5);
  });

  it('sums maxSize across leaves on the same axis', () => {
    // right side splits into c+d, each maxSize.w=60 → side max = 120 →
    // minR = 1 - 120/400 = 0.7 when dragging left.
    const state = split(
      'horizontal',
      0.5,
      leaf('a'),
      split('horizontal', 0.5, leaf('c'), leaf('d')),
    );
    const items = [
      { id: 'a' },
      { id: 'c', hints: { maxSize: { w: 60, h: 0 } } },
      { id: 'd', hints: { maxSize: { w: 60, h: 0 } } },
    ];
    const next = splitStrategy.reduce!(
      state,
      { affordanceId: 'split-', kind: 'drag', payload: { dx: -1000, dy: 0 } },
      { container: { w: 400, h: 100 }, options: { gutterSize: 0 }, items },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(0.7, 5);
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
