import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

/** A hand's worth of room: wide enough for four cards, never for seven. */
const CONTAINER = { w: 500, h: 200 };

const run = (items: LayoutItem[], options: Record<string, unknown> = {}) =>
  stripStrategy.layout({
    items,
    container: CONTAINER,
    state: undefined as void,
    options: { axis: 'x', overflowMode: 'overlap', ...options },
  });

/** `n` cards each asking for 120 wide. */
const hand = (n: number, w = 120): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    placement: { size: { w } },
  })) as unknown as LayoutItem[];

const xs = (r: ReturnType<typeof run>) => [...r.placements.values()].map((p) => p.x);
const ws = (r: ReturnType<typeof run>) => [...r.placements.values()].map((p) => p.w);
/** The distance between each card's leading edge and the next one's. */
const steps = (r: ReturnType<typeof run>) => {
  const x = xs(r);
  return x.slice(1).map((v, i) => v - x[i]!);
};

describe('strip overflowMode: overlap', () => {
  it('leaves a row that fits exactly as it was', () => {
    const fits = run(hand(4), { gap: 0 });
    const plain = run(hand(4), { gap: 0, overflowMode: undefined });
    expect(xs(fits)).toEqual(xs(plain));
    expect(fits.overflow).toBeUndefined();
  });

  it('keeps every card at full size and shortens the step instead', () => {
    const r = run(hand(6));
    for (const w of ws(r)) expect(w).toBe(120);
    for (const step of steps(r)) expect(step).toBeLessThan(120);
  });

  it('fills the container exactly once it overlaps', () => {
    const r = run(hand(6));
    const last = [...r.placements.values()].at(-1)!;
    expect(last.x + last.w).toBeCloseTo(CONTAINER.w, 6);
    expect(r.overflow).toBeUndefined();
  });

  it('tightens as the hand grows', () => {
    const five = steps(run(hand(5)))[0]!;
    const nine = steps(run(hand(9)))[0]!;
    expect(nine).toBeLessThan(five);
  });

  it('steps uniformly, so no card is more covered than another', () => {
    const s = steps(run(hand(7)));
    for (const step of s) expect(step).toBeCloseTo(s[0]!, 6);
  });

  it('leaves the last card wholly visible', () => {
    const r = run(hand(8));
    const places = [...r.placements.values()];
    const last = places.at(-1)!;
    const covered = places.slice(0, -1).some((p) => p.x + p.w > last.x + last.w);
    expect(covered).toBe(false);
  });

  it('floors the step at peek and reports what the floor will not absorb', () => {
    const r = run(hand(12), { peek: 40 });
    for (const step of steps(r)) expect(step).toBeCloseTo(40, 6);
    expect(r.overflow?.w).toBeGreaterThan(0);
  });

  it('defaults peek to 24', () => {
    const r = run(hand(40));
    for (const step of steps(r)) expect(step).toBeCloseTo(24, 6);
  });

  it.each([
    ['zero', 0],
    ['negative', -10],
    ['not finite', Number.NaN],
    ['larger than the card it floors', 500],
  ])('reads a peek that is %s as absent', (_name, peek) => {
    const r = run(hand(40), { peek });
    for (const step of steps(r)) expect(step).toBeCloseTo(24, 6);
  });

  it('cannot overlap a lone card', () => {
    const r = run(hand(1, 900));
    expect(ws(r)).toEqual([900]);
    expect(r.overflow?.w).toBeCloseTo(400, 6);
  });

  it('caps by count first, then overlaps what is left', () => {
    const r = run(hand(12), { maxItems: 6 });
    expect(r.placements.size).toBe(6);
    expect(r.unplaced).toHaveLength(6);
    for (const w of ws(r)) expect(w).toBe(120);
  });

  it('overlaps on the y axis too', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i + 1}`,
      placement: { size: { h: 80 } },
    })) as unknown as LayoutItem[];
    const r = stripStrategy.layout({
      items,
      container: { w: 200, h: 200 },
      state: undefined as void,
      options: { axis: 'y', overflowMode: 'overlap' },
    });
    const ys = [...r.placements.values()].map((p) => p.y);
    for (const p of r.placements.values()) expect(p.h).toBe(80);
    expect(ys[1]! - ys[0]!).toBeLessThan(80);
  });

  it('honors padding, overlapping into the padded extent only', () => {
    const r = run(hand(6), { padding: 20 });
    const places = [...r.placements.values()];
    expect(places[0]!.x).toBeCloseTo(20, 6);
    const last = places.at(-1)!;
    expect(last.x + last.w).toBeCloseTo(CONTAINER.w - 20, 6);
  });

  it('does not squeeze, unlike the mode it replaces', () => {
    const squeezed = run(hand(6), { overflowMode: 'squeeze' });
    const overlapped = run(hand(6));
    expect(Math.max(...ws(squeezed))).toBeLessThan(120);
    expect(Math.min(...ws(overlapped))).toBe(120);
  });
});
