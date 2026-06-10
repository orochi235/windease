import { describe, it, expect, vi } from 'vitest';
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

describe('stackStrategy — maxItems', () => {
  it('caps placement count and reports the rest as unplaced', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { maxItems: 2 },
    });
    expect(result.placements.size).toBe(2);
    expect(result.placements.has('a')).toBe(true);
    expect(result.placements.has('b')).toBe(true);
    expect(result.unplaced).toEqual(['c', 'd']);
  });

  it('uses placed count when sharing leftover space (not total)', () => {
    // container h=200, no padding/gap, maxItems=2 → both placed items get full half each.
    const result = stackStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { maxItems: 2 },
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(100);
  });

  it('emits resize affordances only for placed-non-last children', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { maxItems: 2 },
    });
    // Only 'a' gets an affordance (b is last placed, c/d are unplaced).
    expect(result.affordances.map((a) => a.id)).toEqual(['resize-y-a']);
  });

  it('canAccept rejects drops that would overflow maxItems', () => {
    expect(stackStrategy.canAccept?.([mkItem('a'), mkItem('b')], { maxItems: 2 })).toBe(true);
    expect(
      stackStrategy.canAccept?.([mkItem('a'), mkItem('b'), mkItem('c')], { maxItems: 2 }),
    ).toBe(false);
  });

  it('canAccept returns true when maxItems is not set', () => {
    expect(
      stackStrategy.canAccept?.(
        Array.from({ length: 50 }, (_, i) => mkItem(`p${i}`)),
        {},
      ),
    ).toBe(true);
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

describe('stackStrategy — placement.size', () => {
  it('honors a child with explicit placement.size.h', () => {
    const result = stackStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 200 } } } as never,
        { id: 'b' },
      ],
      container: { w: 100, h: 500 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')?.h).toBe(200);
    expect(result.placements.get('b')?.h).toBe(300);
  });

  it('sums multiple explicit sizes, fills remainder to unconstrained child', () => {
    const result = stackStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 100 } } } as never,
        { id: 'b', placement: { size: { h: 150 } } } as never,
        { id: 'c' },
      ],
      container: { w: 100, h: 500 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(150);
    expect(result.placements.get('c')?.h).toBe(250);
  });

  it('scales explicit sizes proportionally on overflow', () => {
    // container 200, two explicit kids: 300 + 100 = 400 -> scale 0.5
    const result = stackStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 300 } } } as never,
        { id: 'b', placement: { size: { h: 100 } } } as never,
      ],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')?.h).toBeCloseTo(150);
    expect(result.placements.get('b')?.h).toBeCloseTo(50);
  });

  it('emits resize-y affordances on non-last children only', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: {},
    });
    const resizes = result.affordances.filter((a) => a.kind === 'resize-y');
    expect(resizes).toHaveLength(2);
    expect(resizes[0]!.childId).toBe('a');
    expect(resizes[1]!.childId).toBe('b');
  });

  it('dispatchAffordance patches placement.size on the targeted child', () => {
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn((_id: string) => ({
        slot: { placement: { size: { h: 100 } } },
      })),
    };
    stackStrategy.dispatchAffordance?.({
      event: { affordanceId: 'resize-y-a', kind: 'drag', payload: { dx: 0, dy: 50 } },
      affordance: {
        id: 'resize-y-a',
        kind: 'resize-y',
        rect: { x: 0, y: 0, w: 100, h: 4 },
        childId: 'a',
      },
      store: fakeStore as never,
      parentId: 'root' as never,
      container: { w: 100, h: 500 },
      options: {},
      items: [
        { id: 'a', placement: { size: { h: 100 } } } as never,
        { id: 'b' },
      ],
    });
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('a', {
      size: { h: 150 },
    });
  });
});
