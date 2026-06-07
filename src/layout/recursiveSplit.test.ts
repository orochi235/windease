import { describe, it, expect } from 'vitest';
import { recursiveSplit, type SplitNode } from './recursiveSplit.js';

const leaf = (id: string): SplitNode => ({ kind: 'leaf', id });
const split = (
  direction: 'horizontal' | 'vertical',
  ratio: number,
  a: SplitNode,
  b: SplitNode,
): SplitNode => ({ kind: 'split', direction, ratio, a, b });

describe('recursiveSplit', () => {
  it('initialState produces equal-ratio right-leaning tree', () => {
    const state = recursiveSplit.initialState!([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(state).toEqual({
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', direction: 'horizontal', ratio: 0.5, a: leaf('b'), b: leaf('c') },
    });
  });

  it('initialState with 1 item returns single leaf', () => {
    const state = recursiveSplit.initialState!([{ id: 'a' }]);
    expect(state).toEqual(leaf('a'));
  });

  it('layout places a single leaf to fill the container', () => {
    const result = recursiveSplit.layout({
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
    const result = recursiveSplit.layout({
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
    const result = recursiveSplit.layout({
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
    const result = recursiveSplit.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 100 },
      state,
      options: {},
    });
    const aff = result.affordances[0]!;
    const next = recursiveSplit.reduce!(
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
    const next = recursiveSplit.reduce!(
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
    const next = recursiveSplit.reduce!(
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
      const result = recursiveSplit.layout({
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
