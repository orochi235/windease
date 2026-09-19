import { describe, expect, it } from 'vitest';
import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import {
  dropped,
  EPS,
  malformedRects,
  outOfBounds,
  overlaps,
  runScenario,
  type Scenario,
} from '../test-utils/exotic/invariants.js';
import {
  ALL_PRESETS,
  PACKERS,
  type PackerId,
  packScenario,
} from '../test-utils/exotic/pack-scenarios.js';
import type { Preset } from '../test-utils/exotic/preset.js';
import { columnStrategy } from './column.js';
import { shelfStrategy } from './shelf.js';
import { skylineStrategy } from './skyline.js';

const STRATEGIES: Record<PackerId, LayoutStrategy<void, string>> = {
  shelf: shelfStrategy,
  skyline: skylineStrategy,
  column: columnStrategy,
};

const preset = (id: string): Preset => {
  const found = ALL_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
};

const sizeOf = (item: LayoutItem): Size | undefined => item.hints?.preferredSize;
const gapOf = (s: Scenario): number => (typeof s.options.gap === 'number' ? s.options.gap : 0);

function run(p: Preset, packer: PackerId, patch?: (s: Scenario) => Scenario) {
  const base = packScenario(p, packer);
  const scenario = patch ? patch(base) : base;
  return { scenario, result: runScenario(STRATEGIES[packer], scenario) };
}

function extent(placements: Map<string, Rect>): { right: number; bottom: number; area: number } {
  let right = 0;
  let bottom = 0;
  let area = 0;
  for (const r of placements.values()) {
    right = Math.max(right, r.x + r.w);
    bottom = Math.max(bottom, r.y + r.h);
    area += r.w * r.h;
  }
  return { right, bottom, area };
}

/** Area placed over the placements' bounding box. */
function density(result: LayoutResult<string>): number {
  const { right, bottom, area } = extent(result.placements);
  return right > 0 && bottom > 0 ? area / (right * bottom) : 0;
}

/** `overlaps` from invariants, as a y-sorted sweep so thousands of rects stay cheap. */
function sweepOverlaps(placements: Map<string, Rect>, gap: number): string[] {
  const entries = [...placements.entries()]
    .filter(([, r]) => r.w > 0 && r.h > 0)
    .sort((a, b) => a[1].y - b[1].y);
  const found: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [idA, a] = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const [idB, b] = entries[j]!;
      if (a.y + a.h + gap <= b.y + EPS) break;
      if (a.z !== b.z) continue;
      const apart = a.x + a.w + gap <= b.x + EPS || b.x + b.w + gap <= a.x + EPS;
      if (!apart) found.push(`${idA}/${idB}`);
    }
  }
  return found;
}

const collisions = (placements: Map<string, Rect>, gap: number): string[] =>
  placements.size <= 1500 ? overlaps(placements, gap) : sweepOverlaps(placements, gap);

/** Ids grouped by row (shared `y`), rows top to bottom. */
function rows(result: LayoutResult<string>): string[][] {
  const byY = new Map<number, string[]>();
  for (const [id, r] of result.placements) byY.set(r.y, [...(byY.get(r.y) ?? []), id]);
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
}

describe.each(ALL_PRESETS.map((p) => [p.id, p] as const))('%s', (_id, p) => {
  describe.each(PACKERS)('%s', (packer) => {
    const { scenario, result } = run(p, packer);
    const gap = gapOf(scenario);
    const W = scenario.container.w;

    it('places every sized item once, sends the unsized to unplaced, and drops nothing', () => {
      expect(dropped(scenario.items, result)).toEqual([]);
      const unsized = scenario.items.filter((i) => !sizeOf(i)).map((i) => i.id);
      expect(result.unplaced ?? []).toEqual(unsized);
      expect(result.placements.size).toBe(scenario.items.length - unsized.length);
      expect(malformedRects(result.placements)).toEqual([]);
    });

    it('keeps every pair at least the gap apart', () => {
      expect(collisions(result.placements, gap)).toEqual([]);
    });

    it('places every item at its own size, inside the width unless wider than it', () => {
      const wrong: string[] = [];
      for (const item of scenario.items) {
        const size = sizeOf(item);
        const rect = result.placements.get(item.id);
        if (!size || !rect) continue;
        if (rect.w !== size.w || rect.h !== size.h) wrong.push(`${item.id} resized`);
        if (size.w > W ? rect.x !== 0 : rect.x + rect.w > W + EPS)
          wrong.push(`${item.id} at ${rect.x}`);
      }
      expect(wrong).toEqual([]);
      expect(
        outOfBounds(result.placements, {
          w: Number.POSITIVE_INFINITY,
          h: Number.POSITIVE_INFINITY,
        }),
      ).toEqual([]);
    });

    it('reports overflow as the far edges past the container, and nothing when none', () => {
      const { right, bottom } = extent(result.placements);
      const past = (edge: number, limit: number) => (edge > limit + EPS ? edge - limit : 0);
      const w = past(right, W);
      const h = past(bottom, scenario.container.h);
      if (w > 0 || h > 0) expect(result.overflow).toEqual({ w, h });
      else expect(result.overflow).toBeUndefined();
    });

    it('is deterministic', () => {
      expect(runScenario(STRATEGIES[packer], scenario)).toEqual(result);
    });
  });
});

describe('packing quality against the literature', () => {
  const allFit = (s: Scenario) => s.items.every((i) => (sizeOf(i)?.w ?? 0) <= s.container.w);

  // Coffman, Garey, Johnson & Tarjan (1980): next-fit decreasing height packs to
  // at most 2·A/W + h_max. A gap g is the same as packing (w+g)×(h+g) into W+g.
  describe.each(
    ALL_PRESETS.filter((p) => allFit(packScenario(p, 'shelf'))).map((p) => [p.id, p] as const),
  )('shelf sorted tallest first stays within the NFDH bound: %s', (_id, p) => {
    it('height + gap ≤ 2·A/(W+gap) + h_max + gap', () => {
      const { scenario, result } = run(p, 'shelf', (s) => ({
        ...s,
        items: [...s.items].sort((a, b) => (sizeOf(b)?.h ?? 0) - (sizeOf(a)?.h ?? 0)),
      }));
      const g = gapOf(scenario);
      let area = 0;
      let hMax = 0;
      for (const r of result.placements.values()) {
        area += (r.w + g) * (r.h + g);
        hMax = Math.max(hMax, r.h);
      }
      const { bottom } = extent(result.placements);
      expect(bottom + g).toBeLessThanOrEqual(
        (2 * area) / (scenario.container.w + g) + hMax + g + EPS,
      );
    });
  });

  /** Column count and whether every item fits one column, the way columnStrategy derives both. */
  function columns(s: Scenario): { count: number; single: boolean } {
    const g = gapOf(s);
    const widths = s.items.map((i) => sizeOf(i)?.w).filter((w): w is number => w !== undefined);
    const cw =
      typeof s.options.columnWidth === 'number' ? s.options.columnWidth : Math.min(...widths);
    return {
      count: Math.max(1, Math.floor((s.container.w + g) / (cw + g))),
      single: widths.every((w) => w <= cw),
    };
  }

  // Graham (1966) list scheduling: greedy shortest-column finishes by Σ(h+g)/m + h_max.
  describe.each(
    ALL_PRESETS.filter((p) => columns(packScenario(p, 'column')).single).map(
      (p) => [p.id, p] as const,
    ),
  )('masonry with single-column items stays within Graham’s bound: %s', (_id, p) => {
    it('height ≤ Σ(h+gap)/columns + h_max', () => {
      const { scenario, result } = run(p, 'column');
      const g = gapOf(scenario);
      let total = 0;
      let hMax = 0;
      for (const r of result.placements.values()) {
        total += r.h + g;
        hMax = Math.max(hMax, r.h);
      }
      const { bottom } = extent(result.placements);
      expect(bottom).toBeLessThanOrEqual(total / columns(scenario).count + hMax + EPS);
    });
  });

  it.each([
    'texturepacker-pow2-sheet',
    'kenney-sprite-sheet',
    'flat-pack-van-floor',
    'staircase-widths',
    'google-keep-notes',
    'ten-thousand-thumbnails',
  ])('skyline packs %s at least as densely as shelf', (id) => {
    expect(density(run(preset(id), 'skyline').result)).toBeGreaterThanOrEqual(
      density(run(preset(id), 'shelf').result),
    );
  });

  it('skyline wastes under 3% of a power-of-two sheet', () => {
    expect(density(run(preset('texturepacker-pow2-sheet'), 'skyline').result)).toBeGreaterThan(
      0.97,
    );
  });

  it('shelf packs a feed shorter when the caller sorts it tallest first', () => {
    const p = preset('ascending-heights');
    const asGiven = extent(run(p, 'shelf').result.placements).bottom;
    const sorted = extent(
      run(p, 'shelf', (s) => ({ ...s, items: [...s.items].reverse() })).result.placements,
    ).bottom;
    expect(sorted).toBeLessThan(asGiven);
  });
});

describe('real layouts, packer by packer', () => {
  it.each(PACKERS)(
    '%s clamps the full-bleed Pinterest module to x 0, above nothing that came before',
    (packer) => {
      const { scenario, result } = run(preset('pinterest-home-feed'), packer);
      const ids = scenario.items.map((i) => i.id);
      const wideId = ids[9]!;
      const wide = result.placements.get(wideId)!;
      expect(wide.x).toBe(0);
      expect(result.overflow?.w).toBe(1200 - 1020);
      for (const id of ids.slice(0, 9)) {
        const r = result.placements.get(id)!;
        expect(r.y + r.h + 16).toBeLessThanOrEqual(wide.y);
      }
    },
  );

  it('masonry puts every pin after the full-bleed module below it, since it spans all four columns', () => {
    const { scenario, result } = run(preset('pinterest-home-feed'), 'column');
    const ids = scenario.items.map((i) => i.id);
    const wide = result.placements.get(ids[9]!)!;
    const xs = new Set(ids.map((id) => result.placements.get(id)!.x));
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 252, 504, 756]);
    for (const id of ids.slice(10))
      expect(result.placements.get(id)!.y).toBeGreaterThanOrEqual(wide.y + wide.h + 16);
  });

  it('masonry fits exactly three Unsplash columns into three columns plus two gutters', () => {
    const { result } = run(preset('unsplash-three-column'), 'column');
    const xs = new Set([...result.placements.values()].map((r) => r.x));
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 440, 880]);
  });

  it('masonry with cols: 3 widens Unsplash’s columns to the same three at any width', () => {
    const three = (w: number) => {
      const { result } = run(preset('unsplash-three-column'), 'column', (s) => ({
        ...s,
        container: { ...s.container, w },
        options: { ...s.options, cols: 3 },
      }));
      return [...new Set([...result.placements.values()].map((r) => r.x))].sort((a, b) => a - b);
    };
    expect(three(1296)).toEqual([0, 440, 880]);
    expect(three(1500)).toEqual([0, 508, 1016]);
  });

  it('masonry with justify: center centers Pinterest’s four columns in the 28px they leave', () => {
    const { result } = run(preset('pinterest-home-feed'), 'column', (s) => ({
      ...s,
      options: { ...s.options, justify: 'center' },
    }));
    const xs = new Set([...result.placements.values()].filter((r) => r.w <= 236).map((r) => r.x));
    expect([...xs].sort((a, b) => a - b)).toEqual([14, 266, 518, 770]);
  });

  it.each(PACKERS)('%s gives every too-wide newspaper module its own row at x 0', (packer) => {
    const { scenario, result } = run(preset('newspaper-front-on-phone'), packer);
    const gap = gapOf(scenario);
    for (const [id, r] of result.placements) {
      if (r.w <= scenario.container.w) continue;
      expect(r.x).toBe(0);
      for (const [other, o] of result.placements) {
        if (other === id) continue;
        const sharesBand = o.y < r.y + r.h + gap && r.y < o.y + o.h + gap;
        expect(sharesBand, `${other} beside ${id}`).toBe(false);
      }
    }
    expect(result.overflow?.w).toBe(970 - 375);
  });

  it('shelf leaves Flickr’s justified rows ragged: uniform 330px pitch, and each row too full for the next photo', () => {
    const { scenario, result } = run(preset('flickr-justified-rows'), 'shelf');
    const byRow = rows(result);
    const rect = (id: string) => result.placements.get(id)!;
    expect(byRow.map((ids) => rect(ids[0]!).y)).toEqual(byRow.map((_, r) => r * 330));
    let slack = 0;
    for (let r = 0; r + 1 < byRow.length; r++) {
      const last = rect(byRow[r]!.at(-1)!);
      const free = scenario.container.w - (last.x + last.w);
      slack += free;
      expect(free).toBeLessThan(rect(byRow[r + 1]![0]!).w + 10);
    }
    // The ragged edge a justified layout would have scaled away.
    expect(slack).toBeGreaterThan(0);
  });

  it.each(PACKERS)('%s gives the 12:1 Google Photos panorama a row of its own at x 0', (packer) => {
    const { scenario, result } = run(preset('google-photos-panoramas'), packer);
    const pano = result.placements.get(scenario.items[20]!.id)!;
    expect(pano).toMatchObject({ x: 0, w: 2160 });
    for (const [id, o] of result.placements) {
      if (id === scenario.items[20]!.id) continue;
      expect(o.y + o.h + 4 <= pano.y || pano.y + pano.h + 4 <= o.y, id).toBe(true);
    }
    expect(result.overflow?.w).toBe(2160 - 1280);
  });

  it.each(PACKERS)(
    '%s loads 8 EUR pallets into a 20ft container and 20 ISO pallets into a 40ft one',
    (packer) => {
      const inside = (id: string) => {
        const { scenario, result } = run(preset(id), packer);
        return [...result.placements.values()].filter((r) => r.y + r.h <= scenario.container.h)
          .length;
      };
      expect(inside('iso-20ft-eur-pallets')).toBe(8);
      expect(inside('iso-40ft-industrial-pallets')).toBe(20);
    },
  );

  it.each(PACKERS)(
    "%s under overflowMode 'unplaced' loads the same 8 and 20 pallets and leaves the rest on the dock",
    (packer) => {
      for (const [id, fit] of [
        ['iso-20ft-eur-pallets', 8],
        ['iso-40ft-industrial-pallets', 20],
      ] as const) {
        const { scenario, result } = run(preset(id), packer, (s) => ({
          ...s,
          options: { ...s.options, overflowMode: 'unplaced' },
        }));
        expect(result.placements.size, id).toBe(fit);
        expect(result.unplaced ?? [], id).toHaveLength(scenario.items.length - fit);
        expect(result.overflow, id).toBeUndefined();
      }
    },
  );

  it.each(PACKERS)('%s fits ten 76.8px Explorer tiles in a 768px row', (packer) => {
    const { scenario, result } = run(preset('explorer-icons-125pct'), packer);
    const first = scenario.items.slice(0, 10).map((i) => result.placements.get(i.id)!);
    expect(first.every((r) => r.y === 0)).toBe(true);
  });

  it('agrees across all three packers on a grid of identical icons', () => {
    const [shelf, skyline, column] = PACKERS.map(
      (k) => run(preset('identical-squares'), k).result.placements,
    );
    expect(skyline).toEqual(shelf);
    expect(column).toEqual(shelf);
    expect(rows({ placements: shelf!, affordances: [] })[0]).toHaveLength(14);
  });

  it.each(PACKERS)(
    '%s puts n per row when n·w + (n−1)·gap is the width, and n−1 at one pixel more',
    (packer) => {
      const perRow = (id: string) => rows(run(preset(id), packer).result).map((r) => r.length);
      expect(perRow('width-plus-gap-fits')).toEqual([4, 4, 4]);
      expect(perRow('width-plus-gap-one-over')).toEqual([3, 3, 3, 3]);
    },
  );

  it.each(PACKERS)('%s stacks full-width rows one per row with no width overflow', (packer) => {
    const { result } = run(preset('exact-container-width'), packer);
    expect(rows(result).every((r) => r.length === 1)).toBe(true);
    expect(result.overflow?.w ?? 0).toBe(0);
  });

  it.each(PACKERS)('%s sets the pitch by the gap when the gap dwarfs the items', (packer) => {
    const { result } = run(preset('gap-dominates'), packer);
    expect([...result.placements.values()].every((r) => r.x % 80 === 0 && r.y % 80 === 0)).toBe(
      true,
    );
    expect(rows(result)[0]).toHaveLength(5);
  });

  it.each(PACKERS)(
    '%s lays out the sized tiles the same with or without the not-yet-measured ones',
    (packer) => {
      const withPending = run(preset('masonry-images-loading'), packer).result;
      const settled = run(preset('masonry-images-loading'), packer, (s) => ({
        ...s,
        items: s.items.filter((i) => sizeOf(i)),
      })).result;
      expect(withPending.placements).toEqual(settled.placements);
      expect(withPending.unplaced).toHaveLength(10);
    },
  );

  it.each(PACKERS)('%s stands 300 one-pixel needles side by side', (packer) => {
    const { result } = run(preset('vertical-needles'), packer);
    expect(rows(result).map((r) => r.length)).toEqual([300, 100]);
  });

  it.each(PACKERS)(
    '%s gives every 10000px needle the left edge and never tucks a dot under one',
    (packer) => {
      const { scenario, result } = run(preset('horizontal-needles'), packer);
      const needles = scenario.items
        .filter((_, i) => i % 2 === 0)
        .map((i) => result.placements.get(i.id)!);
      expect(needles.every((r) => r.x === 0)).toBe(true);
      expect(result.overflow?.w).toBe(10000 - 800);
    },
  );

  it('masonry runs one column when the pane is narrower than a pin', () => {
    const { result } = run(preset('narrower-than-a-pin'), 'column');
    expect([...result.placements.values()].every((r) => r.x === 0)).toBe(true);
    expect(result.overflow?.w).toBe(36);
  });

  it.each(PACKERS)('%s packs 10,000 thumbnails inside a generous 2s budget', (packer) => {
    const scenario = packScenario(preset('ten-thousand-thumbnails'), packer);
    const start = performance.now();
    runScenario(STRATEGIES[packer], scenario);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('skyline walks the staircase outline inside a 250ms budget', () => {
    const scenario = packScenario(preset('staircase-widths'), 'skyline');
    const start = performance.now();
    runScenario(skylineStrategy, scenario);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('glyph atlas order stability', () => {
  const atlas = preset('msdf-ascii-glyph-atlas');
  const k = 40;
  const bump =
    (dw: number, dh: number, index = k) =>
    (s: Scenario): Scenario => ({
      ...s,
      items: s.items.map((item, i) => {
        const size = sizeOf(item);
        return i === index && size
          ? { ...item, hints: { preferredSize: { w: size.w + dw, h: size.h + dh } } }
          : item;
      }),
    });
  const moved = (a: LayoutResult<string>, b: LayoutResult<string>, ids: string[]) =>
    ids.filter((id) => {
      const p = a.placements.get(id)!;
      const q = b.placements.get(id)!;
      return p.x !== q.x || p.y !== q.y;
    });

  it.each(PACKERS)('%s leaves every glyph before a 1px-taller one where it was', (packer) => {
    const before = run(atlas, packer);
    const after = run(atlas, packer, bump(0, 1));
    const ids = before.scenario.items.map((i) => i.id);
    expect(moved(before.result, after.result, ids.slice(0, k))).toEqual([]);
  });

  it('shelf moves no glyph sideways, and no row down more than 1px, when one glyph grows 1px taller', () => {
    const before = run(atlas, 'shelf').result;
    const after = run(atlas, 'shelf', bump(0, 1)).result;
    for (const [id, p] of before.placements) {
      const q = after.placements.get(id)!;
      expect(q.x).toBe(p.x);
      expect(q.y - p.y).toBeGreaterThanOrEqual(0);
      expect(q.y - p.y).toBeLessThanOrEqual(1);
    }
  });

  it('masonry re-columns the whole atlas, earlier glyphs included, when the narrowest glyph narrows 1px', () => {
    const before = run(atlas, 'column');
    const widths = before.scenario.items.map((i) => sizeOf(i)!.w);
    const narrowest = widths.lastIndexOf(Math.min(...widths));
    const after = run(atlas, 'column', bump(-1, 0, narrowest));
    const ids = before.scenario.items.map((i) => i.id);
    // The default column width is the narrowest item's, so this is by design — not a bug.
    expect(moved(before.result, after.result, ids.slice(0, narrowest)).length).toBeGreaterThan(0);
  });

  it('masonry spends half the CJK atlas on 1px overhangs until the column width is set to the widest glyph', () => {
    const p = preset('troika-cjk-glyph-atlas');
    expect(density(run(p, 'column').result)).toBeLessThan(0.6);
    const fixed = run(p, 'column', (s) => ({ ...s, options: { ...s.options, columnWidth: 35 } }));
    expect(density(fixed.result)).toBeGreaterThan(0.85);
  });
});

describe('float drift at the width boundary', () => {
  /** Widths/gaps where n equal items fill the width exactly, and the packer wrapped the last one. */
  function wrapsAnExactRow(packer: PackerId): string[] {
    const bad: string[] = [];
    for (const W of [100, 375, 1000, 1366]) {
      for (const gap of [0, 3, 10]) {
        for (let n = 2; n <= 24; n++) {
          const w = (W - (n - 1) * gap) / n;
          if (w <= 0) continue;
          const items = Array.from({ length: n }, (_, i) => ({
            id: `t${i}`,
            hints: { preferredSize: { w, h: 10 } },
          }));
          const result = runScenario(STRATEGIES[packer], {
            items,
            container: { w: W, h: 100 },
            options: { gap },
          });
          if (rows(result).length !== 1) bad.push(`W${W} gap${gap} n${n}`);
        }
      }
    }
    return bad;
  }

  it('shelf keeps six tiles of width 100/6 on one row', () => {
    expect(rows(run(preset('equal-sixths'), 'shelf').result)).toHaveLength(1);
  });

  it('skyline keeps six tiles of width 100/6 on one row', () => {
    expect(rows(run(preset('equal-sixths'), 'skyline').result)).toHaveLength(1);
  });

  it('masonry keeps six tiles of width 100/6 on one row', () => {
    expect(rows(run(preset('equal-sixths'), 'column').result)).toHaveLength(1);
  });

  it.each(PACKERS)(
    '%s keeps n tiles of (W − (n−1)·gap)/n on one row for every W, gap and n',
    (packer) => {
      expect(wrapsAnExactRow(packer)).toEqual([]);
    },
  );
});

describe.runIf(process.env.EXOTIC_DENSITY)('density table', () => {
  const variants: [string, Record<string, unknown>][] = [
    ['as given', {}],
    ['sort: height', { sort: 'height' }],
    ['sort: area', { sort: 'area' }],
    ['rotate', { rotate: true }],
    ['sort: height, rotate', { sort: 'height', rotate: true }],
    ['sort: max-side, rotate', { sort: 'max-side', rotate: true }],
  ];

  it.each(variants)('prints fill %% per preset and packer, %s', (label, extra) => {
    const lines = [`${label.padEnd(30)}${PACKERS.map((k) => k.padStart(9)).join('')}`];
    for (const p of ALL_PRESETS) {
      const cells = PACKERS.map((k) => {
        const { result } = run(p, k, (s) => ({ ...s, options: { ...s.options, ...extra } }));
        return (density(result) * 100).toFixed(1).padStart(9);
      });
      lines.push(`${p.id.padEnd(30)}${cells.join('')}`);
    }
    process.stderr.write(`\n${lines.join('\n')}\n`);
  });
});
