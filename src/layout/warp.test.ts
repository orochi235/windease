import { describe, expect, it } from 'vitest';
import { WindeaseError } from '../errors.js';
import type {
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import { bow, mergeChannels, type Pass, type Point, swell, tilt, warp } from './warp.js';

const CONTAINER: Size = { w: 400, h: 200 };

const item = (id: string): LayoutItem => ({ id });

const args = (over: Partial<Parameters<Pass['apply']>[1]> = {}) => ({
  items: [],
  container: CONTAINER,
  state: undefined,
  options: {} as Record<string, unknown>,
  ...over,
});

const rect = (x: number, y: number, w = 0, h = 0): Rect => ({ x, y, z: 0, w, h });

const resultOf = (rects: Record<string, Rect>): LayoutResult<string> => ({
  placements: new Map(Object.entries(rects)),
  affordances: [],
});

/** A stub base strategy placing each item at a fixed rect, recording whatever
 *  `reduce` is handed so a gesture's inverted coordinates can be read back. */
function fixedStrategy(rects: Record<string, Rect>): LayoutStrategy<void, string> & {
  seen: LayoutEvent[];
} {
  const seen: LayoutEvent[] = [];
  return {
    name: 'fixed',
    seen,
    configSpec: { gap: 'number' },
    initialState: () => undefined,
    canAccept: (items) => items.length < 4,
    command: (state) => state,
    layout: () => resultOf(rects),
    reduce: (state, event) => {
      seen.push(event);
      return state;
    },
  };
}

/** Where `pass` sends the table-space point `p`, read off a zero-extent rect. */
function forward(pass: Pass, p: Point, passArgs = args()): Point {
  const out = pass.apply(resultOf({ a: rect(p.x, p.y) }), passArgs);
  const placed = out.placements.get('a');
  if (!placed) throw new Error('unplaced');
  return { x: placed.x, y: placed.y };
}

describe('tilt', () => {
  const camera = { tilt: 1.5, horizon: 0.3 };

  it('tilt: 0 leaves every rect identical and emits no channels', () => {
    const flat = resultOf({ a: rect(10, 20, 30, 40), b: rect(50, 60, 10, 10) });
    const out = tilt({ tilt: 0 }).apply(flat, args());
    expect(out.placements.get('a')).toEqual(rect(10, 20, 30, 40));
    expect(out.placements.get('b')).toEqual(rect(50, 60, 10, 10));
    expect(out.channels).toBeUndefined();
  });

  it('leaves the near edge fixed', () => {
    const sitting = rect(40, CONTAINER.h - 25, 60, 25);
    const out = tilt(camera).apply(resultOf({ a: sitting }), args());
    expect(out.placements.get('a')).toEqual({ ...sitting, z: 0 });
  });

  it('scales monotonically with depth and reports z in 0..1', () => {
    const rows = [0, 50, 100, 160].map((y) => rect(0, y, 100, 40));
    const out = tilt(camera).apply(
      resultOf({
        far: rows[0] as Rect,
        mid: rows[1] as Rect,
        near: rows[2] as Rect,
        edge: rows[3] as Rect,
      }),
      args(),
    );
    const scales = ['far', 'mid', 'near', 'edge'].map((id) => out.channels?.get(id)?.scale ?? 0);
    const depths = ['far', 'mid', 'near', 'edge'].map((id) => out.placements.get(id)?.z ?? -1);
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i] as number).toBeGreaterThan(scales[i - 1] as number);
      expect(depths[i] as number).toBeLessThan(depths[i - 1] as number);
    }
    for (const z of depths) {
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(1);
    }
    expect(depths[3]).toBe(0);
  });

  it('emits keystone as the far-to-near width ratio, never above 1', () => {
    const out = tilt(camera).apply(resultOf({ a: rect(0, 0, 100, 60) }), args());
    const keystone = out.channels?.get('a')?.keystone ?? 0;
    expect(keystone).toBeGreaterThan(0);
    expect(keystone).toBeLessThan(1);
  });

  it('projects affordance rects like any other rect', () => {
    const seam = { id: 's', kind: 'drag-x', rect: rect(10, 0, 4, 100) };
    const out = tilt(camera).apply({ placements: new Map(), affordances: [seam] }, args());
    expect(out.affordances[0]?.rect).not.toEqual(seam.rect);
    expect(out.affordances[0]?.id).toBe('s');
  });

  it('round-trips a grid of points through its inverse', () => {
    const pass = tilt(camera);
    for (const x of [0, 37, 200, 399]) {
      for (const y of [0, 25, 90, 150, 200]) {
        const screen = forward(pass, { x, y });
        const back = pass.invert?.({ x: screen.x, y: screen.y }, args());
        expect(back?.x).toBeCloseTo(x, 6);
        expect(back?.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('reads an out-of-range horizon and a negative tilt as absent', () => {
    const wild = tilt({ tilt: -3, horizon: 1.4 });
    const flat = resultOf({ a: rect(0, 0, 10, 10) });
    expect(wild.apply(flat, args()).placements.get('a')).toEqual(rect(0, 0, 10, 10));
    const viaConfig = tilt({ tilt: 1 }).apply(flat, args({ options: { horizon: 0 } }));
    expect(viaConfig.placements.get('a')).toEqual(
      tilt({ tilt: 1 }).apply(flat, args()).placements.get('a'),
    );
  });

  it('takes container config over the camera it was built with', () => {
    const flat = resultOf({ a: rect(0, 0, 40, 40) });
    const built = tilt({ tilt: 2 }).apply(flat, args());
    const overridden = tilt({ tilt: 2 }).apply(flat, args({ options: { tilt: 0 } }));
    expect(overridden.placements.get('a')).toEqual(rect(0, 0, 40, 40));
    expect(built.placements.get('a')).not.toEqual(rect(0, 0, 40, 40));
  });
});

describe('swell', () => {
  const options = { reach: 120, gain: 1.6, lift: 20 };

  it('is the identity with no pointer', () => {
    const flat = resultOf({ a: rect(0, 0, 40, 40) });
    expect(swell(options).apply(flat, args())).toBe(flat);
  });

  it('is the identity with neither gain nor lift', () => {
    const flat = resultOf({ a: rect(0, 0, 40, 40) });
    expect(swell({ reach: 120 }).apply(flat, args({ pointer: { x: 20, y: 20 } }))).toBe(flat);
  });

  it('peaks under the cursor', () => {
    const run = resultOf({
      a: rect(0, 80, 40, 40),
      b: rect(60, 80, 40, 40),
      c: rect(120, 80, 40, 40),
    });
    const out = swell(options).apply(run, args({ pointer: { x: 80, y: 100 } }));
    const focus = ['a', 'b', 'c'].map((id) => out.channels?.get(id)?.focus ?? 0);
    expect(focus[1] as number).toBeGreaterThan(focus[0] as number);
    expect(focus[1] as number).toBeGreaterThan(focus[2] as number);
    expect(out.placements.get('b')?.w as number).toBeGreaterThan(40);
    expect(out.placements.get('b')?.y as number).toBeLessThan(80);
  });

  it('displaces a symmetric run to a sum of zero', () => {
    const centers = [40, 120, 200, 280, 360];
    const run = resultOf(
      Object.fromEntries(centers.map((c, i) => [`i${i}`, rect(c - 20, 80, 40, 40)])),
    );
    const cursor = 200;
    const out = swell(options).apply(run, args({ pointer: { x: cursor, y: 100 } }));
    let total = 0;
    for (const [id, placed] of out.placements) {
      const before = run.placements.get(id) as Rect;
      total += placed.x + placed.w / 2 - (before.x + before.w / 2);
    }
    expect(total).toBeCloseTo(0, 9);
  });

  it('round-trips a grid of points through its inverse', () => {
    const pass = swell(options);
    for (const cursor of [40, 200, 380]) {
      const passArgs = args({ pointer: { x: cursor, y: 100 } });
      for (const x of [0, 30, 110, 199, 250, 399]) {
        for (const y of [0, 60, 199]) {
          const screen = forward(pass, { x, y }, passArgs);
          const back = pass.invert?.(screen, passArgs);
          expect(back?.x).toBeCloseTo(x, 6);
          expect(back?.y).toBeCloseTo(y, 6);
        }
      }
    }
  });

  it('round-trips on the vertical axis too', () => {
    const pass = swell({ ...options, axis: 'y' });
    const passArgs = args({ pointer: { x: 50, y: 90 } });
    for (const y of [0, 45, 90, 140, 200]) {
      const screen = forward(pass, { x: 50, y }, passArgs);
      const back = pass.invert?.(screen, passArgs);
      expect(back?.y).toBeCloseTo(y, 6);
      expect(back?.x).toBeCloseTo(50, 6);
    }
  });

  it('round-trips with a shrinking gain', () => {
    const pass = swell({ reach: 150, gain: 0.5 });
    const passArgs = args({ pointer: { x: 200, y: 100 } });
    for (const x of [0, 100, 180, 200, 260, 399]) {
      const screen = forward(pass, { x, y: 100 }, passArgs);
      expect(pass.invert?.(screen, passArgs).x).toBeCloseTo(x, 6);
    }
  });

  it('leaves the cursor itself fixed', () => {
    const pass = swell(options);
    const passArgs = args({ pointer: { x: 175, y: 100 } });
    expect(forward(pass, { x: 175, y: 100 }, passArgs).x).toBeCloseTo(175, 9);
  });
});

describe('bow', () => {
  const run = resultOf({
    a: rect(0, 0, 40, 60),
    b: rect(50, 0, 40, 60),
    c: rect(100, 0, 40, 60),
  });

  it('touches no rect and needs no inverse', () => {
    const pass = bow(0.4);
    const out = pass.apply(run, args());
    expect(pass.moves).toBe(false);
    expect(pass.invert).toBeUndefined();
    for (const [id, placed] of out.placements) expect(placed).toEqual(run.placements.get(id));
  });

  it('fans angles symmetrically about the middle of the run', () => {
    const out = bow(0.4).apply(run, args());
    const angles = ['a', 'b', 'c'].map((id) => out.channels?.get(id)?.angle ?? Number.NaN);
    expect(angles[0] as number).toBeLessThan(0);
    expect(angles[1]).toBeCloseTo(0, 9);
    expect(angles[2] as number).toBeGreaterThan(0);
    expect((angles[0] as number) + (angles[2] as number)).toBeCloseTo(0, 9);
  });

  it('bends further with a larger amount', () => {
    const gentle = bow(0.2).apply(run, args()).channels?.get('c')?.angle ?? 0;
    const sharp = bow(0.8).apply(run, args()).channels?.get('c')?.angle ?? 0;
    expect(sharp).toBeGreaterThan(gentle);
  });

  it('is the identity at amount 0, on an empty run and on a single child', () => {
    expect(bow(0).apply(run, args()).channels).toBeUndefined();
    expect(bow(0.4).apply(resultOf({}), args()).channels).toBeUndefined();
    expect(bow(0.4).apply(resultOf({ a: rect(0, 0, 10, 10) }), args()).channels).toBeUndefined();
  });
});

describe('channels', () => {
  it('merges rather than clobbers when two passes write for the same id', () => {
    const run = resultOf({ a: rect(0, 80, 40, 40), b: rect(60, 80, 40, 40) });
    const bowed = bow(0.4).apply(run, args());
    const swelled = swell({ reach: 200, gain: 1.5 }).apply(
      bowed,
      args({ pointer: { x: 20, y: 100 } }),
    );
    const a = swelled.channels?.get('a');
    expect(a?.angle).toBeLessThan(0);
    expect(a?.focus).toBeGreaterThan(0);
  });

  it('mergeChannels leaves its inputs alone', () => {
    const base = new Map([['a', { angle: 4 }]]);
    const merged = mergeChannels(base, new Map([['a', { focus: 1 }]]));
    expect(merged.get('a')).toEqual({ angle: 4, focus: 1 });
    expect(base.get('a')).toEqual({ angle: 4 });
  });
});

describe('warp', () => {
  it('refuses a pass that moves rects without an inverse', () => {
    const lopsided: Pass = { name: 'shove', moves: true, apply: (r) => r };
    expect(() => warp(fixedStrategy({}), [lopsided])).toThrow(WindeaseError);
    expect(() => warp(fixedStrategy({}), [lopsided])).toThrow(/shove/);
  });

  it('accepts a pass that moves nothing and omits an inverse', () => {
    expect(() => warp(fixedStrategy({}), [bow(0.4)])).not.toThrow();
  });

  it('names itself for the base and its passes, and merges configSpec', () => {
    const composed = warp(fixedStrategy({}), [bow(0.4), tilt({ tilt: 1 })]);
    expect(composed.name).toBe('warp(fixed, bow, tilt)');
    expect(composed.configSpec?.gap).toBe('number');
    expect(composed.configSpec?.bow).toBe('number');
    expect(composed.configSpec?.horizon).toBe('number');
  });

  it('forwards initialState, canAccept and command', () => {
    const composed = warp(fixedStrategy({}), [tilt({ tilt: 1 })]);
    expect(composed.initialState?.([], {})).toBeUndefined();
    expect(composed.canAccept?.([item('a')], {})).toBe(true);
    expect(composed.canAccept?.([item('a'), item('b'), item('c'), item('d')], {})).toBe(false);
    expect(
      composed.command?.(undefined, { type: 'noop' }, { ...args(), items: [] }),
    ).toBeUndefined();
  });

  it('reports what a moving pass pushed past the container as overflow', () => {
    // Two rects filling the row exactly, so the base strategy reports nothing.
    const base = fixedStrategy({ a: rect(0, 0, 200, 40), b: rect(200, 0, 200, 40) });
    const composed = warp(base, [swell({ reach: 100, gain: 2 })]);
    const flat = composed.layout({
      items: [],
      container: CONTAINER,
      state: undefined,
      options: {},
    });
    expect(flat.overflow).toBeUndefined();

    const swelled = composed.layout({
      items: [],
      container: CONTAINER,
      state: undefined,
      options: {},
      pointer: { x: 200, y: 20 },
    });
    // The run parts around the cursor: past the right edge, and to the left of
    // the origin, which a host can only reach by moving it.
    expect(swelled.overflow?.w).toBeGreaterThan(0);
    expect(swelled.overflow?.left).toBeGreaterThan(0);
  });

  it('keeps the overflow the base reported when no pass adds to it', () => {
    const base = fixedStrategy({ a: rect(0, 0, 100, 40) });
    const withOverflow: LayoutStrategy<void, string> = {
      ...base,
      layout: (input) => ({ ...base.layout(input), overflow: { w: 500, h: 0 } }),
    };
    const composed = warp(withOverflow, [bow(0.4)]);
    const out = composed.layout({ items: [], container: CONTAINER, state: undefined, options: {} });
    expect(out.overflow?.w).toBe(500);
  });

  it('runs passes in order over the base result', () => {
    const base = fixedStrategy({ a: rect(0, 0, 100, 40), b: rect(0, 160, 100, 40) });
    const composed = warp(base, [tilt({ tilt: 1.5 })]);
    const out = composed.layout({ items: [], container: CONTAINER, state: undefined, options: {} });
    expect(out.placements.get('b')).toEqual(rect(0, 160, 100, 40));
    expect((out.placements.get('a') as Rect).w).toBeLessThan(100);
    expect(out.channels?.get('a')?.scale).toBeLessThan(1);
  });

  it('hands the base strategy table space for a screen-space drag, at three depths', () => {
    const base = fixedStrategy({});
    const camera = { tilt: 1.8, horizon: 0.2 };
    const composed = warp(base, [tilt(camera)]);
    const pass = tilt(camera);
    for (const depth of [0, 100, 195]) {
      const table = { x: 260, y: depth };
      const screen = forward(pass, table);
      composed.reduce?.(
        undefined,
        {
          affordanceId: 's',
          kind: 'drag',
          payload: { point: screen, dx: 0, dy: 0 },
        },
        { container: CONTAINER, options: {}, items: [] },
      );
      const seen = base.seen[base.seen.length - 1];
      expect(seen?.payload.point?.x).toBeCloseTo(table.x, 6);
      expect(seen?.payload.point?.y).toBeCloseTo(table.y, 6);
    }
  });

  it('inverts a delta as the difference between the pointer’s two positions', () => {
    const base = fixedStrategy({});
    const camera = { tilt: 1.8, horizon: 0.2 };
    const composed = warp(base, [tilt(camera)]);
    const pass = tilt(camera);
    const from = { x: 100, y: 40 };
    const to = { x: 160, y: 120 };
    const screenFrom = forward(pass, from);
    const screenTo = forward(pass, to);
    composed.reduce?.(
      undefined,
      {
        affordanceId: 's',
        kind: 'drag',
        payload: {
          point: screenTo,
          dx: screenTo.x - screenFrom.x,
          dy: screenTo.y - screenFrom.y,
        },
      },
      { container: CONTAINER, options: {}, items: [] },
    );
    const seen = base.seen[0];
    expect(seen?.payload.dx).toBeCloseTo(to.x - from.x, 6);
    expect(seen?.payload.dy).toBeCloseTo(to.y - from.y, 6);
  });

  it('passes a pointless event through untouched', () => {
    const base = fixedStrategy({});
    const composed = warp(base, [tilt({ tilt: 1.8 })]);
    const event: LayoutEvent = { affordanceId: 's', kind: 'drag', payload: { dx: 12 } };
    composed.reduce?.(undefined, event, { container: CONTAINER, options: {}, items: [] });
    expect(base.seen[0]).toBe(event);
  });

  it('carries the pointer back into each pass’s own space', () => {
    const base = fixedStrategy({ a: rect(180, 100, 40, 40) });
    const camera = { tilt: 1.5, horizon: 0.25 };
    const composed = warp(base, [swell({ reach: 200, gain: 2 }), tilt(camera)]);
    const table = { x: 200, y: 100 };
    const screen = forward(tilt(camera), table);
    const out = composed.layout({
      items: [item('a')],
      container: CONTAINER,
      state: undefined,
      options: {},
      pointer: screen,
    });
    // The child is centered on the table-space cursor, so swell must have seen
    // the pointer un-projected: full focus, not a fraction of it.
    expect(out.channels?.get('a')?.focus).toBeCloseTo(1, 6);
  });

  it('is the identity over an empty run', () => {
    const composed = warp(fixedStrategy({}), [bow(0.4), swell({ gain: 2 }), tilt({ tilt: 1 })]);
    const out = composed.layout({
      items: [],
      container: CONTAINER,
      state: undefined,
      options: {},
      pointer: { x: 10, y: 10 },
    });
    expect(out.placements.size).toBe(0);
    expect(out.affordances).toEqual([]);
  });
});
