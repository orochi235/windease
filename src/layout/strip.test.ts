import { describe, expect, it, vi } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const mkItem = (id: string, opts?: { preferredW?: number; preferredH?: number }): LayoutItem => ({
  id: id,
  ...(opts?.preferredW || opts?.preferredH
    ? { hints: { preferredSize: { w: opts?.preferredW ?? 0, h: opts?.preferredH ?? 0 } } }
    : {}),
});

const pinned = (id: string, at: number): LayoutItem => ({ id, meta: { pinned: at } });

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

describe('stripStrategy — preview', () => {
  it('places the ghost between siblings on the x axis (insertIndex=1 of 3)', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 300, h: 100 },
      state: undefined,
      options: { fill: true },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 150, y: 50 } },
    });
    expect(result.isPreview).toBe(true);
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    const b = result.placements.get('b')!;
    expect(a.x).toBeLessThan(ghost.x);
    expect(ghost.x).toBeLessThan(b.x);
  });

  it('places the ghost between siblings on the y axis when axis=y', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }],
      container: { w: 100, h: 200 },
      state: undefined,
      options: { axis: 'y', fill: true },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 150 } },
    });
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    expect(ghost.y).toBeGreaterThan(a.y);
    expect(result.isPreview).toBe(true);
  });
});

describe('stripStrategy — placement.size', () => {
  it('honors placement.size.w on axis=x', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a', placement: { size: { w: 80 } } } as never, { id: 'b' }],
      container: { w: 200, h: 50 },
      state: undefined as void,
      options: { axis: 'x' },
    });
    expect(result.placements.get('a')?.w).toBe(80);
    expect(result.placements.get('b')?.w).toBe(120);
  });

  it('honors placement.size.h on axis=y', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a', placement: { size: { h: 60 } } } as never, { id: 'b' }],
      container: { w: 50, h: 200 },
      state: undefined as void,
      options: { axis: 'y' },
    });
    expect(result.placements.get('a')?.h).toBe(60);
    expect(result.placements.get('b')?.h).toBe(140);
  });

  it('emits resize-x affordances on non-last children when axis=x', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      container: { w: 300, h: 50 },
      state: undefined as void,
      options: { axis: 'x' },
    });
    const resizes = result.affordances.filter((a) => a.kind === 'resize-x');
    expect(resizes).toHaveLength(2);
    expect(resizes.map((a) => a.childId)).toEqual(['a', 'b']);
  });

  it('affects contains exactly the childId on a resize-x affordance', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 50 },
      state: undefined as void,
      options: { axis: 'x' },
    });
    const resize = result.affordances.find((a) => a.kind === 'resize-x')!;
    expect(resize.affects).toEqual([resize.childId]);
  });

  it('dispatchAffordance patches placement.size on resize drag (axis=x)', () => {
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn(() => ({ membership: { placement: { size: { w: 100 } } } })),
    };
    stripStrategy.dispatchAffordance?.({
      event: { affordanceId: 'resize-x-a', kind: 'drag', payload: { dx: 20, dy: 0 } },
      affordance: {
        id: 'resize-x-a',
        kind: 'resize-x',
        rect: { x: 0, y: 0, w: 4, h: 50 },
        childId: 'a',
      },
      store: fakeStore as never,
      parentId: 'root' as never,
      container: { w: 300, h: 50 },
      options: { axis: 'x' },
      items: [{ id: 'a', placement: { size: { w: 100 } } } as never, { id: 'b' }],
    });
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('a', { size: { w: 120 } });
  });

  it("never writes a size below the dragged child's own min when siblings crowd it", () => {
    // usableMain 200; b and c reserve 90 each, so the sibling ceiling is 20 --
    // below a's own min of 60. The ceiling must not win: a floors at 60 and the
    // row overflows instead of writing a size a itself forbids.
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn(() => ({ membership: { placement: { size: { w: 100 } } } })),
    };
    stripStrategy.dispatchAffordance?.({
      event: { affordanceId: 'resize-x-a', kind: 'drag', payload: { dx: 50, dy: 0 } },
      affordance: {
        id: 'resize-x-a',
        kind: 'resize-x',
        rect: { x: 0, y: 0, w: 4, h: 50 },
        childId: 'a',
      },
      store: fakeStore as never,
      parentId: 'root' as never,
      container: { w: 200, h: 50 },
      options: { axis: 'x' },
      items: [
        { id: 'a', placement: { size: { w: 100 } }, hints: { minSize: { w: 60, h: 0 } } } as never,
        { id: 'b', hints: { minSize: { w: 90, h: 0 } } } as never,
        { id: 'c', hints: { minSize: { w: 90, h: 0 } } } as never,
      ],
    });
    const written = fakeStore.patchPlacement.mock.calls[0]?.[1] as { size: { w: number } };
    expect(written.size.w).toBeGreaterThanOrEqual(60);
  });
});

describe('stripStrategy — maxSize on explicit children', () => {
  it('caps an explicit placement.size.w above hints.maxSize.w on initial layout (axis=x)', () => {
    const result = stripStrategy.layout({
      items: [
        { id: 'a', placement: { size: { w: 500 } }, hints: { maxSize: { w: 100, h: 0 } } } as never,
        { id: 'b' },
      ],
      container: { w: 1000, h: 50 },
      state: undefined as void,
      options: { axis: 'x' },
    });
    expect(result.placements.get('a')?.w).toBe(100);
    // The 900 freed by the cap goes to b, not nowhere — the row still fills.
    expect(result.placements.get('b')?.w).toBe(900);
  });

  it('caps an explicit placement.size.h above hints.maxSize.h on initial layout (axis=y)', () => {
    const result = stripStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 500 } }, hints: { maxSize: { w: 0, h: 100 } } } as never,
        { id: 'b' },
      ],
      container: { w: 50, h: 1000 },
      state: undefined as void,
      options: { axis: 'y' },
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(900);
  });

  it("honors an unconstrained sibling's minSize alongside a capped explicit child", () => {
    const result = stripStrategy.layout({
      items: [
        {
          id: 'a',
          placement: { size: { w: 1000 } },
          hints: { maxSize: { w: 300, h: 0 } },
        } as never,
        { id: 'b', hints: { minSize: { w: 150, h: 0 } } } as never,
      ],
      container: { w: 400, h: 50 },
      state: undefined as void,
      options: { axis: 'x' },
    });
    expect(result.placements.get('a')?.w).toBeCloseTo(250);
    expect(result.placements.get('b')?.w).toBeCloseTo(150);
  });
});

describe('stripStrategy capacity', () => {
  const items = (n: number): LayoutItem[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `i${i}`,
      hints: { preferredSize: { w: 100, h: 10 } },
    }));

  it('overflows items past maxItems into unplaced', () => {
    const res = stripStrategy.layout({
      items: items(5),
      container: { w: 1000, h: 100 },
      state: undefined as never,
      options: { axis: 'x', maxItems: 3 },
    });

    expect([...res.placements.keys()]).toEqual(['i0', 'i1', 'i2']);
    expect(res.unplaced).toEqual(['i3', 'i4']);
  });

  it('lets pinned items win the capacity race', () => {
    const list = items(4);
    list[3]!.meta = { pinned: 0 };
    const res = stripStrategy.layout({
      items: list,
      container: { w: 1000, h: 100 },
      state: undefined as never,
      options: { axis: 'x', maxItems: 2 },
    });

    expect([...res.placements.keys()]).toEqual(['i0', 'i3']);
    expect(res.unplaced).toEqual(['i1', 'i2']);
  });

  it('reports no unplaced key when under capacity', () => {
    const res = stripStrategy.layout({
      items: items(2),
      container: { w: 1000, h: 100 },
      state: undefined as never,
      options: { axis: 'x', maxItems: 5 },
    });

    expect(res.unplaced).toBeUndefined();
  });

  it('rejects a drop that would overflow maxItems', () => {
    expect(stripStrategy.canAccept?.(items(4), { axis: 'x', maxItems: 3 })).toBe(false);
    expect(stripStrategy.canAccept?.(items(3), { axis: 'x', maxItems: 3 })).toBe(true);
  });

  it('accepts anything when maxItems is unset', () => {
    expect(stripStrategy.canAccept?.(items(50), { axis: 'x' })).toBe(true);
  });

  it('sizes gaps from the placed count, not the item count', () => {
    // Hintless on w (unlike `items()`, which sets an explicit preferredSize.w
    // that would win over fill and hide a gap-arithmetic bug entirely).
    const hintless = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }));
    const res = stripStrategy.layout({
      items: hintless,
      container: { w: 1000, h: 100 },
      state: undefined as never,
      options: { axis: 'x', maxItems: 2, gap: 10, fill: true },
    });

    // 1000 - one 10px gap (2 placed, not 5), split between two panes.
    expect(res.placements.get('i0')?.w).toBeCloseTo(495, 5);
  });

  it('sizes a resize drag from the placed count, not the item count', () => {
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn(() => ({ membership: { placement: {} } })),
    };
    const list = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }));

    stripStrategy.dispatchAffordance?.({
      event: { affordanceId: 'resize-y-i0', kind: 'drag', payload: { dx: 0, dy: 20 } },
      affordance: {
        id: 'resize-y-i0',
        kind: 'resize-y',
        rect: { x: 0, y: 0, w: 0, h: 0 },
        childId: 'i0',
      },
      store: fakeStore as never,
      parentId: 'root' as never,
      container: { w: 100, h: 300 },
      options: { axis: 'y', fill: true, maxItems: 3 },
      items: list as never,
    });

    // Three placed panes in 300px are 100 each; a +20 drag stores 120, not 80.
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('i0', { size: { h: 120 } });
  });

  it('sizes an x-axis resize drag from the placed count too', () => {
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn(() => ({ membership: { placement: {} } })),
    };
    const list = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }));

    stripStrategy.dispatchAffordance?.({
      event: { affordanceId: 'resize-x-i0', kind: 'drag', payload: { dx: 20, dy: 0 } },
      affordance: {
        id: 'resize-x-i0',
        kind: 'resize-x',
        rect: { x: 0, y: 0, w: 0, h: 0 },
        childId: 'i0',
      },
      store: fakeStore as never,
      parentId: 'root' as never,
      container: { w: 300, h: 100 },
      options: { axis: 'x', fill: true, maxItems: 3 },
      items: list as never,
    });

    // Three placed panes in 300px are 100 each; a +20 drag stores 120, not 80.
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('i0', { size: { w: 120 } });
  });
});

// Migrated from src/layout/stack.test.ts (removed — stack is now strip on the
// y axis). `{ axis: 'y', fill: true }` reproduces stack's defaults.
describe('stripStrategy — axis y (from stack)', () => {
  it('stacks items vertically using preferredSize.h, gap, padding', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 50 }), mkItem('b', { preferredH: 30 })],
      container: { w: 200, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true, gap: 5, padding: 10 },
    });
    expect(result.placements.get('a')).toEqual({ x: 10, y: 10, w: 180, h: 50 });
    expect(result.placements.get('b')).toEqual({ x: 10, y: 65, w: 180, h: 30 });
  });

  it('falls back to equal heights when no preferredSize', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a'), mkItem('b')],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.placements.get('a')?.h).toBe(50);
    expect(result.placements.get('b')?.h).toBe(50);
  });

  it('items without preferredSize share leftover space alongside items that have it', () => {
    // container h=200, no padding/gap. Item a has preferredH=80; b and c have no hint.
    // usable = 200; leftover = 200 - 80 = 120; flex per item = 120 / 2 = 60.
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 80 }), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    expect(result.placements.get('b')).toEqual({ x: 0, y: 80, w: 100, h: 60 });
    expect(result.placements.get('c')).toEqual({ x: 0, y: 140, w: 100, h: 60 });
  });

  it('fill=false keeps hintless items at height 0', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 50 }), mkItem('b')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: false },
    });
    expect(result.placements.get('a')?.h).toBe(50);
    expect(result.placements.get('b')?.h).toBe(0);
  });

  it('defaultItemSize sizes hintless items when fill=false', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 50 }), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { axis: 'y', fill: false, defaultItemSize: 60 },
    });
    expect(result.placements.get('a')?.h).toBe(50);
    expect(result.placements.get('b')?.h).toBe(60);
    expect(result.placements.get('c')?.h).toBe(60);
  });

  it('fill=true overrides defaultItemSize (leftover-sharing wins)', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 100 }), mkItem('b')],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { axis: 'y', fill: true, defaultItemSize: 50 },
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(200); // leftover, not the 50 default
  });

  it('clamps flex height to zero when preferred items already overflow', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 200 }), mkItem('b')],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.placements.get('a')?.h).toBe(200);
    expect(result.placements.get('b')?.h).toBe(0);
  });
});

describe('stripStrategy — axis y maxItems (from stack)', () => {
  it('caps placement count and reports the rest as unplaced', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true, maxItems: 2 },
    });
    expect(result.placements.size).toBe(2);
    expect(result.placements.has('a')).toBe(true);
    expect(result.placements.has('b')).toBe(true);
    expect(result.unplaced).toEqual(['c', 'd']);
  });

  it('uses placed count when sharing leftover space (not total)', () => {
    // container h=200, no padding/gap, maxItems=2 → both placed items get full half each.
    const result = stripStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true, maxItems: 2 },
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(100);
  });

  it('emits resize affordances only for placed-non-last children', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true, maxItems: 2 },
    });
    // Only 'a' gets an affordance (b is last placed, c/d are unplaced).
    expect(result.affordances.map((a) => a.id)).toEqual(['resize-y-a']);
  });

  it('canAccept rejects drops that would overflow maxItems', () => {
    expect(stripStrategy.canAccept?.([mkItem('a'), mkItem('b')], { axis: 'y', maxItems: 2 })).toBe(
      true,
    );
    expect(
      stripStrategy.canAccept?.([mkItem('a'), mkItem('b'), mkItem('c')], {
        axis: 'y',
        maxItems: 2,
      }),
    ).toBe(false);
  });

  it('canAccept returns true when maxItems is not set', () => {
    expect(
      stripStrategy.canAccept?.(
        Array.from({ length: 50 }, (_, i) => mkItem(`p${i}`)),
        { axis: 'y' },
      ),
    ).toBe(true);
  });

  it('overflows an unpinned child ahead of a pinned one that sorts later in childOrder', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), pinned('d', 3)],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true, maxItems: 3 },
    });
    expect(result.unplaced).toEqual(['c']);
    expect([...result.placements.keys()]).toEqual(['a', 'b', 'd']);
  });

  it('leaves ordering untouched when everything fits', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a'), pinned('b', 1)],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.unplaced).toBeUndefined();
    expect([...result.placements.keys()]).toEqual(['a', 'b']);
  });

  it('excess pinned children still overflow once capacity is full of pins', () => {
    const result = stripStrategy.layout({
      items: [pinned('a', 0), pinned('b', 1), pinned('c', 2)],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true, maxItems: 2 },
    });
    expect(result.unplaced).toEqual(['c']);
    expect([...result.placements.keys()]).toEqual(['a', 'b']);
  });
});

describe('stripStrategy — axis y preview (from stack)', () => {
  it('marks isPreview=true when preview is set', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined,
      options: { axis: 'y', fill: true },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.has('ghost')).toBe(true);
  });

  it('places the ghost between siblings (insertIndex=1 of 3)', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined,
      options: { axis: 'y', fill: true },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 100 } },
    });
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    const b = result.placements.get('b')!;
    expect(a.y).toBeLessThan(ghost.y);
    expect(ghost.y).toBeLessThan(b.y);
  });

  it('produces no isPreview flag when preview is absent', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }],
      container: { w: 100, h: 100 },
      state: undefined,
      options: { axis: 'y', fill: true },
    });
    expect(result.isPreview).toBeUndefined();
  });
});

describe('stripStrategy — axis y placement.size (from stack)', () => {
  it('honors a child with explicit placement.size.h', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a', placement: { size: { h: 200 } } } as never, { id: 'b' }],
      container: { w: 100, h: 500 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.placements.get('a')?.h).toBe(200);
    expect(result.placements.get('b')?.h).toBe(300);
  });

  it('sums multiple explicit sizes, fills remainder to unconstrained child', () => {
    const result = stripStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 100 } } } as never,
        { id: 'b', placement: { size: { h: 150 } } } as never,
        { id: 'c' },
      ],
      container: { w: 100, h: 500 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.h).toBe(150);
    expect(result.placements.get('c')?.h).toBe(250);
  });

  it('scales explicit sizes proportionally on overflow', () => {
    // container 200, two explicit kids: 300 + 100 = 400 -> scale 0.5
    const result = stripStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 300 } } } as never,
        { id: 'b', placement: { size: { h: 100 } } } as never,
      ],
      container: { w: 100, h: 200 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    expect(result.placements.get('a')?.h).toBeCloseTo(150);
    expect(result.placements.get('b')?.h).toBeCloseTo(50);
  });

  it('emits resize-y affordances on non-last children only', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    const resizes = result.affordances.filter((a) => a.kind === 'resize-y');
    expect(resizes).toHaveLength(2);
    expect(resizes[0]!.childId).toBe('a');
    expect(resizes[1]!.childId).toBe('b');
  });

  it('affects contains exactly the childId on a resize-y affordance', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { axis: 'y', fill: true },
    });
    const resize = result.affordances.find((a) => a.kind === 'resize-y')!;
    expect(resize.affects).toEqual([resize.childId]);
  });

  it('dispatchAffordance patches placement.size on the targeted child', () => {
    const fakeStore = {
      patchPlacement: vi.fn(),
      getNode: vi.fn((_id: string) => ({
        membership: { placement: { size: { h: 100 } } },
      })),
    };
    stripStrategy.dispatchAffordance?.({
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
      options: { axis: 'y', fill: true },
      items: [{ id: 'a', placement: { size: { h: 100 } } } as never, { id: 'b' }],
    });
    expect(fakeStore.patchPlacement).toHaveBeenCalledWith('a', {
      size: { h: 150 },
    });
  });
});
