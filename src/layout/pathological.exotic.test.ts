import { describe, expect, it } from 'vitest';
import { WindeaseError } from '../errors.js';
import type { LayoutItem, LayoutResult, LayoutStrategy, Size } from '../layout-types.js';
import { dropped, malformedRects } from '../test-utils/exotic/invariants.js';
import { columnStrategy } from './column.js';
import { desktopStrategy } from './desktop.js';
import { floatingStrategy } from './floating.js';
import { gridStrategy } from './grid.js';
import { shelfStrategy } from './shelf.js';
import { skylineStrategy } from './skyline.js';
import { stackStrategy } from './stack.js';
import { stripStrategy } from './strip.js';

type AnyStrategy = LayoutStrategy<unknown, string, unknown>;

interface Entry {
  name: string;
  strategy: AnyStrategy;
  options: Record<string, unknown>;
  /** Which of the three items the value sweep poisons. */
  poisonAt?: number;
  /** Marks every item floating, for a floating strategy with no inner layer. */
  allFloat?: boolean;
}

const as = (s: unknown) => s as AnyStrategy;

/** Every strategy `src/index.ts` exports, in the configs that reach its distinct code paths. */
const ENTRIES: Entry[] = [
  { name: 'strip', strategy: as(stripStrategy), options: {} },
  { name: 'strip fill', strategy: as(stripStrategy), options: { fill: true } },
  {
    name: 'strip y padded',
    strategy: as(stripStrategy),
    options: { axis: 'y', fill: true, gap: 4, padding: 8 },
  },
  {
    name: 'strip unplaced',
    strategy: as(stripStrategy),
    options: { maxItems: 3, overflowMode: 'unplaced' },
  },
  { name: 'grid', strategy: as(gridStrategy), options: {} },
  {
    name: 'grid padded',
    strategy: as(gridStrategy),
    options: { cols: 3, gap: 4, padding: 8 },
  },
  {
    name: 'grid capped',
    strategy: as(gridStrategy),
    options: { maxCols: 3, maxRows: 3 },
  },
  {
    name: 'grid resizable',
    strategy: as(gridStrategy),
    options: { cols: 3, maxRows: 4, resizable: true },
  },
  { name: 'stack', strategy: as(stackStrategy), options: { headerSize: 24, padding: 4 } },
  { name: 'floating', strategy: as(floatingStrategy()), options: {}, allFloat: true },
  {
    name: 'floating(grid)',
    strategy: as(floatingStrategy(gridStrategy)),
    options: {},
    poisonAt: 0,
  },
  { name: 'desktop', strategy: as(desktopStrategy()), options: {} },
  {
    name: 'desktop(shelf)',
    strategy: as(desktopStrategy(shelfStrategy)),
    options: { minimize: 'icon' },
  },
  { name: 'shelf', strategy: as(shelfStrategy), options: { gap: 4 } },
  { name: 'skyline', strategy: as(skylineStrategy), options: { gap: 4 } },
  { name: 'column', strategy: as(columnStrategy), options: { gap: 4 } },
];

/**
 * An ordinary item that every strategy can place: a size by every route a
 * strategy reads one, a desktop position, and — on even indices — the
 * floating flag, so floating(inner) has both layers populated.
 */
function item(i: number, allFloat = false): LayoutItem {
  return {
    id: `i${i}`,
    hints: { preferredSize: { w: 120, h: 90 } },
    placement: { size: { w: 120, h: 90 } },
    meta: { x: 16 * i, y: 12 * i, floating: allFloat || i % 2 === 0, size: { w: 120, h: 90 } },
  };
}

function items(n: number, allFloat = false): LayoutItem[] {
  return Array.from({ length: n }, (_, i) => item(i, allFloat));
}

const POISONS: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  '-Infinity': Number.NEGATIVE_INFINITY,
  negative: -50,
  zero: 0,
};

/** One way to poison an item with `v`. Each reaches a different read in some strategy. */
const FIELDS: Record<string, (it: LayoutItem, v: number) => LayoutItem> = {
  preferredSize: (it, v) => ({ ...it, hints: { ...it.hints, preferredSize: { w: v, h: v } } }),
  minSize: (it, v) => ({ ...it, hints: { ...it.hints, minSize: { w: v, h: v } } }),
  maxSize: (it, v) => ({ ...it, hints: { ...it.hints, maxSize: { w: v, h: v } } }),
  natural: (it, v) => ({
    ...it,
    hints: { ...it.hints, sizing: { w: 'content', h: 'content' } },
    natural: { w: v, h: v },
  }),
  'placement.size': (it, v) => {
    const size = { w: v, h: v };
    return { ...it, placement: { ...it.placement, size }, meta: { ...it.meta, size } };
  },
  'placement.span': (it, v) => {
    const span = { cols: v, rows: v };
    return { ...it, placement: { ...it.placement, span }, meta: { ...it.meta, span } };
  },
  'meta x/y': (it, v) => ({ ...it, meta: { ...it.meta, x: v, y: v } }),
  'meta.pinned': (it, v) => ({ ...it, meta: { ...it.meta, pinned: v } }),
};

function run(entry: Entry, list: LayoutItem[], container: Size): LayoutResult<string> {
  const state = entry.strategy.initialState?.(list, entry.options);
  return entry.strategy.layout({ items: list, container, state, options: entry.options });
}

/** Runs the layout and returns what broke; a documented `WindeaseError` is not breakage. */
function breakage(entry: Entry, list: LayoutItem[], container: Size) {
  let result: LayoutResult<string>;
  try {
    result = run(entry, list, container);
  } catch (e) {
    if (e instanceof WindeaseError) return { threw: null, malformed: [], dropped: [] };
    return { threw: String(e), malformed: [], dropped: [] };
  }
  const unique = [...new Map(list.map((it) => [it.id, it])).values()];
  return {
    threw: null,
    malformed: malformedRects(result.placements),
    dropped: dropped(unique, result),
  };
}

const CLEAN = { threw: null, malformed: [], dropped: [] };

/**
 * Cases that fail today, each a defect in library source. `it.fails` keeps
 * them visible: when one is fixed its case starts passing and the test flips.
 */
const KNOWN: { match: RegExp; defect: string }[] = [
  {
    match: /^floating[^/]*\/(preferredSize|natural)\/(NaN|Infinity)$/,
    defect: 'floating withholds a 0-size item but places a NaN or infinite one',
  },
  {
    match: /^desktop[^/]*\/meta x\/y\/(NaN|Infinity|-Infinity)$/,
    defect: 'desktop checks that a window size is finite but not its x/y',
  },
];

function knownDefect(key: string): string | undefined {
  return KNOWN.find((k) => k.match.test(key))?.defect;
}

function sweep(key: string, name: string, fn: () => void) {
  const defect = knownDefect(key);
  if (defect) it.fails(`${name} — known: ${defect}`, fn);
  else it(name, fn);
}

describe('pathological item values', () => {
  const container = { w: 800, h: 600 };
  for (const entry of ENTRIES) {
    describe(entry.name, () => {
      for (const [field, poison] of Object.entries(FIELDS)) {
        for (const [label, v] of Object.entries(POISONS)) {
          const key = `${entry.name}/${field}/${label}`;
          sweep(key, `${field} = ${label}`, () => {
            const list = items(3, entry.allFloat);
            const at = entry.poisonAt ?? 1;
            list[at] = poison(list[at]!, v);
            expect(breakage(entry, list, container)).toEqual(CLEAN);
          });
        }
      }
    });
  }
});

describe('pathological containers and counts', () => {
  const containers: Record<string, Size> = {
    '0x0': { w: 0, h: 0 },
    '1x1': { w: 1, h: 1 },
    '100000x100000': { w: 100_000, h: 100_000 },
  };
  for (const entry of ENTRIES) {
    describe(entry.name, () => {
      for (const [cname, c] of Object.entries(containers)) {
        for (const n of [0, 1, 10_000]) {
          it(`${n} items in ${cname}`, () =>
            expect(breakage(entry, items(n, entry.allFloat), c)).toEqual(CLEAN));
        }
      }
      it('duplicate ids never throw, and each id is placed or unplaced', () => {
        const list = [item(0, entry.allFloat), item(1, entry.allFloat), { ...item(2), id: 'i0' }];
        expect(breakage(entry, list, { w: 800, h: 600 })).toEqual(CLEAN);
      });
    });
  }
});

describe('defects the sweep cannot phrase', () => {
  // Defect: floatingStrategy() with no inner neither places nor reports an item lacking meta.floating.
  it.fails('floatingStrategy() accounts for an item that is not marked floating', () => {
    const entry = ENTRIES.find((e) => e.name === 'floating')!;
    expect(breakage(entry, [item(0), item(1)], { w: 800, h: 600 })).toEqual(CLEAN);
  });

  it('grid keeps finite rects when one span.rows is NaN', () => {
    const entry = ENTRIES.find((e) => e.name === 'grid')!;
    const list = items(3);
    list[1] = { ...list[1]!, placement: { span: { cols: 1, rows: Number.NaN } } };
    expect(breakage(entry, list, { w: 800, h: 600 })).toEqual(CLEAN);
  });
});

describe('canAccept on 10k items', () => {
  // Pointermove hot path: one call per frame. A frame is 16ms; this allows the
  // whole frame to one call, far above the sub-millisecond it measures.
  const BUDGET_MS = 16;
  const many = Array.from({ length: 10_000 }, (_, i) => ({
    id: `i${i}`,
    placement: { span: { cols: 1 + (i % 3), rows: 1 } },
    meta: { floating: i % 5 === 0 },
  }));
  const cases: [string, AnyStrategy, Record<string, unknown>][] = [
    ['grid maxCols/maxRows', as(gridStrategy), { maxCols: 120, maxRows: 120 }],
    ['grid maxItems', as(gridStrategy), { maxItems: 20_000 }],
    ['grid rows', as(gridStrategy), { rows: 40, maxCols: 400 }],
    ['strip maxItems', as(stripStrategy), { maxItems: 20_000 }],
    ['floating(grid)', as(floatingStrategy(gridStrategy)), { maxCols: 120, maxRows: 120 }],
    ['desktop(shelf)', as(desktopStrategy(shelfStrategy)), {}],
  ];
  for (const [name, strategy, options] of cases) {
    it(`${name} answers within ${BUDGET_MS}ms`, () => {
      expect(strategy.canAccept).toBeTypeOf('function');
      strategy.canAccept?.(many, options);
      const rounds = 20;
      const t0 = performance.now();
      for (let i = 0; i < rounds; i++) strategy.canAccept?.(many, options);
      const perCall = (performance.now() - t0) / rounds;
      expect(perCall).toBeLessThan(BUDGET_MS);
    });
  }
});

describe('layout cost at scale', () => {
  const timed = (entry: Entry, n: number) => {
    const list = items(n);
    const t0 = performance.now();
    run(entry, list, { w: 800, h: 600 });
    return performance.now() - t0;
  };
  const grid = ENTRIES.find((e) => e.name === 'grid')!;
  const resizable: Entry = {
    name: 'grid resizable unbounded',
    strategy: as(gridStrategy),
    options: { cols: 3, resizable: true },
  };

  it('the packing strategies lay out 10k items within 250ms', () => {
    for (const name of ['shelf', 'skyline', 'column', 'desktop']) {
      const entry = ENTRIES.find((e) => e.name === name)!;
      expect(timed(entry, 10_000), name).toBeLessThan(250);
    }
  });

  it('grid lays out 4000 items within 250ms', () => {
    expect(timed(grid, 4000)).toBeLessThan(250);
  });

  it('a resizable grid with no row cap lays out 60 items within 250ms', () => {
    expect(timed(resizable, 60)).toBeLessThan(250);
  });
});
