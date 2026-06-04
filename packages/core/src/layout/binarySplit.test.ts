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
      { container: { w: 200, h: 100 }, options: { direction: 'horizontal' } },
    );
    expect(next.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
  });

  it('reduce clamps to [minRatio, maxRatio]', () => {
    const next = binarySplit.reduce!(
      { ratio: 0.94 },
      { affordanceId: 'split-0', kind: 'drag', payload: { dx: 1000, dy: 0 } },
      { container: { w: 100, h: 100 }, options: { direction: 'horizontal' } },
    );
    expect(next.ratio).toBe(0.95);
  });
});
