import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { PRESETS } from '../nuts/grid-scenarios.js';
import { type Preset, presetScenario, presetToStore } from '../nuts/preset.js';
import { checkStrategyConfig } from './config-check.js';
import { gridStrategy, gridTiling } from './grid.js';

type Cell = { col: number; row: number };
type Span = { cols?: number; rows?: number };

const at = (id: string, cell: Cell, span?: Span): LayoutItem => ({
  id,
  placement: { cell, ...(span ? { span } : {}) },
});
const flow = (id: string, span?: Span): LayoutItem => ({
  id,
  ...(span ? { placement: { span } } : {}),
});

/** 10px cells, no gap or padding, so a rect reads straight back as a cell. */
const OPTS = { cols: 4, cell: { w: 10, h: 10 }, compact: 'up' };

const run = (items: LayoutItem[], options: Record<string, unknown> = OPTS) =>
  gridStrategy.layout({ items, container: { w: 40, h: 400 }, state: undefined as void, options });

function cells(items: LayoutItem[], options: Record<string, unknown> = OPTS) {
  const r = run(items, options);
  const out: Record<string, [number, number]> = {};
  for (const [id, rect] of r.placements) out[id] = [rect.x / 10, rect.y / 10];
  return out;
}

describe("gridStrategy — compact: 'up'", () => {
  it('floats a celled item up into the free rows above it', () => {
    expect(cells([at('a', { col: 1, row: 5 })])).toEqual({ a: [1, 0] });
  });

  it('leaves the rows alone without compact', () => {
    const { compact: _, ...plain } = OPTS;
    expect(cells([at('a', { col: 1, row: 5 })], plain)).toEqual({ a: [1, 5] });
  });

  it('stops an item under whatever sits above it in its columns', () => {
    const items = [at('a', { col: 0, row: 2 }, { cols: 2, rows: 3 }), at('b', { col: 1, row: 9 })];
    expect(cells(items)).toEqual({ a: [0, 0], b: [1, 3] });
  });

  it('keeps columns independent: an item floats past a neighbor beside it', () => {
    const items = [at('a', { col: 0, row: 0 }, { rows: 4 }), at('b', { col: 1, row: 6 })];
    expect(cells(items)).toEqual({ a: [0, 0], b: [1, 0] });
  });

  it('keeps vertical order within a column', () => {
    const items = [at('low', { col: 0, row: 8 }), at('high', { col: 0, row: 3 })];
    expect(cells(items)).toEqual({ high: [0, 0], low: [0, 1] });
  });

  it('pushes the lower of two colliding cells down beneath the upper, instead of unplacing it', () => {
    const items = [at('b', { col: 0, row: 1 }), at('a', { col: 0, row: 0 }, { rows: 3 })];
    const r = run(items);
    expect(r.unplaced).toBeUndefined();
    expect(cells(items)).toEqual({ a: [0, 0], b: [0, 3] });
  });

  it('breaks a tie at the same cell by childOrder', () => {
    const items = [at('first', { col: 2, row: 0 }), at('second', { col: 2, row: 0 })];
    expect(cells(items)).toEqual({ first: [2, 0], second: [2, 1] });
  });

  it('pushes a chain: each item moves only as far as the one above it grew', () => {
    const items = [
      at('a', { col: 0, row: 0 }, { cols: 2, rows: 2 }),
      at('b', { col: 1, row: 1 }),
      at('c', { col: 1, row: 2 }),
      at('d', { col: 3, row: 1 }),
    ];
    expect(cells(items)).toEqual({ a: [0, 0], b: [1, 2], c: [1, 3], d: [3, 0] });
  });

  it('flows the rest into the free cells the compacted cells leave', () => {
    const items = [flow('f1'), at('a', { col: 0, row: 4 }, { cols: 3 }), flow('f2')];
    expect(cells(items)).toEqual({ a: [0, 0], f1: [3, 0], f2: [0, 1] });
  });

  it('still sends a cell past the columns to unplaced', () => {
    expect(run([at('a', { col: 4, row: 0 })]).unplaced).toEqual(['a']);
  });

  it('unplaces an item pushed past a row cap', () => {
    const items = [at('a', { col: 0, row: 0 }, { rows: 2 }), at('b', { col: 0, row: 1 })];
    const r = run(items, { ...OPTS, maxRows: 2 });
    expect(r.unplaced).toEqual(['b']);
  });

  it('reports the compacted rows through gridTiling', () => {
    const items = [at('a', { col: 0, row: 7 }), at('b', { col: 1, row: 9 })];
    expect(gridTiling(items, OPTS)).toEqual({ cols: 4, rows: 1 });
  });

  it('is deterministic whatever order the children arrive in', () => {
    const items = [
      at('a', { col: 0, row: 3 }, { cols: 2 }),
      at('b', { col: 2, row: 1 }, { rows: 2 }),
      at('c', { col: 1, row: 5 }),
      at('d', { col: 3, row: 0 }),
    ];
    const want = cells(items);
    expect(cells([...items].reverse())).toEqual(want);
    expect(cells([items[2], items[0], items[3], items[1]] as LayoutItem[])).toEqual(want);
  });

  it('is a declared config key with one value', () => {
    const spec = gridStrategy.configSpec;
    if (!spec) throw new Error('no spec');
    expect(checkStrategyConfig('grid', { compact: 'up' }, spec)).toEqual([]);
    expect(checkStrategyConfig('grid', { compact: 'down' }, spec)).toHaveLength(1);
  });

  describe('resize', () => {
    const seam = (items: LayoutItem[], id: string, options: Record<string, unknown>) =>
      run(items, { ...options, resizable: true }).affordances.find((a) => a.id === id);

    it('lets a celled item grow into the item below, which moves down', () => {
      const items = [at('a', { col: 0, row: 0 }), at('b', { col: 0, row: 1 })];
      // Without compact, b stops a's growth dead, so there is no seam at all.
      expect(seam(items, 'resize-y-a', { cols: 4, cell: { w: 10, h: 10 } })).toBeUndefined();
      expect(seam(items, 'resize-y-a', OPTS)?.bounds?.valueMax).toBeGreaterThan(1);
    });

    it('caps the growth at what keeps everyone placed under a row cap', () => {
      const items = [at('a', { col: 0, row: 0 }), at('b', { col: 0, row: 1 })];
      expect(seam(items, 'resize-y-a', { ...OPTS, maxRows: 3 })?.bounds?.valueMax).toBe(2);
    });

    it('lets a celled item widen into a neighbor on its row, which moves down', () => {
      const items = [at('a', { col: 0, row: 0 }), at('b', { col: 1, row: 0 })];
      expect(seam(items, 'resize-x-a', OPTS)?.bounds?.valueMax).toBe(4);
    });
  });
});

describe('Grafana dashboard under compact', () => {
  const preset = PRESETS.find((p) => p.id === 'grafana-node-exporter') as Preset;
  const declared = presetScenario(preset, 'dashboard');
  // The preset states compact; these compare the dashboard with and without it.
  const { compact: _, ...loose } = declared.options;
  const base = { ...declared, options: loose };
  const compact = { ...base, options: { ...loose, compact: 'up' } };
  const run2 = (s: typeof base) => runLayout(s.items, s.options, s.container);
  const rowOf = (s: typeof base, id: string) => {
    const rect = run2(s).placements.get(id);
    if (!rect) throw new Error(`${id} not placed`);
    return Math.round((rect.y - 8) / 38);
  };

  it('keeps every panel at its gridPos, which is already compact', () => {
    for (const item of base.items) {
      expect({ id: item.id, row: rowOf(compact, item.id) }).toEqual({
        id: item.id,
        row: item.placement?.cell?.row,
      });
    }
  });

  it('refuses to grow CPU Cores into RootFS Total without compact', () => {
    const aff = run2(base).affordances.find((a) => a.id === 'resize-y-cpu-cores');
    expect(aff?.bounds?.valueMax).toBe(2);
  });

  it('grows CPU Cores by a row with compact, pushing RootFS Total and everything below down', () => {
    const store = presetToStore(preset);
    const aff = run2(compact).affordances.find((a) => a.id === 'resize-y-cpu-cores');
    if (!aff) throw new Error('no seam on cpu-cores');
    expect(aff.bounds?.valueMax).toBeGreaterThan(2);
    const rect = run2(compact).placements.get('cpu-cores');
    if (!rect) throw new Error('cpu-cores not placed');
    gridStrategy.dispatchAffordance?.({
      event: {
        affordanceId: aff.id,
        kind: 'drag',
        payload: { point: { x: rect.x, y: rect.y + rect.h + 38 } },
      },
      affordance: aff,
      store,
      parentId: asNodeId('dashboard'),
      container: compact.container,
      options: compact.options,
      items: compact.items,
    });
    expect(store.getPlacement(asNodeId('cpu-cores')).span).toMatchObject({ rows: 3 });

    const grown = {
      ...compact,
      items: compact.items.map((it) =>
        it.id === 'cpu-cores'
          ? { ...it, placement: { ...it.placement, span: { cols: 2, rows: 3 } } }
          : it,
      ),
    };
    expect(rowOf(grown, 'rootfs-total')).toBe(4);
    expect(rowOf(grown, 'row-basic')).toBe(6);
    expect(rowOf(grown, 'cpu-basic')).toBe(7);
    expect(rowOf(grown, 'imported-w30')).toBe(21);
    // Panels beside the growth stay put.
    expect(rowOf(grown, 'ram-total')).toBe(3);
    expect(run2(grown).unplaced).toBeUndefined();
  });
});

function runLayout(
  items: LayoutItem[],
  options: Record<string, unknown>,
  container: { w: number; h: number },
) {
  return gridStrategy.layout({ items, container, state: undefined as void, options });
}

describe('compact cost', () => {
  it('compacts 3000 scattered cells in well under 150ms', () => {
    const items = Array.from({ length: 3000 }, (_, i) =>
      at(`c${i}`, { col: (i * 7) % 96, row: i * 3 }, { cols: 1 + (i % 4), rows: 1 + (i % 3) }),
    );
    const options = { cols: 100, compact: 'up' };
    run(items, options);
    const t = performance.now();
    const r = run(items, options);
    expect(performance.now() - t).toBeLessThan(150);
    expect(r.unplaced).toBeUndefined();
  });

  it('lays out a resizable 200-panel dashboard quickly', () => {
    const items = Array.from({ length: 200 }, (_, i) =>
      at(`p${i}`, { col: (i % 4) * 6, row: Math.floor(i / 4) * 8 }, { cols: 6, rows: 8 }),
    );
    const options = { cols: 24, cell: { h: 30 }, compact: 'up', resizable: true };
    const t = performance.now();
    run(items, options);
    expect(performance.now() - t).toBeLessThan(150);
  });
});
