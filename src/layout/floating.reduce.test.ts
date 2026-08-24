import { describe, expect, it } from 'vitest';
import type { LayoutEvent, LayoutItem } from '../layout-types.js';
import { floatingStrategy, type FloatingState } from './floating.js';

const container = { w: 400, h: 300 };
const panel: LayoutItem = { id: 'legend', meta: { floating: true }, natural: { w: 100, h: 80 } };
const context = { container, options: {}, items: [panel] };

const drag = (dx: number, dy: number): LayoutEvent => ({
  affordanceId: 'floating:drag:legend',
  kind: 'drag',
  payload: { dx, dy },
});

/** State with the panel free at (x, y). */
const at = (x: number, y: number): FloatingState<undefined> => ({
  at: { legend: { x, y, anchor: null } },
  inner: undefined,
});

describe('floatingStrategy.reduce', () => {
  const s = floatingStrategy();

  it('moves the panel by the drag delta', () => {
    expect(s.reduce?.(at(200, 100), drag(10, 20), context).at.legend).toEqual({
      x: 210,
      y: 120,
      anchor: null,
    });
  });

  it('accumulates across events', () => {
    const first = s.reduce?.(at(200, 100), drag(10, 20), context);
    expect(s.reduce?.(first!, drag(-4, 0), context).at.legend).toMatchObject({ x: 206, y: 120 });
  });

  it('snaps when the accumulated position lands within threshold of a corner', () => {
    // 30 - 18 = 12 on each axis: exactly the top-left resting origin.
    expect(s.reduce?.(at(30, 30), drag(-18, -18), context).at.legend?.anchor).toBe('top-left');
  });

  it('keeps accumulating past the corner while snapped, so a slow drag can escape', () => {
    let st = s.reduce?.(at(16, 12), drag(-4, 0), context) as FloatingState<undefined>;
    expect(st.at.legend?.anchor).toBe('top-left');
    for (let i = 0; i < 5; i++) {
      st = s.reduce?.(st, drag(4, 0), context) as FloatingState<undefined>;
    }
    // 20px of travel is past the 12px threshold, so the anchor has let go.
    expect(st.at.legend?.x).toBe(32);
    expect(st.at.legend?.anchor).toBeNull();
  });

  it('clamps the position inside the container', () => {
    expect(s.reduce?.(at(0, 0), drag(-50, -50), context).at.legend).toMatchObject({ x: 0, y: 0 });
  });

  it('never snaps to a corner the item excludes', () => {
    const only = [{ ...panel, meta: { floating: true, snapCorners: ['bottom-right'] } }];
    const next = s.reduce?.(at(30, 30), drag(-18, -18), { ...context, items: only });
    expect(next?.at.legend?.anchor).toBeNull();
  });

  it('holds nothing per-gesture, so state survives a snapshot round trip', () => {
    const next = s.reduce?.(at(200, 100), drag(10, 20), context);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
    expect(Object.keys(next?.at.legend ?? {}).sort()).toEqual(['anchor', 'x', 'y']);
  });

  it('ignores an event that moves nothing', () => {
    const before = at(200, 100);
    expect(s.reduce?.(before, drag(0, 0), context)).toBe(before);
  });

  it('leaves state alone for an affordance it does not own', () => {
    const before = at(200, 100);
    expect(s.reduce?.(before, { ...drag(1, 1), affordanceId: 'other' }, context)).toBe(before);
  });

  it('delegates an unowned affordance to the inner strategy', () => {
    const calls: string[] = [];
    const spy = {
      name: 'spy',
      layout: () => ({ placements: new Map(), affordances: [] }),
      reduce: (inner: number) => {
        calls.push('reduced');
        return inner + 1;
      },
    };
    const wrapped = floatingStrategy(spy);
    const next = wrapped.reduce?.(
      { at: {}, inner: 1 },
      { affordanceId: 'spy:seam', kind: 'drag', payload: { dx: 5 } },
      context,
    );
    expect(calls).toEqual(['reduced']);
    expect(next?.inner).toBe(2);
  });
});
