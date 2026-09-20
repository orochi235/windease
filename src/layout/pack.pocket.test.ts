import { describe, expect, it } from 'vitest';
import type { LayoutItem, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { columnStrategy } from './column.js';
import { justifiedStrategy } from './justified.js';
import { shelfStrategy } from './shelf.js';
import { skylineStrategy } from './skyline.js';

const CONTAINER: Size = { w: 300, h: 300 };
const POCKET = { w: 40, h: 40 };

const sized = (id: string, w: number, h: number): LayoutItem => ({
  id,
  hints: { preferredSize: { w, h } },
});

const run = (
  strategy: LayoutStrategy<void, string>,
  items: LayoutItem[],
  options: Record<string, unknown> = {},
  container: Size = CONTAINER,
) => strategy.layout({ items, container, state: undefined, options });

const inside = (rect: Rect, box: Rect) =>
  rect.x >= box.x - 1e-6 &&
  rect.y >= box.y - 1e-6 &&
  rect.x + rect.w <= box.x + box.w + 1e-6 &&
  rect.y + rect.h <= box.y + box.h + 1e-6;

/** The smallest box holding every rect in `ids`. */
function hull(placements: Map<string, Rect>, ids: string[]): Rect {
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const r = placements.get(id)!;
    x = Math.min(x, r.x);
    y = Math.min(y, r.y);
    right = Math.max(right, r.x + r.w);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return { x, y, z: 0, w: right - x, h: bottom - y };
}

const PACKERS: [string, LayoutStrategy<void, string>][] = [
  ['shelf', shelfStrategy],
  ['column', columnStrategy],
  ['skyline', skylineStrategy],
];

describe.each(PACKERS)('%s — pocket', (_name, strategy) => {
  const bigs = [sized('a', 150, 100), sized('b', 140, 100)];
  const smalls = [sized('s1', 20, 20), sized('s2', 20, 20), sized('s3', 30, 30)];

  it('lays the flow out as if the small items were not there', () => {
    const flowOnly = run(strategy, bigs);
    const withKey = run(strategy, [...bigs, ...smalls], { pocket: POCKET });
    for (const id of ['a', 'b']) {
      expect(withKey.placements.get(id)).toEqual(flowOnly.placements.get(id));
    }
  });

  it('changes nothing when the key is absent', () => {
    const items = [...bigs, ...smalls];
    expect(run(strategy, items, {}).placements).toEqual(run(strategy, items).placements);
  });

  it('places every item, small ones included', () => {
    const out = run(strategy, [...bigs, ...smalls], { pocket: POCKET });
    expect(out.unplaced ?? []).toEqual([]);
    expect(out.placements.size).toBe(5);
  });

  it('gathers the small items into one rectangle clear of the big ones', () => {
    const out = run(strategy, [...bigs, ...smalls], { pocket: POCKET });
    const pocketBox = hull(out.placements, ['s1', 's2', 's3']);
    for (const id of ['a', 'b']) {
      const big = out.placements.get(id)!;
      const apart =
        big.x + big.w <= pocketBox.x + 1e-6 ||
        pocketBox.x + pocketBox.w <= big.x + 1e-6 ||
        big.y + big.h <= pocketBox.y + 1e-6 ||
        pocketBox.y + pocketBox.h <= big.y + 1e-6;
      expect(apart, `${id} overlaps the pocket`).toBe(true);
    }
  });

  it('marks pocketed items with a pocket channel and leaves the rest unmarked', () => {
    const out = run(strategy, [...bigs, ...smalls], { pocket: POCKET });
    for (const id of ['s1', 's2', 's3']) expect(out.channels?.get(id)?.pocket).toBe(1);
    for (const id of ['a', 'b']) expect(out.channels?.get(id)?.pocket).toBeUndefined();
  });

  it('keeps an item long on one axis in the flow', () => {
    const long = sized('long', 20, 200);
    const out = run(strategy, [...bigs, long], { pocket: POCKET });
    expect(out.channels?.get('long')?.pocket).toBeUndefined();
  });

  it('packs into the whole container when every item is small', () => {
    const out = run(strategy, smalls, { pocket: POCKET });
    expect(out.unplaced ?? []).toEqual([]);
    const box = hull(out.placements, ['s1', 's2', 's3']);
    expect(inside(box, { x: 0, y: 0, z: 0, ...CONTAINER })).toBe(true);
  });

  it('keeps a gap between the pocket and the flow', () => {
    const out = run(strategy, [...bigs, ...smalls], { pocket: POCKET, gap: 12 });
    const pocketBox = hull(out.placements, ['s1', 's2', 's3']);
    for (const id of ['a', 'b']) {
      const big = out.placements.get(id)!;
      const apart =
        big.x + big.w + 12 <= pocketBox.x + 1e-6 ||
        pocketBox.x + pocketBox.w + 12 <= big.x + 1e-6 ||
        big.y + big.h + 12 <= pocketBox.y + 1e-6 ||
        pocketBox.y + pocketBox.h + 12 <= big.y + 1e-6;
      expect(apart, `${id} sits closer than the gap to the pocket`).toBe(true);
    }
  });

  it('reads an unusable pocket as absent', () => {
    for (const pocket of [{ w: 0, h: 40 }, { w: 40, h: Number.NaN }, {}, null, 40]) {
      const out = run(strategy, [...bigs, ...smalls], { pocket });
      expect(out.channels?.get('s1')?.pocket).toBeUndefined();
    }
  });

  it('bins what the pocket cannot hold under overflowMode unplaced', () => {
    const many = Array.from({ length: 40 }, (_, i) => sized(`s${i}`, 30, 30));
    const out = run(strategy, [sized('a', 300, 240), ...many], {
      pocket: POCKET,
      overflowMode: 'unplaced',
    });
    expect(out.unplaced?.length ?? 0).toBeGreaterThan(0);
    for (const [, rect] of out.placements) {
      expect(inside(rect, { x: 0, y: 0, z: 0, ...CONTAINER })).toBe(true);
    }
  });

  it('spills past the pocket and reports overflow under overflowMode scroll', () => {
    const many = Array.from({ length: 40 }, (_, i) => sized(`s${i}`, 30, 30));
    const out = run(strategy, [sized('a', 300, 240), ...many], {
      pocket: POCKET,
      overflowMode: 'scroll',
    });
    expect(out.unplaced ?? []).toEqual([]);
    expect(out.overflow?.h ?? 0).toBeGreaterThan(0);
  });
});

describe('justified — pocket', () => {
  const photos = [sized('p1', 300, 200), sized('p2', 400, 200), sized('p3', 300, 200)];
  const thumbs = [sized('t1', 30, 30), sized('t2', 30, 30)];

  it('drops the thumbnails out of the rows into the pocket', () => {
    const out = run(justifiedStrategy, [...photos, ...thumbs], {
      pocket: POCKET,
      rowHeight: 100,
    });
    for (const id of ['t1', 't2']) expect(out.channels?.get(id)?.pocket).toBe(1);
    for (const id of ['p1', 'p2', 'p3']) expect(out.channels?.get(id)?.pocket).toBeUndefined();
  });

  it('keeps the rows themselves as they were', () => {
    const without = run(justifiedStrategy, photos, { rowHeight: 100 });
    const withPocket = run(justifiedStrategy, [...photos, ...thumbs], {
      pocket: POCKET,
      rowHeight: 100,
    });
    for (const id of ['p1', 'p2', 'p3']) {
      expect(withPocket.placements.get(id)).toEqual(without.placements.get(id));
    }
  });
});
