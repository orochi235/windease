import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutEvent, LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { gridStrategy } from './grid.js';

const CONTAINER = { w: 400, h: 400 };
const OPTS = { resizable: true, gap: 0, padding: 0 };

const items = (n: number): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}` }));

const run = (its: LayoutItem[], options: Record<string, unknown> = OPTS) =>
  gridStrategy.layout({ items: its, container: CONTAINER, state: undefined as void, options });

const affordanceOf = (its: LayoutItem[], id: string, options = OPTS) =>
  run(its, options).affordances.find((a) => a.id === id);

/** Four items auto-balance to 2x2, so w1 has a seam on both edges. */
function store4(): Store {
  const s = new Store();
  const z = asNodeId('z');
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'grid', config: OPTS }, id: z }),
  );
  for (let i = 1; i <= 4; i++) {
    const nid = asNodeId(`w${i}`);
    s.registerNode(createNode({ kind: 'panel', id: nid, parentId: z }));
    s.showNode(nid);
  }
  return s;
}

const dispatch = (
  s: Store,
  its: LayoutItem[],
  affordanceId: string,
  payload: LayoutEvent['payload'],
) => {
  const aff = run(its).affordances.find((a) => a.id === affordanceId);
  if (!aff) throw new Error(`no affordance ${affordanceId}`);
  gridStrategy.dispatchAffordance?.({
    event: { affordanceId, kind: 'drag', payload },
    affordance: aff,
    store: s,
    parentId: asNodeId('z'),
    container: CONTAINER,
    options: OPTS,
    items: its,
  });
};

const spanOf = (s: Store, id: string) =>
  s.getNode(asNodeId(id))?.membership?.placement?.span as
    | { cols?: number; rows?: number }
    | undefined;

describe('gridStrategy resize affordances', () => {
  it('emits nothing unless asked', () => {
    expect(run(items(4), { gap: 0, padding: 0 }).affordances).toEqual([]);
  });

  it('emits a seam on each axis a span can move along', () => {
    const ids = run(items(4)).affordances.map((a) => a.id);
    expect(ids).toContain('resize-x-w1');
    expect(ids).toContain('resize-y-w1');
  });

  it('emits none where the span cannot move at all', () => {
    // Four items in a grid capped at 2x2: every cell is taken, so no span can
    // grow, and none is above 1 to shrink.
    const boxed = { ...OPTS, maxCols: 2, maxRows: 2 };
    expect(run(items(4), boxed).affordances).toEqual([]);
  });

  it('keeps the seam on an item spanning to the edge, so it can come back', () => {
    const grown: LayoutItem[] = [
      { id: 'w1', placement: { span: { cols: 2 } } },
      ...items(4).slice(1),
    ];
    expect(run(grown).affordances.map((a) => a.id)).toContain('resize-x-w1');
  });

  it('reports bounds in cells, not pixels', () => {
    const b = affordanceOf(items(4), 'resize-x-w1')?.bounds;
    expect(b?.valueNow).toBe(1);
    expect(b?.valueMin).toBe(1);
    // Growing w1 to 2 columns still leaves room for the other three.
    expect(b?.valueMax).toBe(2);
    expect(b?.step).toBe(1);
  });

  it('resolves a pointer drag to a whole cell count', () => {
    const s = store4();
    // Cell is 200 wide; a pointer at 380 wants two columns.
    dispatch(s, items(4), 'resize-x-w1', { dx: 4, point: { x: 380, y: 100 } });
    expect(spanOf(s, 'w1')?.cols).toBe(2);
  });

  it('ignores a pointer still inside the current cell', () => {
    // The case incremental dx cannot express: a few pixels must not resize,
    // and must not accumulate into one either.
    const s = store4();
    dispatch(s, items(4), 'resize-x-w1', { dx: 4, point: { x: 204, y: 100 } });
    dispatch(s, items(4), 'resize-x-w1', { dx: 4, point: { x: 208, y: 100 } });
    dispatch(s, items(4), 'resize-x-w1', { dx: 4, point: { x: 212, y: 100 } });
    expect(spanOf(s, 'w1')).toBeUndefined();
  });

  it('steps one cell per synthesized key press', () => {
    const s = store4();
    dispatch(s, items(4), 'resize-x-w1', { dx: 1 });
    expect(spanOf(s, 'w1')?.cols).toBe(2);
    dispatch(
      s,
      [{ id: 'w1', placement: { span: { cols: 2 } } }, ...items(4).slice(1)],
      'resize-x-w1',
      {
        dx: -1,
      },
    );
    expect(spanOf(s, 'w1')?.cols).toBe(1);
  });

  it('refuses a span that would push a sibling out of the grid', () => {
    const s = store4();
    dispatch(s, items(4), 'resize-x-w1', { dx: 4, point: { x: 100000, y: 100 } });
    // 2x2 has four cells for four items; w1 can reach two columns and no more.
    expect(spanOf(s, 'w1')?.cols).toBe(2);
    expect(run(items(4)).unplaced ?? []).toEqual([]);
  });

  it('never writes a span below one', () => {
    const s = store4();
    dispatch(s, items(4), 'resize-x-w1', { dx: 4, point: { x: -500, y: 100 } });
    expect(spanOf(s, 'w1')?.cols ?? 1).toBe(1);
  });

  it('writes rows on the vertical seam', () => {
    const s = store4();
    dispatch(s, items(4), 'resize-y-w1', { dy: 4, point: { x: 100, y: 380 } });
    expect(spanOf(s, 'w1')?.rows).toBe(2);
  });

  it('is refused by a resize lock, like a pixel size', () => {
    const s = store4();
    s.setLock(asNodeId('w1'), { resize: true });
    expect(() => s.patchPlacement(asNodeId('w1'), { span: { cols: 2 } })).toThrow();
  });
});
