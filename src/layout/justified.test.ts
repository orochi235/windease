import { describe, expect, it } from 'vitest';
import type { LayoutItem, Rect } from '../layout-types.js';
import { describePackContract, runPack } from '../test-utils/pack-contract.js';
import { justifiedStrategy } from './justified.js';

describePackContract(justifiedStrategy, { scales: true, rearranges: false });

const shaped = (id: string, aspect: number): LayoutItem => ({ id, hints: { aspect } });

/** Placements grouped into rows by `y`, top to bottom, each row left to right. */
function rows(placements: Map<string, Rect>): Rect[][] {
  const byY = new Map<number, Rect[]>();
  for (const rect of placements.values()) {
    const row = byY.get(rect.y) ?? [];
    row.push(rect);
    byY.set(rect.y, row);
  }
  return [...byY.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort((a, b) => a.x - b.x));
}

const right = (row: Rect[]) => row[row.length - 1]!.x + row[row.length - 1]!.w;

describe('justifiedStrategy', () => {
  const aspects = [1.5, 0.67, 1, 2.4, 1.33, 0.75, 4, 1.5, 1, 0.8, 1.78, 1.2, 0.56, 3, 1.5];
  const photos = aspects.map((a, i) => shaped(`p${i}`, a));

  it('fills every row but the last to the width exactly', () => {
    const r = runPack(justifiedStrategy, photos, { w: 900, h: 600 }, { rowHeight: 160, gap: 6 });
    const all = rows(r.placements);
    expect(all.length).toBeGreaterThan(2);
    for (const row of all.slice(0, -1)) {
      expect(row[0]!.x).toBe(0);
      expect(right(row)).toBeCloseTo(900, 9);
    }
  });

  it('keeps each item at its own aspect, one height per row', () => {
    const r = runPack(justifiedStrategy, photos, { w: 900, h: 600 }, { rowHeight: 160, gap: 6 });
    for (const item of photos) {
      const rect = r.placements.get(item.id)!;
      expect(rect.w / rect.h).toBeCloseTo(item.hints!.aspect!, 9);
    }
    for (const row of rows(r.placements)) {
      expect(new Set(row.map((rect) => rect.h)).size).toBe(1);
    }
  });

  it('puts gap between items in a row and between rows', () => {
    const r = runPack(justifiedStrategy, photos, { w: 900, h: 600 }, { rowHeight: 160, gap: 6 });
    const all = rows(r.placements);
    for (const row of all) {
      for (let i = 1; i < row.length; i++) {
        expect(row[i]!.x - (row[i - 1]!.x + row[i - 1]!.w)).toBeCloseTo(6, 9);
      }
    }
    for (let i = 1; i < all.length; i++) {
      expect(all[i]![0]!.y - (all[i - 1]![0]!.y + all[i - 1]![0]!.h)).toBeCloseTo(6, 9);
    }
  });

  it('leaves a short last row ragged at the target height', () => {
    const items = [shaped('a', 1), shaped('b', 1)];
    const r = runPack(justifiedStrategy, items, { w: 1000, h: 400 }, { rowHeight: 100 });
    expect(r.placements.get('a')).toEqual({ x: 0, y: 0, z: 0, w: 100, h: 100 });
    expect(r.placements.get('b')).toEqual({ x: 100, y: 0, z: 0, w: 100, h: 100 });
  });

  it('stretches the last row to the width with justifyLast', () => {
    const items = [shaped('a', 1), shaped('b', 1)];
    const r = runPack(
      justifiedStrategy,
      items,
      { w: 1000, h: 400 },
      { rowHeight: 100, justifyLast: true, gap: 10 },
    );
    expect(r.placements.get('b')).toEqual({ x: 505, y: 0, z: 0, w: 495, h: 495 });
  });

  it('shrinks a last row too wide for the width at the target height', () => {
    const r = runPack(
      justifiedStrategy,
      [shaped('pano', 8)],
      { w: 400, h: 400 },
      { rowHeight: 100 },
    );
    expect(r.placements.get('pano')).toEqual({ x: 0, y: 0, z: 0, w: 400, h: 50 });
  });

  it('leaves a row ragged at the target height when filling it would pass maxRowHeight', () => {
    // A lone portrait can only fill 300px by growing to 600 tall.
    const items = [shaped('tall', 0.5)];
    const options = { rowHeight: 100, justifyLast: true };
    const container = { w: 300, h: 1000 };
    const free = runPack(justifiedStrategy, items, container, options);
    expect(free.placements.get('tall')).toMatchObject({ w: 300, h: 600 });
    const capped = runPack(justifiedStrategy, items, container, { ...options, maxRowHeight: 200 });
    expect(capped.placements.get('tall')).toEqual({ x: 0, y: 0, z: 0, w: 50, h: 100 });
  });

  describe('minRowHeight', () => {
    // Wide panoramas in 1000px: all on one row is 71.4 tall, the least deviation from 100.
    const panos = [shaped('a', 4), shaped('b', 5), shaped('c', 5)];
    const container = { w: 1000, h: 1000 };
    const heights = (options: Record<string, unknown>) =>
      rows(runPack(justifiedStrategy, panos, container, options).placements).map((row) =>
        row.map((r) => r.h),
      );

    it('takes fewer items on a row that would shrink below the floor', () => {
      const options = { rowHeight: 100, justifyLast: true };
      expect(heights(options)).toEqual([[1000 / 14, 1000 / 14, 1000 / 14]]);
      expect(heights({ ...options, minRowHeight: 80 })).toEqual([[1000 / 9, 1000 / 9], [200]]);
    });

    it('fills the width below the floor when that strays least outside the band', () => {
      // Under a 150 cap every split leaves a row 50 or more past it; one row is 8.6 under 80.
      const options = { rowHeight: 100, justifyLast: true, minRowHeight: 80, maxRowHeight: 150 };
      expect(heights(options)).toEqual([[1000 / 14, 1000 / 14, 1000 / 14]]);
    });

    it('still gives a lone item too wide to reach the floor a row, scaled to the width', () => {
      const r = runPack(justifiedStrategy, [shaped('pano', 20), shaped('b', 1)], container, {
        rowHeight: 100,
        minRowHeight: 80,
      });
      expect(r.placements.get('pano')).toEqual({ x: 0, y: 0, z: 0, w: 1000, h: 50 });
      expect(r.placements.get('b')).toEqual({ x: 0, y: 50, z: 0, w: 100, h: 100 });
    });

    it('reads a floor above rowHeight as rowHeight, and ignores an unusable one', () => {
      const options = { rowHeight: 100, justifyLast: true };
      expect(heights({ ...options, minRowHeight: 300 })).toEqual(
        heights({ ...options, minRowHeight: 100 }),
      );
      for (const minRowHeight of [0, -5, Number.NaN, 'tall']) {
        expect(heights({ ...options, minRowHeight })).toEqual(heights(options));
      }
    });
  });

  it('reads hints.aspect before the measured or preferred size', () => {
    const item: LayoutItem = {
      id: 'x',
      hints: { aspect: 2, preferredSize: { w: 10, h: 10 } },
      natural: { w: 30, h: 10 },
    };
    const rect = runPack(
      justifiedStrategy,
      [item],
      { w: 1000, h: 400 },
      { rowHeight: 50 },
    ).placements.get('x')!;
    expect(rect).toMatchObject({ w: 100, h: 50 });
  });

  it('falls back to the size when hints.aspect is unusable, and unplaces an item with neither', () => {
    const items: LayoutItem[] = [
      { id: 'zero', hints: { aspect: 0, preferredSize: { w: 20, h: 10 } } },
      shaped('nan', Number.NaN),
      shaped('negative', -1),
      shaped('infinite', Number.POSITIVE_INFINITY),
    ];
    const r = runPack(justifiedStrategy, items, { w: 1000, h: 400 }, { rowHeight: 50 });
    expect(r.placements.get('zero')).toMatchObject({ w: 100, h: 50 });
    expect(r.unplaced).toEqual(['nan', 'negative', 'infinite']);
  });

  it('defaults rowHeight to 200 and ignores an unusable one', () => {
    const one = [shaped('a', 1)];
    for (const rowHeight of [undefined, 0, -5, Number.NaN, 'tall']) {
      const r = runPack(justifiedStrategy, one, { w: 1000, h: 400 }, { rowHeight });
      expect(r.placements.get('a')).toMatchObject({ w: 200, h: 200 });
    }
  });

  it('unplaces everything in a container with no width', () => {
    const r = runPack(justifiedStrategy, [shaped('a', 1)], { w: 0, h: 400 });
    expect(r.placements.size).toBe(0);
    expect(r.unplaced).toEqual(['a']);
  });

  it('breaks rows where the total height deviation from the target is least', () => {
    const t = 100;
    const w = 600;
    const set = [1.2, 0.7, 2.5, 1, 1.9, 0.6, 1.4, 3.2, 0.9, 1.1].map((a, i) => shaped(`s${i}`, a));
    const r = runPack(justifiedStrategy, set, { w, h: 400 }, { rowHeight: t, justifyLast: true });
    const cost = (heights: number[]) => heights.reduce((sum, h) => sum + (h - t) ** 2, 0);
    const got = cost(rows(r.placements).map((row) => row[0]!.h));

    const a = set.map((item) => item.hints!.aspect!);
    let best = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 1 << (a.length - 1); mask++) {
      const heights: number[] = [];
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        sum += a[i]!;
        if (i === a.length - 1 || mask & (1 << i)) {
          heights.push(w / sum);
          sum = 0;
        }
      }
      best = Math.min(best, cost(heights));
    }
    expect(got).toBeCloseTo(best, 6);
  });

  describe('breaks rows to stray least outside minRowHeight–maxRowHeight, then deviate least', () => {
    const t = 100;
    const w = 600;
    const a = [1.2, 0.7, 2.5, 1, 1.9, 0.6, 1.4, 3.2, 0.9, 1.1];
    const set = a.map((aspect, i) => shaped(`s${i}`, aspect));
    const options = { rowHeight: t, justifyLast: true };
    const fills = (options: Record<string, unknown>) =>
      rows(runPack(justifiedStrategy, set, { w, h: 400 }, options).placements).map(
        (row) => w / row.reduce((sum, rect) => sum + rect.w / rect.h, 0),
      );

    it.each([
      { min: 90, max: Number.POSITIVE_INFINITY },
      { min: 85, max: 115 },
      { min: 0, max: 105 },
    ])('$min–$max matches an exhaustive search', ({ min, max }) => {
      const score = (heights: number[]): [number, number] => [
        heights.reduce((sum, h) => sum + Math.max(0, min - h, h - max) ** 2, 0),
        heights.reduce((sum, h) => sum + (h - t) ** 2, 0),
      ];
      let best: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      for (let mask = 0; mask < 1 << (a.length - 1); mask++) {
        const heights: number[] = [];
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
          sum += a[i]!;
          if (i === a.length - 1 || mask & (1 << i)) {
            heights.push(w / sum);
            sum = 0;
          }
        }
        const s = score(heights);
        const tie = Math.abs(s[0] - best[0]) <= 1e-9;
        if ((!tie && s[0] < best[0]) || (tie && s[1] < best[1])) best = s;
      }
      const got = score(fills({ ...options, minRowHeight: min, maxRowHeight: max }));
      expect(got[0]).toBeCloseTo(best[0], 6);
      expect(got[1]).toBeCloseTo(best[1], 6);
    });

    it('moves the breaks where deviation alone would leave rows under the floor', () => {
      expect(fills(options).some((h) => h < 90)).toBe(true);
      expect(fills({ ...options, minRowHeight: 90 }).every((h) => h >= 90)).toBe(true);
    });
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(justifiedStrategy.configSpec ?? {})).toEqual([
      'rowHeight',
      'gap',
      'maxRowHeight',
      'minRowHeight',
      'justifyLast',
      'pocket',
    ]);
  });
});
