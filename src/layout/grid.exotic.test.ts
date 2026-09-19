import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DragEngine } from '../dnd/DragEngine.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { LayoutItem, LayoutResult, Rect } from '../layout-types.js';
import { asNodeId } from '../node.js';
import type { Store } from '../store.js';
import {
  PATHOLOGICAL,
  PRESETS,
  presetGridScenarios,
  TEN_THOUSAND,
} from '../test-utils/exotic/grid-scenarios.js';
import {
  dropped,
  malformedRects,
  outOfBounds,
  overlaps,
  runScenario,
  type Scenario,
} from '../test-utils/exotic/invariants.js';
import { type Preset, presetScenario, presetToStore } from '../test-utils/exotic/preset.js';
import { gridStrategy, gridTiling } from './grid.js';
import { stripStrategy } from './strip.js';

type Check =
  | 'wellFormed'
  | 'noDrops'
  | 'noOverlap'
  | 'deterministic'
  | 'inBounds'
  | 'aligned'
  | 'spans'
  | 'accept'
  | 'acceptOneMore';

/** Checks a scenario is known to fail, each with the defect it exposes. */
const KNOWN: Record<string, Partial<Record<Check, string>>> = {};

const SCENARIOS: Scenario[] = [...presetGridScenarios(), ...PATHOLOGICAL];
const run = (s: Pick<Scenario, 'items' | 'container' | 'options'>) => runScenario(gridStrategy, s);
const scenario = (presetId: string, containerId: string): Scenario => {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`no preset ${presetId}`);
  return presetScenario(preset, containerId);
};

interface Cfg {
  cols?: number;
  rows?: number;
  maxRows?: number;
  gap?: number;
  padding?: number;
  cell?: { w?: number; h?: number };
  justify?: 'start' | 'center' | 'end' | 'between' | 'evenly';
  tracks?: { cols?: Track[]; rows?: Track[] };
}

type Track = number | { share: number };

/**
 * Where each of `count` tracks starts along an axis `usable` long, as the
 * README states it: `list` by index, a pixel number as is, `{ share }` a share
 * of what pixels and gaps leave; past the list, `cell` pixels or one share.
 */
function trackStarts(list: Track[], count: number, usable: number, gap: number, cell?: number) {
  const all = Array.from({ length: count }, (_, i) => list[i] ?? cell ?? { share: 1 });
  const px = all.reduce<number>((a, t) => a + (typeof t === 'number' ? t : 0), 0);
  const shares = all.reduce<number>((a, t) => a + (typeof t === 'number' ? 0 : t.share), 0);
  const rest = Math.max(0, usable - px - gap * (count - 1));
  const sizes = all.map((t) => (typeof t === 'number' ? t : (rest * t.share) / shares));
  const starts: number[] = [];
  let at = 0;
  for (const size of sizes) {
    starts.push(at);
    at += size + gap;
  }
  return { starts, ends: sizes.map((size, i) => starts[i]! + size) };
}

/** {@link cellsOf} for a grid whose `tracks` size its columns and rows unevenly. */
function trackedCellsOf(s: Scenario, result: LayoutResult<string>) {
  const cfg = s.options as Cfg;
  const { cols, rows } = gridTiling(s.items, s.options, s.container);
  const gap = cfg.gap ?? 0;
  const pad = cfg.padding ?? 0;
  const x = trackStarts(cfg.tracks?.cols ?? [], cols, s.container.w - 2 * pad, gap, cfg.cell?.w);
  const y = trackStarts(cfg.tracks?.rows ?? [], rows, s.container.h - 2 * pad, gap, cfg.cell?.h);
  const near = (list: number[], v: number) => list.findIndex((a) => Math.abs(a - v) < 1e-6);
  const out = new Map<string, { col: number; row: number; cols: number; rows: number }>();
  const off: string[] = [];
  for (const [id, r] of result.placements) {
    const col = near(x.starts, r.x - pad);
    const row = near(y.starts, r.y - pad);
    const lastCol = near(x.ends, r.x + r.w - pad);
    const lastRow = near(y.ends, r.y + r.h - pad);
    if ([col, row, lastCol, lastRow].includes(-1)) {
      off.push(`${id} at ${r.x},${r.y} ${r.w}x${r.h}`);
      continue;
    }
    out.set(id, { col, row, cols: lastCol - col + 1, rows: lastRow - row + 1 });
  }
  return { cells: out, off, cols, reach: cols };
}

/** Where column 0 starts and the extra space between columns, when `used`
 *  columns of `cellW` leave `leftover` of the width for `justify` to hand out. */
function spread(justify: Cfg['justify'], leftover: number, used: number) {
  if (leftover <= 0) return { offset: 0, extra: 0 };
  if (justify === 'center') return { offset: leftover / 2, extra: 0 };
  if (justify === 'end') return { offset: leftover, extra: 0 };
  if (justify === 'between') return { offset: 0, extra: used > 1 ? leftover / (used - 1) : 0 };
  if (justify === 'evenly') return { offset: leftover / (used + 1), extra: leftover / (used + 1) };
  return { offset: 0, extra: 0 };
}

/** The span grid *should* give `item`: floor, at least 1 (NaN included), at most the grid. */
function expectedSpan(item: LayoutItem, cols: number, rowCap: number | undefined) {
  const whole = (v: number | undefined) =>
    v !== undefined && Number.isFinite(v)
      ? Math.max(1, Math.floor(v))
      : v === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : 1;
  const c = Math.min(whole(item.placement?.span?.cols), cols);
  const r = whole(item.placement?.span?.rows);
  return { cols: c, rows: rowCap === undefined ? r : Math.min(r, rowCap) };
}

function rowCapOf(cfg: Cfg): number | undefined {
  if (cfg.cols !== undefined) return cfg.maxRows;
  if (cfg.rows !== undefined) return Math.max(1, cfg.rows);
  return cfg.maxRows;
}

/** Each placed rect as whole cells, or the reason it is not on the lattice. */
function cellsOf(s: Scenario, result: LayoutResult<string>) {
  const cfg = s.options as Cfg;
  if (cfg.tracks) return trackedCellsOf(s, result);
  const { cols, rows } = gridTiling(s.items, s.options, s.container);
  const gap = cfg.gap ?? 0;
  const pad = cfg.padding ?? 0;
  const usableW = s.container.w - 2 * pad;
  const cellW = cfg.cell?.w ?? Math.max((usableW - gap * (cols - 1)) / cols, 0);
  const cellH = cfg.cell?.h ?? Math.max((s.container.h - 2 * pad - gap * (rows - 1)) / rows, 0);
  const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
  // The occupied column count `justify` spread over is not in the result, so
  // try each and keep the one the rects agree with.
  const read = (used: number) => {
    const { offset, extra } = spread(
      cfg.justify,
      usableW - (used * cellW + (used - 1) * gap),
      used,
    );
    const colStride = cellW + gap + extra;
    const out = new Map<string, { col: number; row: number; cols: number; rows: number }>();
    const off: string[] = [];
    let reach = 0;
    for (const [id, r] of result.placements) {
      const col = (r.x - pad - offset) / colStride;
      const row = (r.y - pad) / (cellH + gap);
      const cs = (r.w + gap + extra) / colStride;
      const rs = (r.h + gap) / (cellH + gap);
      if (colStride <= 0 || cellH + gap <= 0) continue;
      if (![col, row, cs, rs].every(whole)) off.push(`${id} at ${col},${row} ${cs}x${rs}`);
      reach = Math.max(reach, Math.round(col) + Math.round(cs));
      out.set(id, {
        col: Math.round(col),
        row: Math.round(row),
        cols: Math.round(cs),
        rows: Math.round(rs),
      });
    }
    return { cells: out, off, cols, reach };
  };
  if (cfg.justify === undefined || cfg.justify === 'start') return read(cols);
  for (let used = 1; used <= cols; used++) {
    const attempt = read(used);
    if (attempt.off.length === 0 && attempt.reach === used) return attempt;
  }
  return read(cols);
}

/** `base` re-read from `store` after a gesture wrote to it. */
function fromStore(store: Store, containerId: string, base: Scenario): Scenario {
  const parent = store.getNode(asNodeId(containerId))!;
  const items = parent.container!.childOrder.map((id) => nodeToLayoutItem(store.getNode(id)!));
  return { ...base, items, options: parent.container!.config as Record<string, unknown> };
}

function check(name: Check, s: Scenario, title: string, fn: () => void) {
  const known = KNOWN[s.id]?.[name];
  if (known) it.fails(`${title} — ${known}`, fn);
  else it(title, fn);
}

describe.each(SCENARIOS)('$id', (s) => {
  const result = run(s);

  check('wellFormed', s, 'emits no NaN, infinite or negative rects', () => {
    expect(malformedRects(result.placements)).toEqual([]);
  });

  check('noDrops', s, 'places or reports every item', () => {
    expect(dropped(s.items, result)).toEqual([]);
  });

  check('noOverlap', s, 'places no two items over each other', () => {
    expect(overlaps(result.placements, (s.options as Cfg).gap ?? 0)).toEqual([]);
  });

  check('deterministic', s, 'lays out identically twice', () => {
    const again = run(s);
    expect([...again.placements]).toEqual([...result.placements]);
    expect(again.unplaced).toEqual(result.unplaced);
  });

  check('inBounds', s, 'stays inside the container unless it reports overflow', () => {
    if (result.overflow) return;
    expect(outOfBounds(result.placements, s.container)).toEqual([]);
  });

  check('aligned', s, 'puts every rect on the cell lattice gridTiling reports', () => {
    expect(cellsOf(s, result).off).toEqual([]);
  });

  check('spans', s, 'honors every span, clamped to the grid, or reports the item', () => {
    const { cells, cols } = cellsOf(s, result);
    const rowCap = rowCapOf(s.options as Cfg);
    const unplaced = new Set(result.unplaced ?? []);
    for (const item of s.items) {
      if (unplaced.has(item.id)) continue;
      const cell = cells.get(item.id);
      if (!cell) continue;
      const want = expectedSpan(item, cols, rowCap);
      expect({ id: item.id, cols: cell.cols, rows: cell.rows }).toEqual({ id: item.id, ...want });
    }
  });

  check('accept', s, 'canAccept agrees with whether layout places everything', () => {
    const everyonePlaced = (result.unplaced ?? []).length === 0;
    expect(gridStrategy.canAccept?.(s.items, s.options)).toBe(everyonePlaced);
  });
});

describe.each(SCENARIOS)('$id + one more 1×1', (s) => {
  check('acceptOneMore', s, 'canAccept a newcomer exactly when layout then places everyone', () => {
    const grown = [...s.items, { id: '__newcomer' }];
    const placesAll = (run({ ...s, items: grown }).unplaced ?? []).length === 0;
    expect(gridStrategy.canAccept?.(grown, s.options)).toBe(placesAll);
  });
});

describe('iPhone dock: fixed icon cells spaced evenly', () => {
  const s = scenario('ios-dock', 'ios-dock');
  const rects = (sc: Scenario) => [...run(sc).placements.values()].sort((a, b) => a.x - b.x);
  /** The space before, between and after the icons along the dock. */
  const spaces = (rs: Rect[], w: number, pad: number) => [
    rs[0]!.x - pad,
    ...rs.slice(1).map((r, i) => r.x - (rs[i]!.x + rs[i]!.w)),
    w - pad - (rs.at(-1)!.x + rs.at(-1)!.w),
  ];

  it('holds three apps in one row at 60pt each, with equal space around them', () => {
    const rs = rects(s);
    expect(rs).toHaveLength(3);
    for (const r of rs) expect({ w: r.w, h: r.h }).toEqual({ w: 60, h: 60 });
    const gaps = spaces(rs, s.container.w, 8);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
    expect(gaps[0]).toBeGreaterThan(0);
  });

  it('takes a fourth app at the same size, still evenly spaced', () => {
    const rs = rects({ ...s, items: [...s.items, { id: 'ios-app-1' }] });
    expect(rs).toHaveLength(4);
    for (const r of rs) expect(r.w).toBe(60);
    const gaps = spaces(rs, s.container.w, 8);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
  });

  it('refuses a fifth by accepts.max, and accepts a fourth, through the drag engine', () => {
    const preset = PRESETS.find((p) => p.id === 'ios-dock') as Preset;
    const store = presetToStore(preset);
    const strategies: Record<string, unknown> = { grid: gridStrategy, strip: stripStrategy };
    const hover = (sourceId: string) => {
      const engine = new DragEngine(store, { getStrategy: (id) => strategies[id] as never });
      engine.addDropTarget(asNodeId('ios-dock'), {
        bounds: (): Rect => ({ x: 0, y: 0, z: 0, w: 390, h: 100 }),
      });
      engine.tryBegin(asNodeId(sourceId));
      engine.updateHoverByPoint(100, 50);
      const accepted = engine.state()?.hover?.accepted;
      engine.cancel();
      return accepted;
    };
    expect(hover('ios-app-1')).toBe(true);
    store.moveNode(asNodeId('ios-app-1'), asNodeId('ios-dock'));
    expect(hover('ios-app-2')).toBe(false);
  });
});

describe('capacity under maxCols × maxRows', () => {
  it('a full 7×5 Launchpad page places all 35 at one fixed size', () => {
    const r = run(scenario('launchpad-full', 'lp-page'));
    expect(r.placements.size).toBe(35);
    for (const rect of r.placements.values())
      expect({ w: rect.w, h: rect.h }).toEqual({ w: 112, h: 124 });
  });

  it('a fixed 7×5 Launchpad page places 35 of 40 and reports the last 5 as the next page', () => {
    const r = run(scenario('launchpad-overflow', 'lp-page'));
    expect(r.placements.size).toBe(35);
    expect(r.unplaced).toEqual(['lp-app-36', 'lp-app-37', 'lp-app-38', 'lp-app-39', 'lp-app-40']);
  });

  it('a fixed 7×5 page holding 30 accepts a 31st', () => {
    const s = scenario('launchpad-thirty', 'lp-page');
    const grown = [...s.items, { id: 'dock-app-1' }];
    expect(run({ ...s, items: grown }).placements.size).toBe(31);
    expect(gridStrategy.canAccept?.(grown, s.options)).toBe(true);
  });

  it('a Windows 11 snap layout refuses a fourth window into its 2×2', () => {
    const s = scenario('win11-snap-left-tall', 'snap');
    expect(run(s).placements.get('snap-left')?.h).toBe(720);
    expect(gridStrategy.canAccept?.([...s.items, { id: 'fourth' }], s.options)).toBe(false);
  });

  it('a 1×1 Smart Stack shows one child, clamps its 2×2 span, and reports the rest', () => {
    const s = PATHOLOGICAL.find((p) => p.id === 'one-cell') as Scenario;
    const r = run(s);
    expect(r.placements.get('big')).toEqual({ x: 0, y: 0, z: 0, w: 184, h: 224 });
    expect(r.unplaced).toEqual(['i0', 'i1']);
  });
});

describe('fixed rows (Windows 8 Start screen)', () => {
  it('grows columns for wide and large tiles instead of unplacing them', () => {
    const s = scenario('win8-start-screen', 'start8');
    const r = run(s);
    expect(r.unplaced).toBeUndefined();
    expect(gridStrategy.canAccept?.(s.items, s.options)).toBe(true);
  });
});

describe('Android home screen: cells, not items', () => {
  const full = scenario('android-full-by-cells', 'page');
  const widget: LayoutItem = { id: 'widget-weather', placement: { span: { cols: 4, rows: 2 } } };

  it('the page is full by cells with 14 children, each at the cell it was left in', () => {
    expect(full.items).toHaveLength(14);
    const r = run(full);
    expect(r.unplaced).toBeUndefined();
    const { cells } = cellsOf(full, r);
    expect(cells.get('weather-2x2')).toEqual({ col: 0, row: 1, cols: 2, rows: 2 });
    expect(cells.get('app-1')).toMatchObject({ col: 2, row: 1 });
    expect(cells.get('app-12')).toMatchObject({ col: 3, row: 4 });
  });

  it('canAccept counts the 4×2 widget as eight cells and refuses it', () => {
    expect(gridStrategy.canAccept?.([...full.items, widget], full.options)).toBe(false);
  });

  it('canAccept refuses even a 1×1 icon on a page full by cells', () => {
    expect(gridStrategy.canAccept?.([...full.items, { id: 'new-app' }], full.options)).toBe(false);
  });

  it('a page full by count refuses an icon', () => {
    const byCount = scenario('android-full-by-count', 'page');
    expect(gridStrategy.canAccept?.([...byCount.items, { id: 'new-app' }], byCount.options)).toBe(
      false,
    );
  });

  it('a fragmented page accepts a 3×3 widget by count that layout cannot place (documented O(n) approximation)', () => {
    const s = scenario('android-fragmented', 'page');
    const grown = [...s.items, { id: 'big', placement: { span: { cols: 3, rows: 3 } } }];
    expect(gridStrategy.canAccept?.(grown, s.options)).toBe(true);
    expect(run({ ...s, items: grown }).unplaced).toEqual(['big']);
  });

  it('maxItems counts children, not cells: 19 icons and a 4×2 widget fit a 20-item page by growing rows', () => {
    const items = [...Array.from({ length: 19 }, (_, i) => ({ id: `a${i}` })), widget];
    const options = { cols: 4, maxItems: 20 };
    expect(gridStrategy.canAccept?.(items, options)).toBe(true);
    expect(run({ items, container: { w: 400, h: 500 }, options }).unplaced).toBeUndefined();
    expect(gridTiling(items, options).rows).toBe(7);
  });

  /** Drives the real drag engine: the verdict a user sees mid-gesture. */
  function hoverVerdict(sourceId: string): boolean | undefined {
    const preset = PRESETS.find((p) => p.id === 'android-full-by-cells');
    if (!preset) throw new Error('missing preset');
    const store = presetToStore(preset);
    const strategies: Record<string, unknown> = { grid: gridStrategy, strip: stripStrategy };
    const engine = new DragEngine(store, { getStrategy: (id) => strategies[id] as never });
    engine.addDropTarget(asNodeId('page'), {
      bounds: (): Rect => ({ x: 0, y: 0, z: 0, w: 400, h: 600 }),
    });
    engine.tryBegin(asNodeId(sourceId));
    engine.updateHoverByPoint(200, 300);
    return engine.state()?.hover?.accepted;
  }

  it('dragging the 4×2 widget onto the full page is refused', () => {
    expect(hoverVerdict('widget-weather')).toBe(false);
  });

  it('dragging a 1×1 app onto a page full by cells is refused', () => {
    expect(hoverVerdict('new-app')).toBe(false);
  });
});

describe('Windows 10 Start tiles', () => {
  const holes = (s: Scenario) => {
    const r = run(s);
    const { cols, rows } = gridTiling(s.items, s.options);
    let used = 0;
    for (const item of s.items) {
      if (!r.placements.has(item.id)) continue;
      const span = item.placement?.span;
      used += Math.min(span?.cols ?? 1, cols) * (span?.rows ?? 1);
    }
    return cols * rows - used;
  };

  it('packs the productivity group densely: small tiles backfill beside the large one', () => {
    expect(holes(scenario('win10-start-6', 'productivity'))).toBe(0);
  });

  it('three wide tiles in a 6-wide group leave holes nothing can fill; 8 columns closes most', () => {
    const six = holes(scenario('win10-start-6', 'explore'));
    const eight = holes(scenario('win10-start-8', 'explore'));
    expect(six).toBe(11);
    expect(eight).toBeLessThan(six);
  });

  it('a seam drag widens a small tile by one cell through dispatchAffordance', () => {
    const preset = PRESETS.find((p) => p.id === 'win10-start-6');
    if (!preset) throw new Error('missing preset');
    const store = presetToStore(preset);
    const s = presetScenario(preset, 'productivity', { w: 320, h: 400 });
    const r = run(s);
    const seam = r.affordances.find((a) => a.id === 'resize-x-calc');
    if (!seam) throw new Error('no seam on calc');
    const rect = r.placements.get('calc') as Rect;
    const cellW = rect.w;
    gridStrategy.dispatchAffordance?.({
      event: {
        affordanceId: seam.id,
        kind: 'drag',
        payload: { point: { x: rect.x + rect.w + cellW, y: rect.y } },
      },
      affordance: seam,
      store,
      parentId: asNodeId('productivity'),
      container: s.container,
      options: s.options,
      items: s.items,
    });
    expect(store.getNode(asNodeId('calc'))?.membership?.placement?.span).toEqual({ cols: 2 });
  });

  it('a 64-tile resizable Start menu lays out in under 100ms', () => {
    const items = Array.from({ length: 64 }, (_, i) => ({ id: `t${i}` }));
    const t = performance.now();
    run({ items, container: { w: 800, h: 800 }, options: { resizable: true } });
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe('Grafana dashboard', () => {
  const s = scenario('grafana-node-exporter', 'dashboard');
  const r = run(s);

  it('tiles to 24 columns and 23 grid units of height', () => {
    expect(gridTiling(s.items, s.options)).toEqual({ cols: 24, rows: 23 });
  });

  it('puts each panel at its gridPos, in 30px rows with 8px margins', () => {
    const { cells } = cellsOf(s, r);
    for (const item of s.items) {
      expect({ id: item.id, ...cells.get(item.id) }).toMatchObject({
        id: item.id,
        ...item.placement?.cell,
      });
    }
    expect(r.placements.get('cpu-cores')?.h).toBe(2 * 30 + 8);
    expect(r.placements.get('cpu-basic')?.y).toBe(8 + 6 * (30 + 8));
  });

  it('puts the right-edge panel flush with the right padding', () => {
    const edge = r.placements.get('edge-panel') as Rect;
    expect(edge.x + edge.w).toBeCloseTo(s.container.w - 8, 6);
  });

  it('clamps a w:30 panel to the full 24 columns', () => {
    const wide = r.placements.get('imported-w30') as Rect;
    expect(wide.x).toBe(8);
    expect(wide.w).toBeCloseTo(s.container.w - 16, 6);
  });

  it('growing CPU Basic a row pushes the network panel under it down a row', () => {
    const preset = PRESETS.find((p) => p.id === 'grafana-node-exporter')!;
    const store = presetToStore(preset);
    const cpu = r.placements.get('cpu-basic') as Rect;
    const seam = r.affordances.find((a) => a.id === 'resize-y-cpu-basic')!;
    gridStrategy.dispatchAffordance?.({
      event: {
        affordanceId: seam.id,
        kind: 'drag',
        payload: { point: { x: cpu.x, y: cpu.y + cpu.h + 38 } },
      },
      affordance: seam,
      store,
      parentId: asNodeId('dashboard'),
      container: s.container,
      options: s.options,
      items: s.items,
    });
    expect(store.getNode(asNodeId('cpu-basic'))?.membership?.placement?.span).toEqual({
      cols: 12,
      rows: 8,
    });
    const after = run(fromStore(store, 'dashboard', s));
    expect(after.placements.get('net-basic')!.y).toBe(r.placements.get('net-basic')!.y + 38);
    expect(after.placements.get('mem-basic')!.y).toBe(r.placements.get('mem-basic')!.y);
    expect(after.unplaced ?? []).toEqual(r.unplaced ?? []);
  });
});

describe('periodic table', () => {
  const main = scenario('periodic-table', 'main-table');
  const fBlock = scenario('periodic-table', 'f-block');
  const cellOf = (sc: Scenario, id: string) => cellsOf(sc, run(sc)).cells.get(id);

  it('holds only elements and the two f-block markers, each placed at its own cell', () => {
    const r = run(main);
    expect(main.items).toHaveLength(118 - 30 + 2);
    expect(r.unplaced).toBeUndefined();
    const { cells } = cellsOf(main, r);
    for (const item of [...main.items, ...fBlock.items]) {
      expect(item.id).toMatch(/^(el-|lanthanides-ref|actinides-ref)/);
      const want = item.placement?.cell;
      const sc = main.items.includes(item) ? main : fBlock;
      const got = sc === main ? cells.get(item.id) : cellOf(fBlock, item.id);
      expect({ id: item.id, ...got }).toMatchObject({ id: item.id, ...want });
    }
  });

  it('puts every element in its IUPAC group and period', () => {
    expect(gridTiling(main.items, main.options)).toEqual({ cols: 18, rows: 7 });
    expect(cellOf(main, 'el-He')).toMatchObject({ col: 17, row: 0 });
    expect(cellOf(main, 'el-B')).toMatchObject({ col: 12, row: 1 });
    expect(cellOf(main, 'el-Al')).toMatchObject({ col: 12, row: 2 });
    expect(cellOf(main, 'el-Hf')).toMatchObject({ col: 3, row: 5 });
    expect(cellOf(main, 'el-Og')).toMatchObject({ col: 17, row: 6 });
  });

  it('the detached f-block lines up under groups 3–17', () => {
    expect(gridTiling(fBlock.items, fBlock.options)).toEqual({ cols: 18, rows: 2 });
    expect(cellOf(fBlock, 'el-La')).toMatchObject({ col: 2, row: 0 });
    expect(cellOf(fBlock, 'el-Lr')).toMatchObject({ col: 16, row: 1 });
  });
});

describe('keyboards', () => {
  it('an ANSI 60% board at quarter-unit resolution fills five rows of 15u exactly', () => {
    const s = scenario('keyboard-ansi-60', 'keyboard');
    const { cells } = cellsOf(s, run(s));
    expect(gridTiling(s.items, s.options)).toEqual({ cols: 60, rows: 5 });
    expect(cells.get('key-backspace')).toEqual({ col: 52, row: 0, cols: 8, rows: 1 });
    expect(cells.get('key-enter')).toEqual({ col: 51, row: 2, cols: 9, rows: 1 });
    expect(cells.get('key-space')).toEqual({ col: 15, row: 4, cols: 25, rows: 1 });
  });

  it('fractional `u` spans are floored, not honored — rows come up short and Caps wraps onto the Tab row', () => {
    const s = scenario('keyboard-ansi-60-units', 'keyboard-u');
    const { cells } = cellsOf(s, run(s));
    expect(cells.get('key-tab')?.cols).toBe(1);
    expect(cells.get('key-space')?.cols).toBe(6);
    expect(cells.get('key-caps')).toEqual({ col: 14, row: 1, cols: 1, rows: 1 });
  });
});

describe('Excel frozen panes (pinned headers)', () => {
  const s = scenario('excel-frozen-panes', 'sheet');
  const r = run(s);
  const pinned = s.items.filter((i) => typeof i.meta?.pinned === 'number').map((i) => i.id);

  it('every pinned header survives the capacity trim; only data cells are unplaced', () => {
    expect(pinned).toHaveLength(14);
    for (const id of pinned) expect(r.placements.has(id)).toBe(true);
    expect((r.unplaced ?? []).every((id) => !pinned.includes(id))).toBe(true);
    expect(r.placements.size).toBe(36);
  });

  it('sizes the row-number column 32px, every other column 64px, and every row 20px', () => {
    const { cells } = cellsOf(s, r);
    for (const [id, rect] of r.placements) {
      expect(rect.w, id).toBe(cells.get(id)!.col === 0 ? 32 : 64);
      expect(rect.h, id).toBe(20);
    }
  });

  it('dragging the seam after column A widens it alone and writes the tracks back', () => {
    const preset = PRESETS.find((p) => p.id === 'excel-frozen-panes')!;
    const store = presetToStore(preset);
    const seam = r.affordances.find((a) => a.id === 'track-x-1')!;
    gridStrategy.dispatchAffordance?.({
      event: { affordanceId: seam.id, kind: 'drag', payload: { dx: 16 } },
      affordance: seam,
      store,
      parentId: asNodeId('sheet'),
      container: s.container,
      options: s.options,
      items: s.items,
    });
    const config = store.getNode(asNodeId('sheet'))?.container?.config as Cfg;
    expect(config.tracks?.cols).toEqual([32, 80, 64, 64, 64, 64]);
    const after = run(fromStore(store, 'sheet', s));
    expect(after.placements.get('cell-A')!.w).toBe(80);
    expect(after.placements.get('cell-B')!.x).toBe(r.placements.get('cell-B')!.x + 16);
  });

  it('a pin holds a childOrder index, not a cell: a trimmed sheet shifts a row header out of column A', () => {
    const { cells } = cellsOf(s, r);
    const offColumnA = pinned.filter((id) => id.startsWith('cell-row') && cells.get(id)?.col !== 0);
    expect(offColumnA.length).toBeGreaterThan(0);
  });
});

describe('pathological spans', () => {
  it('a NaN span in a row-capped grid clamps to one cell', () => {
    const s = PATHOLOGICAL.find((p) => p.id === 'span-nan-capped') as Scenario;
    expect(run(s).placements.has('nan')).toBe(true);
  });

  it('0 and negative spans clamp to one cell', () => {
    const s = PATHOLOGICAL.find((p) => p.id === 'span-zero-and-negative') as Scenario;
    const r = run(s);
    expect(r.placements.get('zero')?.w).toBe(100);
    expect(r.placements.get('negative')?.w).toBe(100);
  });

  it('a 0×0 container still places everything, reporting the excess as overflow', () => {
    const s = PATHOLOGICAL.find((p) => p.id === 'zero-container') as Scenario;
    const r = run(s);
    expect(r.placements.size).toBe(3);
    expect(r.overflow?.w).toBeGreaterThan(0);
  });
});

/**
 * Runs a grid layout in a child process, so an input that never terminates
 * fails the test instead of hanging the runner.
 */
function terminates(items: unknown, options: unknown, timeoutMs = 3000): boolean {
  const grid = fileURLToPath(new URL('./grid.ts', import.meta.url));
  // Source imports name `.js`; strip-types node finds only the `.ts` beside it.
  const code = `
    const { registerHooks } = await import('node:module');
    registerHooks({
      resolve(spec, ctx, next) {
        try { return next(spec, ctx); } catch (e) {
          if (spec.endsWith('.js')) return next(spec.slice(0, -3) + '.ts', ctx);
          throw e;
        }
      },
    });
    const { gridStrategy } = await import(${JSON.stringify(grid)});
    const revive = (k, v) => (v === '__NaN' ? NaN : v === '__Inf' ? Infinity : v);
    gridStrategy.layout({
      items: JSON.parse(${JSON.stringify(JSON.stringify(items, (_k, v) => (Number.isNaN(v) ? '__NaN' : v === Number.POSITIVE_INFINITY ? '__Inf' : v)))}, revive),
      container: { w: 400, h: 300 },
      state: undefined,
      options: JSON.parse(${JSON.stringify(JSON.stringify(options, (_k, v) => (Number.isNaN(v) ? '__NaN' : v)))}, revive),
    });`;
  const out = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code],
    {
      timeout: timeoutMs,
    },
  );
  if (out.error && (out.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw out.error;
  if (out.status !== 0 && out.signal === null) throw new Error(String(out.stderr));
  return out.status === 0;
}

describe('inputs that must not hang the layout', () => {
  it('the subprocess harness sees an ordinary layout finish', () => {
    expect(terminates([{ id: 'a' }, { id: 'b' }], { cols: 2 })).toBe(true);
  });

  it('`cols: NaN`', () => {
    expect(terminates([{ id: 'a' }], { cols: Number.NaN })).toBe(true);
  });

  it('a NaN column span with unbounded rows', () => {
    expect(terminates([{ id: 'a', placement: { span: { cols: Number.NaN } } }], { cols: 3 })).toBe(
      true,
    );
  });

  it('an infinite row span with unbounded rows', () => {
    expect(
      terminates([{ id: 'a', placement: { span: { rows: Number.POSITIVE_INFINITY } } }], {
        cols: 3,
      }),
    ).toBe(true);
  });
});

describe('cost', () => {
  it('canAccept over 10k children stays in the microseconds on the pointermove path', () => {
    for (const options of [
      { cols: 100, maxRows: 200 },
      { maxItems: 20_000 },
      { maxCols: 100, maxRows: 200 },
    ]) {
      gridStrategy.canAccept?.(TEN_THOUSAND, options);
      const t = performance.now();
      for (let k = 0; k < 20; k++) gridStrategy.canAccept?.(TEN_THOUSAND, options);
      expect((performance.now() - t) / 20).toBeLessThan(5);
    }
  });

  it('a 3000-item layout finishes in under 150ms', () => {
    const items = TEN_THOUSAND.slice(0, 3000).map(({ id }) => ({ id }));
    const t = performance.now();
    run({ items, container: { w: 1000, h: 1000 }, options: { cols: 100 } });
    expect(performance.now() - t).toBeLessThan(150);
  });
});

describe('DragEngine feeding grid.canAccept', () => {
  function verdict(preset: Preset, targetId: string, sourceId: string): boolean | undefined {
    const store = presetToStore(preset);
    const strategies: Record<string, unknown> = { grid: gridStrategy, strip: stripStrategy };
    const engine = new DragEngine(store, { getStrategy: (id) => strategies[id] as never });
    engine.addDropTarget(asNodeId(targetId), {
      bounds: (): Rect => ({ x: 0, y: 0, z: 0, w: 400, h: 400 }),
    });
    engine.tryBegin(asNodeId(sourceId));
    engine.updateHoverByPoint(200, 200);
    return engine.state()?.hover?.accepted;
  }

  it('a device shell refuses every drop by accepts: false', () => {
    const shells = PRESETS.filter((p) => p.mechanics.strategy !== 'grid');
    expect(shells.length).toBeGreaterThan(0);
    for (const preset of shells) {
      const group = preset.mechanics.children?.[0]?.id as string;
      const leaf = presetToStore(preset).getChildren(asNodeId(group))[0]?.id as string;
      expect({ preset: preset.id, accepted: verdict(preset, preset.mechanics.id, leaf) }).toEqual({
        preset: preset.id,
        accepted: false,
      });
    }
  });

  it('the Pixel hotseat takes an app into a free slot but refuses a 1×1 widget by kind', () => {
    const preset = PRESETS.find((p) => p.id === 'android-full-by-count') as Preset;
    const store = presetToStore(preset);
    store.unregisterNode(asNodeId('dock-4'));
    // One cell, so only its kind can refuse it.
    store.patchPlacement(asNodeId('widget-weather'), { span: { cols: 1, rows: 1 } });
    const strategies: Record<string, unknown> = { grid: gridStrategy, strip: stripStrategy };
    const hover = (sourceId: string) => {
      const engine = new DragEngine(store, { getStrategy: (id) => strategies[id] as never });
      engine.addDropTarget(asNodeId('hotseat'), {
        bounds: (): Rect => ({ x: 0, y: 0, z: 0, w: 400, h: 72 }),
      });
      engine.tryBegin(asNodeId(sourceId));
      engine.updateHoverByPoint(200, 36);
      const accepted = engine.state()?.hover?.accepted;
      engine.cancel();
      return accepted;
    };
    expect(hover('new-app')).toBe(true);
    expect(hover('widget-weather')).toBe(false);
  });

  it('an over-capacity sheet accepts a reorder of its own cells', () => {
    const preset = PRESETS.find((p) => p.id === 'excel-frozen-panes') as Preset;
    expect(verdict(preset, 'sheet', 'cell-B1')).toBe(true);
  });

  it('a hidden child does not count toward maxItems', () => {
    const preset: Preset = {
      id: 'hidden-slot',
      source: 'a two-slot quick-settings row with one tile hidden by the user',
      stress: 'hidden children in the accept count',
      description:
        'A phone quick-settings row with room for two tiles, where the user has hidden one of them.',
      viewport: { w: 400, h: 400 },
      mechanics: {
        id: 'shell',
        strategy: 'strip',
        children: [
          {
            id: 'row',
            strategy: 'grid',
            config: { cols: 2, maxItems: 2 },
            children: [{ id: 'wifi' }, { id: 'bluetooth', hidden: true }],
          },
          { id: 'tray', strategy: 'grid', children: [{ id: 'torch' }] },
        ],
      },
    };
    const visible = presetScenario(preset, 'row');
    expect(visible.items.map((i) => i.id)).toEqual(['wifi']);
    expect(gridStrategy.canAccept?.([...visible.items, { id: 'torch' }], visible.options)).toBe(
      true,
    );
    expect(verdict(preset, 'row', 'torch')).toBe(true);
  });
});
