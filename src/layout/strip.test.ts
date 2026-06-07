import { describe, it, expect } from 'vitest';
import { stripStrategy } from './strip.js';

import type { LayoutItem } from '../layout-types.js';

const mkItem = (id: string, opts?: { preferredW?: number; preferredH?: number }): LayoutItem => ({
  id: id,
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
    expect(result.placements.get('a')).toEqual({ x: 8, y: 8, w: 60, h: 24 });
    expect(result.placements.get('b')).toEqual({ x: 72, y: 8, w: 40, h: 24 });
  });

  it('fill=true distributes leftover main-axis space to hintless items', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredW: 100 }), mkItem('b'), mkItem('c')],
      container: { w: 300, h: 50 },
      state: undefined as void,
      options: { axis: 'x', fill: true },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(result.placements.get('b')).toEqual({ x: 100, y: 0, w: 100, h: 50 });
    expect(result.placements.get('c')).toEqual({ x: 200, y: 0, w: 100, h: 50 });
  });

  it('fill=false (default) leaves hintless items at w=0', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredW: 100 }), mkItem('b')],
      container: { w: 300, h: 50 },
      state: undefined as void,
      options: { axis: 'x' },
    });
    expect(result.placements.get('a')?.w).toBe(100);
    expect(result.placements.get('b')?.w).toBe(0);
  });

  it('defaultItemSize gives hintless items a default main-axis size when fill=false', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredW: 100 }), mkItem('b'), mkItem('c')],
      container: { w: 500, h: 50 },
      state: undefined as void,
      options: { axis: 'x', defaultItemSize: 80 },
    });
    expect(result.placements.get('a')?.w).toBe(100);
    expect(result.placements.get('b')?.w).toBe(80);
    expect(result.placements.get('c')?.w).toBe(80);
  });

  it('axis y lays out vertically', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 20 }), mkItem('b', { preferredH: 30 })],
      container: { w: 50, h: 100 },
      state: undefined as void,
      options: { axis: 'y', gap: 0, padding: 0 },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(result.placements.get('b')).toEqual({ x: 0, y: 20, w: 50, h: 30 });
  });
});
