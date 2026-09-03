import { describe, expect, it, vi } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

function fakeStore(sizes: Record<string, number>) {
  const patchPlacement = vi.fn();
  return {
    patchPlacement,
    getNode: (id: string) => ({ membership: { placement: { size: { w: sizes[id] } } } }),
  } as never as { patchPlacement: ReturnType<typeof vi.fn> };
}

const drag = (
  store: unknown,
  items: unknown[],
  childId: string,
  dx: number,
  options: Record<string, unknown>,
) =>
  stripStrategy.dispatchAffordance?.({
    event: { affordanceId: `resize-x-${childId}`, kind: 'drag', payload: { dx, dy: 0 } },
    affordance: {
      id: `resize-x-${childId}`,
      kind: 'resize-x',
      rect: { x: 0, y: 0, z: 0, w: 4, h: 50 },
      childId,
    },
    store: store as never,
    parentId: 'root' as never,
    container: { w: 600, h: 50 },
    options,
    items: items as LayoutItem[],
  });

const items = () => [
  { id: 'a', placement: { size: { w: 200 } } },
  { id: 'b', placement: { size: { w: 200 } } },
  { id: 'c', placement: { size: { w: 200 } } },
];

describe('stripStrategy resizeMode', () => {
  it('writes only the dragged child by default', () => {
    const store = fakeStore({ a: 200, b: 200, c: 200 });
    drag(store, items(), 'a', 40, { axis: 'x' });
    expect(store.patchPlacement).toHaveBeenCalledTimes(1);
    expect(store.patchPlacement).toHaveBeenCalledWith('a', { size: { w: 240 } });
  });

  it("writes both neighbors under resizeMode 'neighbor'", () => {
    const store = fakeStore({ a: 200, b: 200, c: 200 });
    drag(store, items(), 'a', 40, { axis: 'x', resizeMode: 'neighbor' });
    expect(store.patchPlacement).toHaveBeenCalledTimes(2);
    expect(store.patchPlacement).toHaveBeenCalledWith('a', { size: { w: 240 } });
    // The delta comes out of b alone; c is untouched.
    expect(store.patchPlacement).toHaveBeenCalledWith('b', { size: { w: 160 } });
  });

  it("stops at the neighbor's min instead of spilling past it", () => {
    const store = fakeStore({ a: 200, b: 200, c: 200 });
    const withMin = items().map((it) =>
      it.id === 'b' ? { ...it, hints: { minSize: { w: 180, h: 0 } } } : it,
    );
    drag(store, withMin, 'a', 100, { axis: 'x', resizeMode: 'neighbor' });
    // b can only give up 20 before hitting 180, so a grows by 20, not 100.
    expect(store.patchPlacement).toHaveBeenCalledWith('a', { size: { w: 220 } });
    expect(store.patchPlacement).toHaveBeenCalledWith('b', { size: { w: 180 } });
  });

  it('is a no-op on the last child, which has no following neighbor', () => {
    const store = fakeStore({ a: 200, b: 200, c: 200 });
    drag(store, items(), 'c', 40, { axis: 'x', resizeMode: 'neighbor' });
    expect(store.patchPlacement).not.toHaveBeenCalled();
  });

  it('conserves total extent, unlike the default mode', () => {
    const store = fakeStore({ a: 200, b: 200, c: 200 });
    drag(store, items(), 'b', -50, { axis: 'x', resizeMode: 'neighbor' });
    const written = Object.fromEntries(
      store.patchPlacement.mock.calls.map((c) => [c[0], (c[1] as { size: { w: number } }).size.w]),
    );
    expect(written.b + written.c).toBe(400);
  });
});
