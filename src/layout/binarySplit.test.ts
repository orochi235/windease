import { describe, it, expect } from 'vitest';
import { binarySplit, type BinarySplitState } from './binarySplit.js';
import { WindeaseError } from '../errors.js';

const items2 = [{ id: 'a' }, { id: 'b' }];

describe('binarySplit', () => {
  it('initialState returns ratio 0.5', () => {
    expect(binarySplit.initialState?.(items2)).toEqual({ ratio: 0.5 });
  });

  it('horizontal split places left then right with gutter', () => {
    const result = binarySplit.layout({
      items: items2,
      container: { w: 200, h: 100 },
      state: { ratio: 0.5 },
      options: { direction: 'horizontal', gutterSize: 4 },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 98, h: 100 });
    expect(result.placements.get('b')).toEqual({ x: 102, y: 0, w: 98, h: 100 });
    expect(result.affordances).toHaveLength(1);
    expect(result.affordances[0]).toMatchObject({
      kind: 'drag-x',
      cursor: 'col-resize',
      rect: { x: 98, y: 0, w: 4, h: 100 },
    });
    expect(result.affordances[0]!.meta).toMatchObject({ direction: 'horizontal' });
  });

  it('vertical split places top then bottom with gutter', () => {
    const result = binarySplit.layout({
      items: items2,
      container: { w: 100, h: 200 },
      state: { ratio: 0.5 },
      options: { direction: 'vertical', gutterSize: 4 },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 98 });
    expect(result.placements.get('b')).toEqual({ x: 0, y: 102, w: 100, h: 98 });
    expect(result.affordances[0]).toMatchObject({
      kind: 'drag-y',
      cursor: 'row-resize',
    });
  });

  it('throws WRONG_ITEM_COUNT when items != 2', () => {
    expect(() =>
      binarySplit.layout({
        items: [{ id: 'a' }],
        container: { w: 100, h: 100 },
        state: { ratio: 0.5 },
        options: { direction: 'horizontal' },
      }),
    ).toThrow(WindeaseError);
  });

  it('reduce(drag) updates ratio via container size', () => {
    const state: BinarySplitState = { ratio: 0.5 };
    const result = binarySplit.layout({
      items: items2,
      container: { w: 200, h: 100 },
      state,
      options: { direction: 'horizontal' },
    });
    const next = binarySplit.reduce!(
      state,
      { affordanceId: result.affordances[0]!.id, kind: 'drag', payload: { dx: 20, dy: 0 } },
      { container: { w: 200, h: 100 }, options: { direction: 'horizontal' }, items: items2 },
    );
    expect(next.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
  });

  it('reduce clamps to [minRatio, maxRatio]', () => {
    const next = binarySplit.reduce!(
      { ratio: 0.94 },
      { affordanceId: 'split-0', kind: 'drag', payload: { dx: 1000, dy: 0 } },
      { container: { w: 100, h: 100 }, options: { direction: 'horizontal' }, items: items2 },
    );
    expect(next.ratio).toBe(0.95);
  });

  it('reduce raises floor when first child has hints.minSize.w', () => {
    // 100px container, left child requires 60px → ratio cannot go below 0.6.
    const items = [
      { id: 'a', hints: { minSize: { w: 60, h: 0 } } },
      { id: 'b' },
    ];
    const next = binarySplit.reduce!(
      { ratio: 0.5 },
      { affordanceId: 'split-0', kind: 'drag', payload: { dx: -100, dy: 0 } },
      { container: { w: 100, h: 100 }, options: { direction: 'horizontal' }, items },
    );
    expect(next.ratio).toBe(0.6);
  });

  it('reduce lowers ceiling when second child has hints.minSize.w', () => {
    const items = [
      { id: 'a' },
      { id: 'b', hints: { minSize: { w: 40, h: 0 } } },
    ];
    const next = binarySplit.reduce!(
      { ratio: 0.5 },
      { affordanceId: 'split-0', kind: 'drag', payload: { dx: 100, dy: 0 } },
      { container: { w: 100, h: 100 }, options: { direction: 'horizontal' }, items },
    );
    // ratio ≤ 1 - 40/100 = 0.6
    expect(next.ratio).toBe(0.6);
  });

  it('canAccept returns true for exactly 2 items', () => {
    expect(binarySplit.canAccept?.([{ id: 'a' }, { id: 'b' }])).toBe(true);
  });

  it('canAccept returns false for not-2 items', () => {
    expect(binarySplit.canAccept?.([])).toBe(false);
    expect(binarySplit.canAccept?.([{ id: 'a' }])).toBe(false);
    expect(binarySplit.canAccept?.([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(false);
  });
});
