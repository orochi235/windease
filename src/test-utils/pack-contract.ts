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

    it('keeps a row that fills the width exactly on one row despite float drift', () => {
      // Six sixths of 100 sum to 100.00000000000001.
      const items = Array.from({ length: 6 }, (_, i) => sized(`t${i}`, 100 / 6, 10));
      const result = runPack(strategy, items, { w: 100, h: 10 });
      expect(new Set([...result.placements.values()].map((r) => r.y))).toEqual(new Set([0]));
      expect(result.overflow).toBeUndefined();
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

    it('lays out in the order given under sort none, the default', () => {
      expect(runPack(strategy, boxes, container, { gap: 4, sort: 'none' })).toEqual(
        runPack(strategy, boxes, container, { gap: 4 }),
      );
    });

    describe("overflowMode 'unplaced'", () => {
      const bin = { w: 400, h: 300 };
      const bounded = { gap: 6, overflowMode: 'unplaced' };

      it('keeps every placement inside the container and reports no overflow', () => {
        const result = runPack(strategy, boxes, bin, bounded);
        expect(result.placements.size).toBeGreaterThan(0);
        expect(result.unplaced?.length ?? 0).toBeGreaterThan(0);
        for (const rect of result.placements.values()) {
          expect(rect.x + rect.w).toBeLessThanOrEqual(bin.w);
          expect(rect.y + rect.h).toBeLessThanOrEqual(bin.h);
        }
        expect(result.overflow).toBeUndefined();
        expect(crowded(result.placements, 6)).toEqual([]);
      });

      it('lists every id once, placed or unplaced, each in input order', () => {
        const items = [{ id: 'bare' }, ...boxes];
        const result = runPack(strategy, items, bin, bounded);
        const placed = [...result.placements.keys()];
        const unplaced = result.unplaced ?? [];
        const order = items.map((i) => i.id);
        expect([...placed, ...unplaced].sort()).toEqual([...order].sort());
        expect(placed).toEqual(order.filter((id) => result.placements.has(id)));
        expect(unplaced).toEqual(order.filter((id) => !result.placements.has(id)));
      });

      it('lays out as the default does when everything fits', () => {
        const roomy = { w: 400, h: 100_000 };
        expect(runPack(strategy, boxes, roomy, bounded)).toEqual(
          runPack(strategy, boxes, roomy, { gap: 6 }),
        );
      });

      it('sends an item taller or wider than the container to unplaced, even the first', () => {
        const items = [sized('tall', 50, 120), sized('wide', 120, 50), sized('ok', 50, 50)];
        const result = runPack(strategy, items, { w: 100, h: 100 }, bounded);
        expect([...result.placements.keys()]).toEqual(['ok']);
        expect(result.placements.get('ok')).toMatchObject({ x: 0, y: 0 });
        expect(result.unplaced).toEqual(['tall', 'wide']);
      });

      it('still places a later item that fits where an earlier one did not', () => {
        const items = [sized('a', 100, 60), sized('b', 100, 60), sized('c', 100, 30)];
        const result = runPack(strategy, items, { w: 100, h: 100 }, { overflowMode: 'unplaced' });
        expect(result.placements.get('c')).toMatchObject({ x: 0, y: 60 });
        expect(result.unplaced).toEqual(['b']);
      });

      it("lays out under 'scroll' as the default does", () => {
        expect(runPack(strategy, boxes, bin, { gap: 6, overflowMode: 'scroll' })).toEqual(
          runPack(strategy, boxes, bin, { gap: 6 }),
        );
      });
    });

    describe('rotate', () => {
      const result = runPack(strategy, boxes, container, { gap: 8, rotate: true });

      it('places each box at its own size or turned a quarter, and says which in channels', () => {
        expect(result.placements.size).toBe(boxes.length);
        for (const box of boxes) {
          const { w, h } = box.hints!.preferredSize!;
          const rect = result.placements.get(box.id)!;
          const rotation = result.channels?.get(box.id)?.rotation;
          if (rotation === 90) expect({ w: rect.w, h: rect.h }).toEqual({ w: h, h: w });
          else {
            expect(rotation).toBe(0);
            expect({ w: rect.w, h: rect.h }).toEqual({ w, h });
          }
        }
        expect(result.channels?.size).toBe(boxes.length);
      });

      it('keeps every pair gap apart and every box inside the width', () => {
        expect(crowded(result.placements, 8)).toEqual([]);
        for (const rect of result.placements.values()) {
          expect(rect.x + rect.w).toBeLessThanOrEqual(container.w);
        }
      });

      it('turns some of an assorted set, and never a square', () => {
        const turned = [...(result.channels?.values() ?? [])].filter((c) => c.rotation === 90);
        expect(turned.length).toBeGreaterThan(0);
        const squares = Array.from({ length: 12 }, (_, i) =>
          sized(`q${i}`, 40 + i * 5, 40 + i * 5),
        );
        const packed = runPack(strategy, squares, container, { gap: 8, rotate: true });
        expect([...packed.channels!.values()].every((c) => c.rotation === 0)).toBe(true);
      });

      it('turns an item wider than the container when turned it fits', () => {
        const items = [sized('a', 100, 50), sized('long', 500, 40)];
        const packed = runPack(strategy, items, { w: 400, h: 1000 }, { rotate: true });
        expect(packed.placements.get('long')).toMatchObject({ w: 40, h: 500 });
        expect(packed.channels?.get('long')).toEqual({ rotation: 90 });
        expect(packed.overflow?.w ?? 0).toBe(0);
      });

      it('turns an item taller than a bounded container when turned it fits', () => {
        const items = [sized('post', 20, 150)];
        const packed = runPack(
          strategy,
          items,
          { w: 200, h: 100 },
          {
            rotate: true,
            overflowMode: 'unplaced',
          },
        );
        expect(packed.placements.get('post')).toEqual({ x: 0, y: 0, z: 0, w: 150, h: 20 });
        expect(packed.unplaced).toBeUndefined();
      });

      it('emits no channels without rotate', () => {
        expect(runPack(strategy, boxes, container, { gap: 8 }).channels).toBeUndefined();
        expect(runPack(strategy, boxes, container, { gap: 8, rotate: false })).toEqual(
          runPack(strategy, boxes, container, { gap: 8 }),
        );
      });

      it('returns the same layout on every call', () => {
        expect(runPack(strategy, boxes, container, { gap: 8, rotate: true })).toEqual(result);
      });
    });

    for (const [sort, key] of SORT_CASES) {
      describe(`sort '${sort}'`, () => {
        const items = [{ id: 'bare' }, ...boxes];
        const result = runPack(strategy, items, container, { gap: 8, sort });

        it('never changes the set of placed ids, and keys the result in input order', () => {
          expect([...result.placements.keys()]).toEqual(boxes.map((b) => b.id));
          expect(result.unplaced).toEqual(['bare']);
        });

        it('keeps every box at its own size and every pair gap apart', () => {
          for (const box of boxes) {
            const rect = result.placements.get(box.id)!;
            expect({ w: rect.w, h: rect.h }).toEqual(box.hints?.preferredSize);
          }
          expect(crowded(result.placements, 8)).toEqual([]);
        });

        it(`places the box with the greatest ${sort} first, at the origin`, () => {
          const first = [...boxes].sort(
            (a, b) => key(b.hints!.preferredSize!) - key(a.hints!.preferredSize!),
          )[0]!;
          expect(result.placements.get(first.id)).toMatchObject({ x: 0, y: 0 });
        });

        it('keeps input order among equal keys', () => {
          const same = Array.from({ length: 30 }, (_, i) => sized(`s${i}`, 60, 60));
          expect(runPack(strategy, same, container, { gap: 8, sort })).toEqual(
            runPack(strategy, same, container, { gap: 8 }),
          );
        });

        it('returns the same layout on every call', () => {
          expect(runPack(strategy, items, container, { gap: 8, sort })).toEqual(result);
        });
      });
    }
  });
}

const SORT_CASES: [string, (s: Size) => number][] = [
  ['height', (s) => s.h],
  ['width', (s) => s.w],
  ['area', (s) => s.w * s.h],
  ['max-side', (s) => Math.max(s.w, s.h)],
];
