import { describe, expect, it } from 'vitest';
import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';

export function runPack(
  strategy: LayoutStrategy<void, string>,
  items: LayoutItem[],
  container: Size,
  options: Record<string, unknown> = {},
): LayoutResult<string> {
  return strategy.layout({ items, container, state: undefined as void, options });
}

export const sized = (id: string, w: number, h: number): LayoutItem => ({
  id,
  hints: { preferredSize: { w, h } },
});

/** Boxes of varied sizes, identical on every call. */
export function assortedBoxes(count: number): LayoutItem[] {
  let seed = 7;
  const next = (lo: number, hi: number) => {
    seed = (seed * 48271) % 2147483647;
    return lo + (seed % (hi - lo + 1));
  };
  return Array.from({ length: count }, (_, i) => sized(`box-${i}`, next(20, 140), next(20, 160)));
}

function apart(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

/** Pairs of ids placed closer than `gap` — overlapping, at `gap` 0. */
function crowded(placements: Map<string, Rect>, gap: number): string[] {
  const entries = [...placements.entries()];
  const found: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i]!;
      const [idB, b] = entries[j]!;
      if (!apart(a, b, gap)) found.push(`${idA}/${idB}`);
    }
  }
  return found;
}

/** What every packing strategy promises, whatever its algorithm. */
export function describePackContract(strategy: LayoutStrategy<void, string>): void {
  describe(`${strategy.name}Strategy packing contract`, () => {
    const container = { w: 400, h: 300 };
    const boxes = assortedBoxes(40);

    for (const gap of [0, 8]) {
      it(`keeps every pair of placements at least gap ${gap} apart`, () => {
        const { placements } = runPack(strategy, boxes, container, { gap });
        expect(placements.size).toBe(boxes.length);
        expect(crowded(placements, gap)).toEqual([]);
      });

      it(`places every box at its own size inside the width, gap ${gap}`, () => {
        const { placements } = runPack(strategy, boxes, container, { gap });
        for (const box of boxes) {
          const rect = placements.get(box.id)!;
          expect({ w: rect.w, h: rect.h }).toEqual(box.hints?.preferredSize);
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(container.w);
        }
      });
    }

    it('places an item wider than the container at the left edge and reports width overflow', () => {
      const items = [sized('a', 100, 50), sized('wide', 500, 40), sized('b', 100, 50)];
      const result = runPack(strategy, items, { w: 400, h: 1000 }, { gap: 8 });
      expect(result.placements.get('wide')).toMatchObject({ x: 0, w: 500 });
      expect(result.overflow).toEqual({ w: 100, h: 0 });
      expect(crowded(result.placements, 8)).toEqual([]);
      for (const id of ['a', 'b']) {
        const rect = result.placements.get(id)!;
        expect(rect.x + rect.w).toBeLessThanOrEqual(400);
      }
    });

    it('returns the same layout on every call', () => {
      const first = runPack(strategy, boxes, container, { gap: 6 });
      const second = runPack(strategy, boxes, container, { gap: 6 });
      expect(second).toEqual(first);
    });

    it('sends items with no usable size to unplaced', () => {
      const items: LayoutItem[] = [
        { id: 'bare' },
        sized('ok', 50, 50),
        sized('flat', 40, 0),
        { id: 'negative', natural: { w: -1, h: 10 } },
      ];
      const result = runPack(strategy, items, container);
      expect([...result.placements.keys()]).toEqual(['ok']);
      expect(result.unplaced).toEqual(['bare', 'flat', 'negative']);
    });

    it('prefers the measured size over the preferred one', () => {
      const item: LayoutItem = {
        id: 'm',
        natural: { w: 30, h: 20 },
        hints: { preferredSize: { w: 90, h: 90 } },
      };
      expect(runPack(strategy, [item], container).placements.get('m')).toMatchObject({
        w: 30,
        h: 20,
      });
    });

    it('packs past the container height, reporting overflow only when it does', () => {
      const tall = runPack(strategy, boxes, { w: 400, h: 100_000 }, { gap: 4 });
      expect(tall.overflow).toBeUndefined();

      const short = runPack(strategy, boxes, { w: 400, h: 50 }, { gap: 4 });
      expect(short.placements).toEqual(tall.placements);
      const bottom = Math.max(...[...short.placements.values()].map((r) => r.y + r.h));
      expect(short.overflow).toEqual({ w: 0, h: bottom - 50 });
    });

    it('emits every rect at z 0, with no affordances and no unplaced when all fit', () => {
      const result = runPack(strategy, boxes, container);
      expect([...result.placements.values()].every((r) => r.z === 0)).toBe(true);
      expect(result.affordances).toEqual([]);
      expect(result.unplaced).toBeUndefined();
    });

    it('places nothing for no items', () => {
      expect(runPack(strategy, [], container)).toEqual({ placements: new Map(), affordances: [] });
    });
  });
}
