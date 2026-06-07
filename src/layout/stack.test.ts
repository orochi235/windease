import { describe, it, expect } from 'vitest';
import { stackStrategy } from './stack.js';

import type { LayoutItem } from '../layout-types.js';

const mkItem = (id: string, preferredH?: number): LayoutItem => ({
  id: id,
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
    expect(result.placements.get('a')).toEqual({ x: 10, y: 10, w: 180, h: 50 });
    expect(result.placements.get('b')).toEqual({ x: 10, y: 65, w: 180, h: 30 });
  });

  it('falls back to equal heights when no preferredSize', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a'), mkItem('b')],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')?.h).toBe(50);
    expect(result.placements.get('b')?.h).toBe(50);
  });

  it('items without preferredSize share leftover space alongside items that have it', () => {
    // container h=200, no padding/gap. Item a has preferredH=80; b and c have no hint.
    // usable = 200; leftover = 200 - 80 = 120; flex per item = 120 / 2 = 60.
    const result = stackStrategy.layout({
      items: [mkItem('a', 80), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    expect(result.placements.get('b')).toEqual({ x: 0, y: 80, w: 100, h: 60 });
    expect(result.placements.get('c')).toEqual({ x: 0, y: 140, w: 100, h: 60 });
  });

  it('fill=false keeps hintless items at height 0', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a', 50), mkItem('b')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { fill: false },
    });
    expect(result.placements.get('a')?.h).toBe(50);
    expect(result.placements.get('b')?.h).toBe(0);
  });

  it('defaultItemSize sizes hintless items when fill=false', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a', 50), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { fill: false, defaultItemSize: 60 },
    });
    expect(result.placements.get('a')?.h).toBe(50);
    expect(result.placements.get('b')?.h).toBe(60);
    expect(result.placements.get('c')?.h).toBe(60);
  });

  it('fill=true overrides defaultItemSize (leftover-sharing wins)', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a', 100), mkItem('b')],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { fill: true, defaultItemSize: 50 },
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(200); // leftover, not the 50 default
  });

  it('clamps flex height to zero when preferred items already overflow', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a', 200), mkItem('b')],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')?.h).toBe(200);
    expect(result.placements.get('b')?.h).toBe(0);
  });
});

describe('stackStrategy — preview', () => {
  it('marks isPreview=true when preview is set', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined,
      options: {},
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.has('ghost')).toBe(true);
  });

  it('places the ghost between siblings (insertIndex=1 of 3)', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined,
      options: {},
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 100 } },
    });
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    const b = result.placements.get('b')!;
    expect(a.y).toBeLessThan(ghost.y);
    expect(ghost.y).toBeLessThan(b.y);
  });

  it('produces no isPreview flag when preview is absent', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }],
      container: { w: 100, h: 100 },
      state: undefined,
      options: {},
    });
    expect(result.isPreview).toBeUndefined();
  });
});
