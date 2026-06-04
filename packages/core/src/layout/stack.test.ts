import { describe, it, expect } from 'vitest';
import { stackStrategy } from './stack.js';
import { asWindowId } from '../window.js';
import type { LayoutItem } from '../layout-types.js';

const mkItem = (id: string, preferredH?: number): LayoutItem => ({
  id: asWindowId(id),
  ...(preferredH ? { hints: { preferredSize: { w: 0, h: preferredH } } } : {}),
});

describe('stackStrategy', () => {
  it('stacks items vertically using preferredSize.h, gap, padding', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a', 50), mkItem('b', 30)],
      container: { w: 200, h: 200 },
      state: undefined as void,
      options: { gap: 5, padding: 10 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 10, y: 10, w: 180, h: 50 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 10, y: 65, w: 180, h: 30 });
  });

  it('falls back to equal heights when no preferredSize', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a'), mkItem('b')],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get(asWindowId('a'))?.h).toBe(50);
    expect(result.placements.get(asWindowId('b'))?.h).toBe(50);
  });
});
