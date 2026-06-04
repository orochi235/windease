import { describe, it, expect } from 'vitest';
import { stripStrategy } from './strip.js';
import { asWindowId } from '../window.js';
import type { LayoutItem } from '../layout-types.js';

const mkItem = (id: string, opts?: { preferredW?: number; preferredH?: number }): LayoutItem => ({
  id: asWindowId(id),
  ...(opts?.preferredW || opts?.preferredH
    ? { hints: { preferredSize: { w: opts?.preferredW ?? 0, h: opts?.preferredH ?? 0 } } }
    : {}),
});

describe('stripStrategy', () => {
  it('lays out horizontally by default', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredW: 60 }), mkItem('b', { preferredW: 40 })],
      container: { w: 200, h: 40 },
      state: undefined as void,
      options: { axis: 'x', gap: 4, padding: 8 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 8, y: 8, w: 60, h: 24 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 72, y: 8, w: 40, h: 24 });
  });

  it('axis y lays out vertically', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 20 }), mkItem('b', { preferredH: 30 })],
      container: { w: 50, h: 100 },
      state: undefined as void,
      options: { axis: 'y', gap: 0, padding: 0 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 0, y: 20, w: 50, h: 30 });
  });
});
