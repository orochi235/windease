import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

/** A card the size the duel board deals: portrait, MTG's proportions. */
const card = (id: string, turn?: number, aspect?: number): LayoutItem => ({
  id,
  hints: {
    preferredSize: { w: 86, h: 120 },
    ...(turn === undefined ? {} : { turn }),
    ...(aspect === undefined ? {} : { aspect }),
  },
});

/** A band the height of a card plus its padding, as the story sizes one. */
const band = { w: 660, h: 136 };

const run = (items: LayoutItem[], options: Record<string, unknown> = {}) =>
  stripStrategy.layout({
    items,
    container: band,
    state: undefined,
    options: { axis: 'x', gap: 10, padding: 8, ...options },
  });

const rect = (items: LayoutItem[], options: Record<string, unknown>, id: string) =>
  run(items, options).placements.get(id)!;

describe('strip: cross axis', () => {
  it('stretches every child by default, shape or no shape', () => {
    const r = rect([card('a'), card('b', 90)], {}, 'a');
    expect(r.h).toBe(120);
    expect(r.y).toBe(8);
  });

  it('derives the cross extent from aspect once crossAlign asks it to', () => {
    // 86 wide at 0.716 is 120 tall, which is the whole band — so widen the
    // band and check the card does not grow with it.
    const r = stripStrategy
      .layout({
        items: [card('a', undefined, 86 / 120)],
        container: { w: 660, h: 300 },
        state: undefined,
        options: { axis: 'x', gap: 10, padding: 8, crossAlign: 'center' },
      })
      .placements.get('a')!;
    expect(r.w).toBe(86);
    expect(r.h).toBeCloseTo(120, 1);
    // Centered in the 284 of usable cross extent.
    expect(r.y).toBeCloseTo(8 + (284 - 120) / 2, 1);
  });

  it('never lets a derived extent exceed the row', () => {
    const r = rect([card('a', undefined, 0.2)], { crossAlign: 'center' }, 'a');
    expect(r.h).toBe(120);
  });

  it('puts the slack where crossAlign says', () => {
    const opts = { crossAlign: 'start' as const };
    const tall = { w: 660, h: 300 };
    const at = (align: string) =>
      stripStrategy
        .layout({
          items: [card('a', undefined, 86 / 120)],
          container: tall,
          state: undefined,
          options: { axis: 'x', padding: 8, ...opts, crossAlign: align },
        })
        .placements.get('a')!.y;
    expect(at('start')).toBeCloseTo(8, 1);
    expect(at('end')).toBeCloseTo(8 + 284 - 120, 1);
    expect(at('center')).toBeCloseTo(8 + (284 - 120) / 2, 1);
  });
});

describe('strip: turn', () => {
  it('reserves the swapped box for a quarter-turned card', () => {
    const r = rect([card('a', 90), card('b')], { crossAlign: 'center' }, 'a');
    expect(r.w).toBeCloseTo(120, 1);
    expect(r.h).toBeCloseTo(86, 1);
  });

  it('carries the drawn box on the rect so the adapter can rotate it', () => {
    const r = rect([card('a', 90)], { crossAlign: 'center' }, 'a');
    expect(r.turn).toEqual({ deg: 90, w: 86, h: 120 });
  });

  it('centers the drawn box in the box it reserved', () => {
    const r = rect([card('a', 90)], { crossAlign: 'center' }, 'a');
    // The reserved 120x86 and the drawn 86x120 share a center.
    expect(r.x + r.w / 2).toBeCloseTo(r.x + (r.w - r.turn!.w) / 2 + r.turn!.w / 2, 5);
    expect(r.y + r.h / 2).toBeCloseTo(r.y + (r.h - r.turn!.h) / 2 + r.turn!.h / 2, 5);
  });

  it('pushes its neighbor along by the turned width, not the drawn one', () => {
    const upright = run([card('a'), card('b')], { crossAlign: 'center' });
    const turned = run([card('a', 90), card('b')], { crossAlign: 'center' });
    const moved = turned.placements.get('b')!.x - upright.placements.get('b')!.x;
    expect(moved).toBeCloseTo(120 - 86, 1);
  });

  it('grows the footprint continuously through a turn', () => {
    const widths = [0, 15, 30, 45, 60, 75, 90].map(
      (deg) => rect([card('a', deg)], { crossAlign: 'center' }, 'a').w,
    );
    // Monotonic up to the diagonal, which for 86x120 falls at ~54°, then back.
    expect(widths[0]).toBeCloseTo(86, 1);
    expect(widths.at(-1)).toBeCloseTo(120, 1);
    expect(Math.max(...widths)).toBeGreaterThan(120);
  });

  it('leaves an unturned card with no turn on its rect', () => {
    expect(rect([card('a', 0)], { crossAlign: 'center' }, 'a').turn).toBeUndefined();
    expect(rect([card('a')], { crossAlign: 'center' }, 'a').turn).toBeUndefined();
  });

  it('is inert on a child whose size the row decides', () => {
    const r = rect([{ id: 'a', hints: { turn: 90 } }], { crossAlign: 'center' }, 'a');
    expect(r.turn).toBeUndefined();
  });

  it('turns on the cross axis of a y-strip too', () => {
    const r = stripStrategy
      .layout({
        items: [card('a', 90)],
        container: { w: 300, h: 660 },
        state: undefined,
        options: { axis: 'y', padding: 8, crossAlign: 'center' },
      })
      .placements.get('a')!;
    expect(r.w).toBeCloseTo(120, 1);
    expect(r.h).toBeCloseTo(86, 1);
  });
});
