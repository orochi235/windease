import { describe, it, expect } from 'vitest';
import { gridStrategy } from './grid.js';
import { asWindowId } from '../window.js';

const mkItem = (id: string) => ({ id: asWindowId(id) });

describe('gridStrategy', () => {
  it('lays out items in a grid with cols, gap, padding', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 410, h: 410 },
      state: undefined as void,
      options: { cols: 2, gap: 10, padding: 20 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 20, y: 20, w: 180, h: 180 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 210, y: 20, w: 180, h: 180 });
    expect(result.placements.get(asWindowId('c'))).toEqual({ x: 20, y: 210, w: 180, h: 180 });
    expect(result.placements.get(asWindowId('d'))).toEqual({ x: 210, y: 210, w: 180, h: 180 });
    expect(result.affordances).toEqual([]);
  });

  it('defaults cols=1, gap=0, padding=0', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a')],
      container: { w: 100, h: 80 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('returns empty for empty items', () => {
    const result = gridStrategy.layout({
      items: [],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.size).toBe(0);
    expect(result.affordances).toEqual([]);
  });
});
