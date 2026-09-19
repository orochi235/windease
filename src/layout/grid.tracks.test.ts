import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode } from '../constructors.js';
import type { Affordance, LayoutEvent, LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { configureTrace } from '../trace.js';
import { checkStrategyConfig } from './config-check.js';
import { gridStrategy, gridTiling } from './grid.js';

const ids = (n: number, prefix = 'i'): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

const run = (items: LayoutItem[], options: Record<string, unknown>, w = 500, h = 400) =>
  gridStrategy.layout({ items, container: { w, h }, state: undefined as void, options });

const rectOf = (r: ReturnType<typeof run>, id: string) => {
  const rect = r.placements.get(id);
  if (!rect) throw new Error(`${id} not placed`);
  return rect;
};

describe('gridStrategy — tracks', () => {
  it('holds pixel tracks at their size and splits the rest by share', () => {
    const r = run(ids(3), { tracks: { cols: [100, { share: 1 }, { share: 3 }] } });
    expect([0, 1, 2].map((i) => rectOf(r, `i${i}`).x)).toEqual([0, 100, 200]);
    expect([0, 1, 2].map((i) => rectOf(r, `i${i}`).w)).toEqual([100, 100, 300]);
  });

  it('takes its column count from tracks.cols when cols is unset, and wraps', () => {
    const r = run(ids(5), { tracks: { cols: [100, 150] } });
    expect(gridTiling(ids(5), { tracks: { cols: [100, 150] } })).toEqual({ cols: 2, rows: 3 });
    expect(rectOf(r, 'i1')).toMatchObject({ x: 100, w: 150 });
    expect(rectOf(r, 'i2')).toMatchObject({ x: 0, w: 100 });
  });

  it('lets cols override the count: missing tracks share, extra ones are ignored', () => {
    const r = run(ids(3), { cols: 3, tracks: { cols: [200] } });
    expect([0, 1, 2].map((i) => rectOf(r, `i${i}`).w)).toEqual([200, 150, 150]);
    const cut = run(ids(2), { cols: 2, tracks: { cols: [100, 100, 100] } });
    expect(cut.placements.size).toBe(2);
    expect(rectOf(cut, 'i1')).toMatchObject({ x: 100, w: 100 });
  });

  it('subtracts gaps and padding before shares split the rest', () => {
    const r = run(ids(2), { gap: 10, padding: 20, tracks: { cols: [100, { share: 1 }] } });
    // 500 - 40 padding - 10 gap - 100 = 350 for the share.
    expect(rectOf(r, 'i0')).toMatchObject({ x: 20, w: 100 });
    expect(rectOf(r, 'i1')).toMatchObject({ x: 130, w: 350 });
  });

  it('sizes rows by index, and rows past the list share what is left', () => {
    const r = run(ids(6), { cols: 2, tracks: { rows: [40] } });
    expect(rectOf(r, 'i0')).toMatchObject({ y: 0, h: 40 });
    expect(rectOf(r, 'i2')).toMatchObject({ y: 40, h: 180 });
    expect(rectOf(r, 'i4')).toMatchObject({ y: 220, h: 180 });
  });

  it('gives unlisted tracks the fixed cell size when cell sets one', () => {
    const r = run(ids(6), { cols: 2, cell: { h: 30 }, tracks: { rows: [60] } });
    expect(rectOf(r, 'i0')).toMatchObject({ y: 0, h: 60 });
    expect(rectOf(r, 'i2')).toMatchObject({ y: 60, h: 30 });
    expect(rectOf(r, 'i4')).toMatchObject({ y: 90, h: 30 });
  });

  it('spans the tracks it covers plus the gaps between them', () => {
    const items: LayoutItem[] = [{ id: 'a', placement: { span: { cols: 2 } } }, { id: 'b' }];
    const r = run(items, { gap: 10, tracks: { cols: [100, 50, { share: 1 }] } });
    expect(rectOf(r, 'a')).toMatchObject({ x: 0, w: 160 });
    expect(rectOf(r, 'b')).toMatchObject({ x: 170 });
  });

  it('places a celled item on its tracks', () => {
    const items: LayoutItem[] = [{ id: 'a', placement: { cell: { col: 2, row: 1 } } }];
    const r = run(items, { tracks: { cols: [50, 70, 90], rows: [20, 30] }, fill: false });
    expect(rectOf(r, 'a')).toMatchObject({ x: 120, y: 20, w: 90, h: 30 });
  });

  it('composes with justify when pixel tracks leave width over', () => {
    const r = run(ids(2), { justify: 'center', tracks: { cols: [100, 200] } });
    // 500 - 300 = 200 over, 100 either side.
    expect(rectOf(r, 'i0').x).toBe(100);
    expect(rectOf(r, 'i1').x).toBe(200);
    const between = run(ids(2), { justify: 'between', tracks: { cols: [100, 200] } });
    expect(rectOf(between, 'i1').x).toBe(300);
  });

  it('leaves nothing for justify once a share takes the rest', () => {
    const r = run(ids(2), { justify: 'end', tracks: { cols: [100, { share: 1 }] } });
    expect(rectOf(r, 'i0').x).toBe(0);
  });

  it('reports pixel tracks wider than the container as overflow', () => {
    const r = run(ids(2), { gap: 10, tracks: { cols: [300, 300] } });
    expect(r.overflow).toEqual({ w: 110, h: 0 });
  });

  it('holds share tracks at the minSize floors under overflowMode scroll', () => {
    const items = ids(2).map((it) => ({ ...it, hints: { minSize: { w: 300, h: 0 } } }));
    const r = run(items, { overflowMode: 'scroll', tracks: { cols: [100, { share: 1 }] } });
    expect(rectOf(r, 'i1').w).toBe(400);
    const squeezed = run(items, { tracks: { cols: [100, { share: 1 }] } });
    expect(rectOf(squeezed, 'i1').w).toBe(400);
    const narrow = run(items, { overflowMode: 'scroll', tracks: { cols: [300, { share: 1 }] } });
    expect(rectOf(narrow, 'i1').w).toBe(300);
    expect(narrow.overflow?.w).toBe(100);
  });

  it('unplaces the rows past the container under overflowMode unplaced', () => {
    const r = run(ids(6), { cols: 2, overflowMode: 'unplaced', tracks: { rows: [150, 150, 150] } });
    expect(r.unplaced).toEqual(['i4', 'i5']);
    expect(r.overflow).toBeUndefined();
  });

  describe('malformed tracks', () => {
    let logged: string[];
    beforeEach(() => {
      logged = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
      configureTrace('layout');
    });
    afterEach(() => {
      configureTrace(null);
      vi.restoreAllMocks();
    });

    it('reads a track that is not a size or a positive share as the implicit size, with a trace', () => {
      const r = run(ids(3), {
        tracks: { cols: [Number.NaN, { share: -1 }, { share: 1 }] as never },
      });
      for (const i of [0, 1, 2]) expect(rectOf(r, `i${i}`).w).toBeCloseTo(500 / 3, 9);
      expect(logged.join('\n')).toMatch(/track cols\[0\].*NaN/);
      expect(logged.join('\n')).toMatch(/track cols\[1\]/);
    });

    it('ignores tracks that are not an array', () => {
      const r = run(ids(2), { cols: 2, tracks: { cols: 'wide' } as never });
      expect(rectOf(r, 'i1').w).toBe(250);
    });
  });

  it('keeps the tiling a count cap reads: tracks.cols caps capacity like cols', () => {
    const options = { tracks: { cols: [100, 100] }, maxRows: 1 };
    expect(gridStrategy.canAccept?.(ids(2), options)).toBe(true);
    expect(gridStrategy.canAccept?.(ids(3), options)).toBe(false);
  });

  it('is a declared config key', () => {
    const spec = gridStrategy.configSpec;
    if (!spec) throw new Error('no spec');
    expect(checkStrategyConfig('grid', { tracks: { cols: [100] } }, spec)).toEqual([]);
  });

  it('lays out a 200-column, 5000-cell sheet quickly', () => {
    const cols = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? { share: 1 } : 60));
    const items = ids(5000, 'c');
    const t = performance.now();
    run(items, { tracks: { cols, rows: [24, 24, 40] }, cell: { h: 20 } }, 4000, 2000);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe('gridStrategy — track seams', () => {
  const Z = asNodeId('z');

  function storeWith(items: LayoutItem[], options: Record<string, unknown>): Store {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: options }, id: Z }),
    );
    for (const it of items) {
      s.registerNode(createNode({ kind: 'panel', id: asNodeId(it.id), parentId: Z }));
    }
    return s;
  }

  const configOf = (s: Store) =>
    s.getNode(Z)?.container?.config as { tracks?: { cols?: unknown[]; rows?: unknown[] } };

  function drag(
    s: Store,
    items: LayoutItem[],
    affordanceId: string,
    payload: LayoutEvent['payload'],
    w = 500,
    h = 400,
  ): void {
    const options = configOf(s) as Record<string, unknown>;
    const aff = run(items, options, w, h).affordances.find((a) => a.id === affordanceId);
    if (!aff) throw new Error(`no affordance ${affordanceId}`);
    gridStrategy.dispatchAffordance?.({
      event: { affordanceId, kind: 'drag', payload },
      affordance: aff,
      store: s,
      parentId: Z,
      container: { w, h },
      options,
      items,
    });
  }

  const seams = (r: ReturnType<typeof run>) => r.affordances.map((a) => a.id);
  const seam = (r: ReturnType<typeof run>, id: string): Affordance => {
    const a = r.affordances.find((x) => x.id === id);
    if (!a) throw new Error(`no ${id}`);
    return a;
  };

  it('emits a seam after each pixel track and between two shares, and none otherwise', () => {
    const r = run(ids(4), {
      resizable: true,
      tracks: { cols: [100, { share: 1 }, { share: 1 }, 80] },
    });
    // 0: pixel. 1: share before share. 2: share before pixel — no seam. 3: pixel, trailing.
    expect(seams(r).filter((id) => id.startsWith('track-x'))).toEqual([
      'track-x-0',
      'track-x-1',
      'track-x-3',
    ]);
  });

  it('replaces span seams on a tracked axis, and keeps them on the other', () => {
    const r = run(ids(3), { resizable: true, maxRows: 2, tracks: { cols: [100, 100] } });
    expect(seams(r).some((id) => id.startsWith('resize-x-'))).toBe(false);
    expect(seams(r).some((id) => id.startsWith('resize-y-'))).toBe(true);
  });

  it('emits none unless resizable', () => {
    expect(run(ids(2), { tracks: { cols: [100, 100] } }).affordances).toEqual([]);
  });

  it('sits in the gap after its track, across the grid, and names its track', () => {
    const r = run(ids(4), { resizable: true, gap: 10, tracks: { cols: [100, 100] } });
    const a = seam(r, 'track-x-0');
    expect(a.kind).toBe('resize-x');
    expect(a.rect).toMatchObject({ x: 103, y: 0, w: 4 });
    expect(a.rect.h).toBe(400);
    expect(a.name).toBe('resize column 1');
    expect(a.affects).toEqual(['i0', 'i2']);
    expect(a.bounds).toMatchObject({ orientation: 'horizontal', valueNow: 100 });
  });

  it('bounds a pixel track by what the other tracks leave', () => {
    const r = run(ids(2), { resizable: true, tracks: { cols: [100, { share: 1 }, 150] } });
    expect(seam(r, 'track-x-0').bounds).toMatchObject({ valueMin: 8, valueMax: 350 });
  });

  it('lets a pixel track grow to the whole width under overflowMode scroll', () => {
    const r = run(ids(2), {
      resizable: true,
      overflowMode: 'scroll',
      tracks: { cols: [100, 150] },
    });
    expect(seam(r, 'track-x-0').bounds?.valueMax).toBe(500);
  });

  it('writes a dragged pixel track into container config, resolving against the pointer', () => {
    const items = ids(3);
    const s = storeWith(items, { resizable: true, gap: 10, tracks: { cols: [100, 100, 100] } });
    drag(s, items, 'track-x-1', { point: { x: 263.4, y: 5 } });
    // Track 1 starts at 110; the seam sits 5px past its end, in the gap.
    expect(configOf(s).tracks?.cols).toEqual([100, 148, 100]);
  });

  it('steps a pixel track by a synthesized key press', () => {
    const items = ids(2);
    const s = storeWith(items, { resizable: true, tracks: { cols: [100, 100] } });
    drag(s, items, 'track-x-0', { dx: -8 });
    expect(configOf(s).tracks?.cols).toEqual([92, 100]);
  });

  it('clamps a pixel track to its bounds', () => {
    const items = ids(2);
    const s = storeWith(items, { resizable: true, tracks: { cols: [100, { share: 1 }] } });
    drag(s, items, 'track-x-0', { point: { x: -50, y: 0 } });
    expect(configOf(s).tracks?.cols).toEqual([8, { share: 1 }]);
    drag(s, items, 'track-x-0', { point: { x: 900, y: 0 } });
    expect(configOf(s).tracks?.cols).toEqual([500, { share: 1 }]);
  });

  it('trades share between the two tracks either side of a share seam', () => {
    const items = ids(2);
    const s = storeWith(items, { resizable: true, tracks: { cols: [{ share: 1 }, { share: 1 }] } });
    drag(s, items, 'track-x-0', { point: { x: 125, y: 0 } });
    expect(configOf(s).tracks?.cols).toEqual([{ share: 0.5 }, { share: 1.5 }]);
  });

  it('keeps the rest of the config when it writes tracks', () => {
    const items = ids(2);
    const s = storeWith(items, {
      resizable: true,
      gap: 4,
      tracks: { cols: [100, 100], rows: [30] },
    });
    drag(s, items, 'track-x-0', { dx: 10 });
    expect(configOf(s)).toMatchObject({ gap: 4, resizable: true, tracks: { rows: [30] } });
  });

  it('writes the implicit sizes of the tracks before the one dragged', () => {
    const items = ids(8);
    const s = storeWith(items, {
      resizable: true,
      cols: 2,
      cell: { h: 30 },
      tracks: { rows: [40] },
    });
    drag(s, items, 'track-y-2', { point: { x: 0, y: 150 } });
    // Rows 0..2 end at 40, 70, 100; row 2 starts at 70, so 80px.
    expect(configOf(s).tracks?.rows).toEqual([40, 30, 80]);
  });

  it('resolves a span seam on the other axis against the tracks', () => {
    const items = ids(4);
    const opts = { resizable: true, cols: 2, tracks: { rows: [100, 100, 100] } };
    const s = storeWith(items, opts);
    drag(s, items, 'resize-x-i0', { point: { x: 480, y: 0 } });
    expect(s.getPlacement(asNodeId('i0')).span).toEqual({ cols: 2 });
  });
});
