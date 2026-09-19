import { describe, expect, it } from 'vitest';
import type { Affordance, LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const W = 305;
const run = (items: LayoutItem[], options: Record<string, unknown>, w = W) =>
  stripStrategy.layout({ items, container: { w, h: 50 }, state: undefined, options });
const widths = (items: LayoutItem[], options: Record<string, unknown>, w = W) =>
  Object.fromEntries([...run(items, options, w).placements].map(([id, r]) => [id, r.w]));
const seam = (items: LayoutItem[], options: Record<string, unknown>, after: string, w = W) =>
  run(items, options, w).affordances.find((a) => a.childId === after) as Affordance;

/** A store that records what a drag writes and serves it back. */
function recordingStore(items: LayoutItem[]) {
  const placement = new Map<string, Record<string, unknown>>(
    items.map((it) => [it.id, { ...(it.placement ?? {}) }]),
  );
  return {
    placement,
    getNode: (id: string) => ({ membership: { placement: placement.get(id) ?? {} } }),
    patchPlacement: (id: string, patch: Record<string, unknown>) => {
      placement.set(id, { ...placement.get(id), ...patch });
    },
  };
}

function drag(
  items: LayoutItem[],
  options: Record<string, unknown>,
  after: string,
  payload: { dx?: number; point?: { x: number; y: number } },
  w = W,
): LayoutItem[] {
  const store = recordingStore(items);
  stripStrategy.dispatchAffordance?.({
    event: { affordanceId: `resize-x-${after}`, kind: 'drag', payload: { dy: 0, ...payload } },
    affordance: seam(items, options, after, w),
    store: store as never,
    parentId: 'root' as never,
    container: { w, h: 50 },
    options,
    items,
  });
  return items.map((it) => ({
    ...it,
    placement: store.placement.get(it.id) as NonNullable<LayoutItem['placement']>,
  }));
}

const sized = (id: string, w: number, min?: number): LayoutItem => ({
  id,
  placement: { size: { w } },
  ...(min !== undefined ? { hints: { minSize: { w: min, h: 0 } } } : {}),
});

describe('strip step: pane sizes', () => {
  it('rounds fill panes to the step and gives the last fill pane the remainder', () => {
    expect(widths([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { step: 10, fill: true })).toEqual({
      a: 100,
      b: 100,
      c: 105,
    });
  });

  it('gives the remainder to the last fill pane, not the last pane', () => {
    const w = widths([{ id: 'a' }, { id: 'b' }, sized('c', 64)], { step: 10, fill: true });
    expect(w.c).toBe(60);
    expect(w.a).toBe(120);
    expect(w.b).toBe(125);
  });

  it('gives the remainder to the last pane when every pane states pixels', () => {
    expect(widths([sized('a', 101), sized('b', 101), sized('c', 103)], { step: 10 })).toEqual({
      a: 100,
      b: 100,
      c: 105,
    });
  });

  it('still fills the row exactly', () => {
    const r = run([{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
      step: 8,
      fill: true,
      gap: 3,
      padding: 5,
    });
    const rects = [...r.placements.values()];
    const last = rects[rects.length - 1]!;
    expect(last.x + last.w).toBeCloseTo(W - 5, 9);
    expect(r.overflow).toBeUndefined();
  });

  it('rounds a pane up to a step at or above its floor rather than under it', () => {
    const w = widths([sized('a', 22, 22), { id: 'b' }], { step: 10, fill: true });
    expect(w.a).toBe(30);
  });

  it('keeps a pane stored under its floor where it was put', () => {
    expect(widths([sized('a', 12, 40), { id: 'b' }], { step: 10, fill: true }).a).toBe(10);
  });

  it('ignores a step that is not a positive number', () => {
    for (const step of [0, -5, Number.NaN]) {
      expect(widths([sized('a', 101), { id: 'b' }], { step, fill: true }).a).toBe(101);
    }
  });

  it('changes nothing without a step', () => {
    expect(widths([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { fill: true }).a).toBeCloseTo(
      305 / 3,
      9,
    );
  });
});

describe('strip step: seam bounds', () => {
  it('advertises the step as the keyboard increment', () => {
    const s = seam([{ id: 'a' }, { id: 'b' }], { step: 10, fill: true }, 'a', 300);
    expect(s.bounds?.step).toBe(10);
  });

  it('snaps the range inward to whole steps', () => {
    const items = [sized('a', 150, 25), sized('b', 150, 33)];
    const s = seam(items, { step: 10, resizeMode: 'neighbor' }, 'a', 300);
    expect(s.bounds).toMatchObject({ valueNow: 150, valueMin: 30, valueMax: 260 });
  });

  it('reports the snapped end as reached', () => {
    const items = [sized('a', 260, 25), sized('b', 40, 33)];
    const s = seam(items, { step: 10, resizeMode: 'neighbor' }, 'a', 300);
    expect(s.bounds).toMatchObject({ valueMax: 260, atMax: true });
  });
});

describe('strip step: seam drags', () => {
  const pair = () => [sized('a', 150, 20), sized('b', 150, 20)];
  const neighbor = { step: 10, resizeMode: 'neighbor' };

  it('snaps a pointer drag to the step nearest the pointer', () => {
    const out = drag(pair(), neighbor, 'a', { dx: 1, point: { x: 173, y: 10 } }, 300);
    expect(widths(out, neighbor, 300)).toEqual({ a: 170, b: 130 });
  });

  it('resolves against the pointer, so small moves accumulate', () => {
    let rows = pair();
    for (const x of [151, 153, 155, 157]) {
      rows = drag(rows, neighbor, 'a', { dx: 2, point: { x, y: 10 } }, 300);
    }
    expect(widths(rows, neighbor, 300).a).toBe(160);
  });

  it('measures the pointer from where the pane starts', () => {
    const cfg = { ...neighbor, padding: 10, gap: 10 };
    const rows = [sized('a', 80), sized('b', 80), sized('c', 80)];
    // b starts at 10 + 80 + 10 = 100.
    const out = drag(rows, cfg, 'b', { dx: 1, point: { x: 201, y: 10 } }, 300);
    expect(widths(out, cfg, 300)).toMatchObject({ a: 80, b: 100, c: 60 });
  });

  it('moves a keyboard step by exactly one step', () => {
    const out = drag(pair(), neighbor, 'a', { dx: 10 }, 300);
    expect(widths(out, neighbor, 300)).toEqual({ a: 160, b: 140 });
  });

  it('stops at the last whole step before the neighbor floor', () => {
    const rows = [sized('a', 150, 20), sized('b', 150, 45)];
    const out = drag(rows, neighbor, 'a', { dx: 500, point: { x: 400, y: 10 } }, 300);
    expect(widths(out, neighbor, 300)).toEqual({ a: 250, b: 50 });
  });

  it('snaps a redistribute drag and lets the fill panes absorb it', () => {
    const cfg = { step: 10, fill: true };
    const rows: LayoutItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = drag(rows, cfg, 'a', { dx: 1, point: { x: 128, y: 10 } }, 300);
    const w = widths(out, cfg, 300);
    expect(w.a).toBe(130);
    expect((w.b ?? 0) + (w.c ?? 0)).toBe(170);
    expect((w.b ?? 0) % 10).toBe(0);
  });
});
