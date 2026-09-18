import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode } from '../constructors.js';
import { ContainerHost } from '../container-host.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
import type { LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { configureTrace } from '../trace.js';
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

const run = (
  items: LayoutItem[],
  options: Record<string, unknown>,
  container = { w: 400, h: 400 },
) => gridStrategy.layout({ items, container, state: undefined as void, options });

/** The cell each placed item's rect starts at, in a gap- and padding-free grid. */
function cellsOf(
  items: LayoutItem[],
  options: Record<string, unknown>,
  container = { w: 400, h: 400 },
): Record<string, [number, number]> {
  const { cols, rows } = gridTiling(items, options);
  const r = run(items, options, container);
  const out: Record<string, [number, number]> = {};
  for (const [id, rect] of r.placements) {
    out[id] = [
      Math.round(rect.x / (container.w / cols)),
      Math.round(rect.y / (container.h / rows)),
    ];
  }
  return out;
}

describe('gridStrategy — placement.cell', () => {
  it('puts a celled item at its cell, zero-based', () => {
    const r = run([at('a', { col: 2, row: 1 })], { cols: 4, fill: false, maxRows: 2 });
    expect(r.placements.get('a')).toEqual({ x: 200, y: 200, z: 0, w: 100, h: 200 });
  });

  it('places celled items first and flows the rest into the free cells in order', () => {
    // b holds (0,0) though it comes second, so a flows to (1,0).
    const items = [flow('a'), at('b', { col: 0, row: 0 }), flow('c'), at('d', { col: 2, row: 0 })];
    expect(cellsOf(items, { cols: 3 })).toEqual({
      a: [1, 0],
      b: [0, 0],
      c: [0, 1],
      d: [2, 0],
    });
  });

  it('reserves a celled span as a block the flow steps around', () => {
    const items = [
      at('big', { col: 1, row: 0 }, { cols: 2, rows: 2 }),
      flow('a'),
      flow('b'),
      flow('c'),
    ];
    expect(cellsOf(items, { cols: 3 })).toEqual({
      big: [1, 0],
      a: [0, 0],
      b: [0, 1],
      c: [0, 2],
    });
    expect(run(items, { cols: 3 }).placements.get('big')).toMatchObject({ w: 800 / 3 });
  });

  it('grows an uncapped grid to reach the furthest cell', () => {
    const items = [at('h', { col: 0, row: 0 }), at('he', { col: 17, row: 0 })];
    expect(gridTiling(items, {})).toEqual({ cols: 18, rows: 1 });
    expect(gridTiling([at('x', { col: 0, row: 6 })], {})).toEqual({ cols: 1, rows: 7 });
  });

  it('agrees with gridTiling on the rows a celled layout uses', () => {
    const items = [at('a', { col: 1, row: 3 }), flow('b')];
    expect(gridTiling(items, { cols: 2 })).toEqual({ cols: 2, rows: 4 });
    expect(run(items, { cols: 2 }).placements.get('a')).toEqual({
      x: 200,
      y: 300,
      z: 0,
      w: 200,
      h: 100,
    });
  });

  it('floors a fractional cell', () => {
    expect(cellsOf([at('a', { col: 1.7, row: 0.2 })], { cols: 2 })).toEqual({ a: [1, 0] });
  });

  it('flows an item whose cell is not two finite, non-negative numbers', () => {
    for (const cell of [
      { col: -1, row: 0 },
      { col: Number.NaN, row: 0 },
      { col: 0, row: Number.POSITIVE_INFINITY },
      { col: 1 } as unknown as Cell,
    ]) {
      const r = run([flow('a'), at('b', cell)], { cols: 2 });
      expect(r.placements.get('b')).toMatchObject({ x: 200, y: 0 });
      expect(r.unplaced).toBeUndefined();
    }
  });

  it('clamps a span that would run off a capped grid to the room past its cell', () => {
    const r = run([at('a', { col: 2, row: 0 }, { cols: 5, rows: 5 })], {
      cols: 4,
      maxRows: 2,
      fill: false,
    });
    expect(r.placements.get('a')).toEqual({ x: 200, y: 0, z: 0, w: 200, h: 400 });
  });

  it('counts a celled item toward maxItems', () => {
    const r = run([flow('a'), flow('b'), at('c', { col: 3, row: 3 })], { cols: 4, maxItems: 2 });
    expect(r.unplaced).toEqual(['b']);
  });

  it('keeps an unplaceable cell from widening the grid while flow items fit', () => {
    // Two cells collide in a row-capped grid. Growing columns cannot cure a
    // collision, so the grid must not grow looking for room.
    const items = [at('a', { col: 0, row: 0 }), at('b', { col: 0, row: 0 }), flow('c')];
    expect(gridTiling(items, { rows: 2 })).toEqual({ cols: 2, rows: 1 });
  });

  describe('collisions and bounds', () => {
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

    it('sends the later of two colliding cells to unplaced, with a trace', () => {
      const r = run([at('a', { col: 1, row: 1 }), at('b', { col: 1, row: 1 })], { cols: 2 });
      expect(r.placements.has('a')).toBe(true);
      expect(r.unplaced).toEqual(['b']);
      expect(logged.join('\n')).toMatch(/b.*cell \(1, 1\).*collides/);
    });

    it('counts an overlap with a celled span as a collision', () => {
      const r = run(
        [at('a', { col: 0, row: 0 }, { cols: 2, rows: 2 }), at('b', { col: 1, row: 1 })],
        {
          cols: 3,
        },
      );
      expect(r.unplaced).toEqual(['b']);
    });

    it('sends a cell past a fixed column count to unplaced, with a trace', () => {
      const r = run([at('a', { col: 4, row: 0 }), flow('b')], { cols: 4 });
      expect(r.unplaced).toEqual(['a']);
      expect(r.placements.get('b')).toMatchObject({ x: 0, y: 0 });
      expect(logged.join('\n')).toMatch(/a.*cell \(4, 0\).*outside/);
    });

    it('sends a cell past maxCols or a row cap to unplaced', () => {
      expect(run([at('a', { col: 5, row: 0 })], { maxCols: 5 }).unplaced).toEqual(['a']);
      expect(run([at('a', { col: 0, row: 2 })], { cols: 2, maxRows: 2 }).unplaced).toEqual(['a']);
      expect(run([at('a', { col: 0, row: 3 })], { rows: 3 }).unplaced).toEqual(['a']);
    });

    it('traces a cell it cannot read', () => {
      run([at('a', { col: -1, row: 0 })], { cols: 2 });
      expect(logged.join('\n')).toMatch(/a.*cell.*ignored/);
    });
  });

  it('flow items take the place a collision left, not the loser', () => {
    const items = [at('a', { col: 0, row: 0 }), at('b', { col: 0, row: 0 }), flow('c')];
    const r = run(items, { cols: 2, maxRows: 1 });
    expect(r.unplaced).toEqual(['b']);
    expect(r.placements.get('c')).toMatchObject({ x: 200, y: 0 });
  });

  describe('resize reach', () => {
    const OPTS = { cols: 4, maxRows: 2, resizable: true };
    const valueMax = (items: LayoutItem[], id: string, axis: 'x' | 'y', options = OPTS) =>
      run(items, options).affordances.find((a) => a.id === `resize-${axis}-${id}`)?.bounds
        ?.valueMax;

    it('stops a flow item short of a celled neighbor when it has no row to move to', () => {
      const items = [flow('a'), at('b', { col: 2, row: 0 })];
      expect(valueMax(items, 'a', 'x', { cols: 4, maxRows: 1, resizable: true })).toBe(2);
    });

    it('stops a celled item short of another cell', () => {
      const items = [at('a', { col: 0, row: 0 }), at('b', { col: 3, row: 0 })];
      expect(valueMax(items, 'a', 'x')).toBe(3);
    });

    it('lets a celled item push flow items along rather than stopping at them', () => {
      // The flow item re-flows to the next free cell, so it costs nothing.
      const items = [at('a', { col: 0, row: 0 }), flow('b')];
      expect(valueMax(items, 'a', 'x')).toBe(4);
    });

    it('respects cells in an unbounded grid too', () => {
      const items = [at('a', { col: 0, row: 0 }), at('b', { col: 2, row: 0 })];
      expect(valueMax(items, 'a', 'x', { cols: 4, resizable: true } as typeof OPTS)).toBe(2);
    });
  });

  describe('drop preview', () => {
    it('previews a celled item reordered in its own grid as flow at the index', () => {
      const items = [at('a', { col: 3, row: 0 }), flow('b'), flow('c')];
      const p = gridStrategy.getDropPreview?.({
        items,
        container: { w: 400, h: 100 },
        options: { cols: 4 },
        insertId: 'a',
        insertIndex: 1,
        cursor: { x: 0, y: 0 },
      });
      expect(p?.accepted).toBe(true);
      // b, a, c flow into columns 0, 1, 2.
      expect(p?.placements.get('a')).toMatchObject({ x: 100, y: 0 });
      expect(p?.placements.get('c')).toMatchObject({ x: 200, y: 0 });
    });
  });

  it('canAccept over 10k celled children stays O(items)', () => {
    const items = Array.from({ length: 10_000 }, (_, i) =>
      at(`c${i}`, { col: i % 100, row: Math.floor(i / 100) }),
    );
    const options = { cols: 100, maxRows: 200 };
    gridStrategy.canAccept?.(items, options);
    const t = performance.now();
    for (let k = 0; k < 20; k++) gridStrategy.canAccept?.(items, options);
    expect((performance.now() - t) / 20).toBeLessThan(5);
  });

  it('lays out 3000 celled items with a flow tail quickly', () => {
    const items = [
      ...Array.from({ length: 3000 }, (_, i) =>
        at(`c${i}`, { col: (i * 7) % 100, row: Math.floor(i / 50) }),
      ),
      ...Array.from({ length: 500 }, (_, i) => flow(`f${i}`)),
    ];
    const t = performance.now();
    const r = run(items, { cols: 100 }, { w: 1000, h: 1000 });
    expect(performance.now() - t).toBeLessThan(150);
    expect(r.placements.size).toBeGreaterThan(3000);
  });
});

describe('placement.cell in the store', () => {
  function storeWith(ids: string[], cells: Record<string, Cell> = {}) {
    const s = new Store();
    const z = asNodeId('z');
    const other = asNodeId('other');
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: {} }, id: z }),
    );
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: {} }, id: other }),
    );
    for (const id of ids) {
      s.registerNode(createNode({ kind: 'panel', id: asNodeId(id), parentId: z }));
      const cell = cells[id];
      if (cell) s.patchPlacement(asNodeId(id), { cell });
    }
    return s;
  }
  const cellOf = (s: Store, id: string) => s.getPlacement(asNodeId(id)).cell;

  it('surfaces cell on the layout item', () => {
    const s = storeWith(['a'], { a: { col: 2, row: 3 } });
    const node = s.getNode(asNodeId('a'));
    if (!node) throw new Error('missing');
    expect(nodeToLayoutItem(node).placement?.cell).toEqual({ col: 2, row: 3 });
  });

  it('a reorder clears cell, so the item flows from its new index', () => {
    const s = storeWith(['a', 'b', 'c'], { a: { col: 3, row: 0 } });
    s.reorderInParent(asNodeId('a'), 2);
    expect(cellOf(s, 'a')).toBeUndefined();
    expect(s.getPlacement(asNodeId('a'))).not.toHaveProperty('cell');
  });

  it('a reorder to the index it already holds keeps cell', () => {
    const s = storeWith(['a', 'b'], { a: { col: 3, row: 0 } });
    s.reorderInParent(asNodeId('a'), 0);
    expect(cellOf(s, 'a')).toEqual({ col: 3, row: 0 });
  });

  it('a same-parent moveNode — what a drag commits — clears cell', () => {
    const s = storeWith(['a', 'b', 'c'], { a: { col: 3, row: 0 } });
    s.moveNode(asNodeId('a'), asNodeId('z'), 2);
    expect(cellOf(s, 'a')).toBeUndefined();
  });

  it('a moveNode that lands where it started keeps cell', () => {
    const s = storeWith(['a', 'b'], { a: { col: 3, row: 0 } });
    s.moveNode(asNodeId('a'), asNodeId('z'), 0);
    expect(cellOf(s, 'a')).toEqual({ col: 3, row: 0 });
  });

  it('a move to another parent clears cell, which named a cell in the old grid', () => {
    const s = storeWith(['a'], { a: { col: 3, row: 0 } });
    s.moveNode(asNodeId('a'), asNodeId('other'));
    expect(cellOf(s, 'a')).toBeUndefined();
  });

  it('moveNodes clears cell on every node it moves', () => {
    const s = storeWith(['a', 'b', 'c'], { a: { col: 3, row: 0 }, b: { col: 2, row: 0 } });
    s.moveNodes([asNodeId('a'), asNodeId('b')], asNodeId('other'));
    expect(cellOf(s, 'a')).toBeUndefined();
    expect(cellOf(s, 'b')).toBeUndefined();
  });

  it('reports the clear as a placement change', () => {
    const s = storeWith(['a', 'b'], { a: { col: 3, row: 0 } });
    const seen: unknown[] = [];
    s.events.on('node.placementChanged', (e) => seen.push(e));
    s.reorderInParent(asNodeId('a'), 1);
    expect(seen).toEqual([
      { id: 'a', changes: { cell: { from: { col: 3, row: 0 }, to: undefined } } },
    ]);
  });

  it('setChildOrder leaves cell alone: it arranges every child, not one', () => {
    const s = storeWith(['a', 'b'], { a: { col: 3, row: 0 } });
    s.setChildOrder(asNodeId('z'), [asNodeId('b'), asNodeId('a')]);
    expect(cellOf(s, 'a')).toEqual({ col: 3, row: 0 });
  });
});

describe('placement.cell under a ContainerHost drop preview', () => {
  it('keeps the cells of the children that are not moving', () => {
    const s = new Store();
    const z = asNodeId('z');
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: { cols: 4 } }, id: z }),
    );
    for (const id of ['a', 'b', 'c']) {
      s.registerNode(createNode({ kind: 'panel', id: asNodeId(id), parentId: z }));
      s.showNode(asNodeId(id));
    }
    s.patchPlacement(asNodeId('a'), { cell: { col: 3, row: 1 } });
    const host = new ContainerHost(s, z, new Map([['grid', gridStrategy as never]]));
    host.setViewport({ w: 400, h: 200 });
    host.setPreview({ insertId: 'c', insertIndex: 0, cursor: { x: 0, y: 0 } });
    expect(host.layout().placements.get(asNodeId('a'))).toMatchObject({ x: 300, y: 100 });
  });
});

describe('gridStrategy — fixed cell size (config cell)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => flow(`i${i}`));
  const CELL = { w: 64, h: 48 };

  it('keeps cells their size instead of stretching them to the container', () => {
    const r = run(ids(3), { cell: CELL, gap: 8 });
    expect(r.placements.get('i0')).toEqual({ x: 0, y: 0, z: 0, w: 64, h: 48 });
    expect(r.placements.get('i2')).toEqual({ x: 144, y: 0, z: 0, w: 64, h: 48 });
    expect(r.overflow).toBeUndefined();
  });

  it('takes its columns from how many cells fit across, and wraps', () => {
    // (400 + 8) / (64 + 8) = 5.67 → 5 columns.
    const r = run(ids(7), { cell: CELL, gap: 8 });
    expect(r.placements.get('i4')).toMatchObject({ x: 288, y: 0 });
    expect(r.placements.get('i5')).toMatchObject({ x: 0, y: 56 });
    expect(gridTiling(ids(7), { cell: CELL, gap: 8 }, { w: 400, h: 400 })).toEqual({
      cols: 5,
      rows: 2,
    });
  });

  it('fits columns inside the padding', () => {
    // (320 + 8) / 72 = 4.56 → 4 columns.
    const r = run(ids(5), { cell: CELL, gap: 8, padding: 40 });
    expect(r.placements.get('i4')).toMatchObject({ x: 40, y: 96 });
  });

  it('fits at least one column in a container narrower than a cell', () => {
    const r = run(ids(2), { cell: CELL }, { w: 30, h: 400 });
    expect(r.placements.get('i1')).toMatchObject({ x: 0, y: 48, w: 64 });
    expect(r.overflow).toEqual({ w: 34, h: 0 });
  });

  it('caps the fitted columns at maxCols', () => {
    expect(gridTiling(ids(6), { cell: CELL, maxCols: 3 }, { w: 400, h: 400 })).toEqual({
      cols: 3,
      rows: 2,
    });
  });

  it('lets cols override the fit, reporting the width it overflows by', () => {
    const r = run(ids(8), { cell: CELL, gap: 8, cols: 8 });
    expect(r.placements.get('i7')).toMatchObject({ x: 504, y: 0 });
    expect(r.overflow).toEqual({ w: 168, h: 0 });
  });

  it('reports rows past the container as overflow, or unplaces them on request', () => {
    const items = ids(12);
    const opts = { cell: { w: 100, h: 150 } };
    expect(run(items, opts).overflow).toEqual({ w: 0, h: 50 });
    const cut = run(items, { ...opts, overflowMode: 'unplaced' });
    expect(cut.unplaced).toEqual(['i8', 'i9', 'i10', 'i11']);
    expect(cut.overflow).toBeUndefined();
  });

  it('holds one row under maxRows: 1, like a dock', () => {
    const r = run(ids(7), { cell: CELL, gap: 8, maxRows: 1 });
    expect(r.unplaced).toEqual(['i5', 'i6']);
  });

  it('fixes one axis and divides the container on the other', () => {
    const r = run(ids(4), { cell: { h: 48 }, cols: 2 });
    expect(r.placements.get('i3')).toEqual({ x: 200, y: 48, z: 0, w: 200, h: 48 });
  });

  it('ignores an axis that is not a positive, finite number', () => {
    for (const cell of [
      { w: 0, h: 0 },
      { w: Number.NaN },
      { w: -5, h: Number.POSITIVE_INFINITY },
    ]) {
      const r = run(ids(4), { cell, cols: 2 });
      expect(r.placements.get('i3')).toEqual({ x: 200, y: 200, z: 0, w: 200, h: 200 });
    }
  });

  it('ignores minSize floors, since the cell size is stated', () => {
    const items = ids(2).map((it) => ({ ...it, hints: { minSize: { w: 300, h: 300 } } }));
    const r = run(items, { cell: CELL, overflowMode: 'scroll' });
    expect(r.placements.get('i1')).toMatchObject({ x: 64, w: 64, h: 48 });
  });

  it('spans whole fixed cells plus the gaps between them', () => {
    const r = run([flow('a', { cols: 2, rows: 2 })], { cell: CELL, gap: 8 });
    expect(r.placements.get('a')).toEqual({ x: 0, y: 0, z: 0, w: 136, h: 104 });
  });

  it('auto-balances when gridTiling has no container to fit into', () => {
    expect(gridTiling(ids(4), { cell: CELL })).toEqual({ cols: 2, rows: 2 });
  });

  it('resolves a seam drag in fixed-cell steps', () => {
    const s = new Store();
    const z = asNodeId('z');
    const opts = { cell: CELL, gap: 8, resizable: true, maxRows: 2 };
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: opts }, id: z }),
    );
    for (const id of ['a', 'b']) {
      s.registerNode(createNode({ kind: 'panel', id: asNodeId(id), parentId: z }));
    }
    const items = [flow('a'), flow('b')];
    const affordance = run(items, opts).affordances.find((a) => a.id === 'resize-x-a');
    if (!affordance) throw new Error('no seam');
    gridStrategy.dispatchAffordance?.({
      event: { affordanceId: affordance.id, kind: 'drag', payload: { point: { x: 210, y: 10 } } },
      affordance,
      store: s,
      parentId: z,
      container: { w: 400, h: 400 },
      options: opts,
      items,
    });
    // 210px from the origin is nearest three 72px strides.
    expect(s.getPlacement(asNodeId('a')).span).toEqual({ cols: 3 });
  });
});
