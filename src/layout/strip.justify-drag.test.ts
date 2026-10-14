import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const W = 600;

function run(items: LayoutItem[], options: Record<string, unknown>) {
  return stripStrategy.layout({
    items,
    container: { w: W, h: 50 },
    state: undefined as void,
    options,
  });
}

/** Drags the seam after `childId` by `dx`, stores what the strategy writes, and
 *  lays the row out again. */
function dragSeam(
  items: LayoutItem[],
  childId: string,
  dx: number,
  options: Record<string, unknown>,
) {
  const before = run(items, options);
  const seam = before.affordances.find((a) => a.id === `resize-x-${childId}`)!;
  const next = items.map((it) => ({ ...it, placement: { ...it.placement } }));
  const placementOf = (id: string) => next.find((it) => it.id === id)!.placement;
  const store = {
    getNode: (id: string) => ({ membership: { placement: placementOf(id) } }),
    patchPlacement: (id: string, patch: Record<string, unknown>) => {
      Object.assign(placementOf(id), patch);
    },
  };
  stripStrategy.dispatchAffordance?.({
    event: { affordanceId: seam.id, kind: 'drag', payload: { dx, dy: 0 } },
    affordance: seam,
    store: store as never,
    parentId: 'root' as never,
    container: { w: W, h: 50 },
    options,
    items,
  });
  const after = run(next, options);
  const moved = after.affordances.find((a) => a.id === seam.id)!;
  return {
    travel: moved.rect.x - seam.rect.x,
    widths: Object.fromEntries([...after.placements].map(([id, r]) => [id, r.w])),
    starts: Object.fromEntries([...after.placements].map(([id, r]) => [id, r.x])),
    seam,
    moved,
    items: next,
  };
}

const sized = (id: string, w: number, hints?: LayoutItem['hints']): LayoutItem => ({
  id,
  placement: { size: { w } },
  ...(hints ? { hints } : {}),
});
const pref = (id: string, w: number): LayoutItem => ({ id, hints: { preferredSize: { w, h: 0 } } });

const two = () => [sized('a', 100), sized('b', 100)];

describe('stripStrategy seam drag in a row with room to spare', () => {
  it.each(['start', 'center', 'end'] as const)('%s: the seam travels the drag', (justify) => {
    for (const make of [two, () => [pref('a', 100), pref('b', 100)]]) {
      expect(dragSeam(make(), 'a', 40, { justify }).travel).toBeCloseTo(40, 9);
      expect(dragSeam(make(), 'a', -40, { justify }).travel).toBeCloseTo(-40, 9);
    }
  });

  it('start: a pane sized by preferredSize holds when its neighbor is dragged', () => {
    const r = dragSeam([pref('a', 100), pref('b', 100)], 'a', 40, {});
    expect(r.widths).toEqual({ a: 140, b: 100 });
  });

  it('center: the pane grows on both sides while the row has room', () => {
    const r = dragSeam(two(), 'a', 40, { justify: 'center' });
    expect(r.widths).toEqual({ a: 180, b: 100 });
    expect(r.starts).toEqual({ a: 160, b: 340 });
  });

  it('center: growth past the free space goes one for one', () => {
    // 100px free: the first 50 of travel costs 100 of growth, the rest 1:1.
    const r = dragSeam([sized('a', 250), sized('b', 250)], 'a', 80, { justify: 'center' });
    expect(r.travel).toBeCloseTo(80, 9);
    expect(r.widths.a).toBeCloseTo(380, 9);
  });

  it('start: growth past the free space comes out of the pane after', () => {
    const r = dragSeam([sized('a', 250), sized('b', 250)], 'a', 130, {});
    expect(r.travel).toBeCloseTo(130, 9);
    expect(r.widths).toEqual({ a: 380, b: 220 });
  });

  it("center: stops at the pane's cap", () => {
    const capped = [sized('a', 100, { maxSize: { w: 120, h: 0 } }), sized('b', 100)];
    expect(dragSeam(capped, 'a', 40, { justify: 'center' }).widths.a).toBe(120);
  });

  it('end: the seam resizes the pane after it', () => {
    const r = dragSeam(two(), 'a', 40, { justify: 'end' });
    expect(r.widths).toEqual({ a: 100, b: 60 });
    expect(r.starts).toEqual({ a: 440, b: 540 });
    expect(r.seam.affects).toEqual(['b']);
  });

  it("end: stops at the following pane's floor", () => {
    const floored = [sized('a', 100), sized('b', 100, { minSize: { w: 80, h: 0 } })];
    const r = dragSeam(floored, 'a', 40, { justify: 'end' });
    expect(r.widths.b).toBe(80);
    expect(r.travel).toBeCloseTo(20, 9);
  });

  it('end: the following pane grows no further than the free space', () => {
    const r = dragSeam([sized('a', 250), sized('b', 250)], 'a', -160, { justify: 'end' });
    expect(r.widths).toEqual({ a: 250, b: 350 });
    expect(r.travel).toBeCloseTo(-100, 9);
  });

  it("end: the seam's bounds are its offset along the row, so a delta of one moves it one", () => {
    const floored = [sized('a', 100), sized('b', 100, { minSize: { w: 80, h: 0 } })];
    const { seam } = dragSeam(floored, 'a', 0, { justify: 'end' });
    expect(seam.bounds).toMatchObject({ valueNow: 500, valueMin: 100, valueMax: 520 });
    const home = seam.bounds!.valueMin - seam.bounds!.valueNow;
    expect(dragSeam(floored, 'a', home, { justify: 'end' }).moved.bounds?.atMin).toBe(false);
  });

  it('end: a full row goes back to resizing the pane before the seam', () => {
    const full = [sized('a', 300), sized('b', 300)];
    const { seam } = dragSeam(full, 'a', 0, { justify: 'end' });
    expect(seam.affects).toEqual(['a']);
    expect(seam.bounds?.valueNow).toBe(300);
  });

  it("end: 'neighbor' still trades between the two panes", () => {
    const r = dragSeam(two(), 'a', 40, { justify: 'end', resizeMode: 'neighbor' });
    expect(r.widths).toEqual({ a: 140, b: 60 });
    expect(r.travel).toBeCloseTo(40, 9);
  });

  it('end: lands on whole steps', () => {
    const r = dragSeam(two(), 'a', 37, { justify: 'end', step: 20 });
    expect(r.widths.b).toBe(60);
  });
});
