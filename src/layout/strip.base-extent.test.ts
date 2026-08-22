import { describe, expect, it, vi } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const CONTAINER = { w: 600, h: 50 };

function fakeStore() {
  const patchPlacement = vi.fn();
  return {
    patchPlacement,
    getNode: () => ({ membership: { placement: {} } }),
  } as never as { patchPlacement: ReturnType<typeof vi.fn> };
}

/** What `layout` actually puts on screen for `id`. */
function laidOut(items: LayoutItem[], options: Record<string, unknown>, id: string): number {
  const result = stripStrategy.layout({
    items,
    container: CONTAINER,
    state: undefined as never,
    options,
  });
  return result.placements.get(id)?.w ?? 0;
}

function drag(
  store: unknown,
  items: LayoutItem[],
  childId: string,
  dx: number,
  options: Record<string, unknown>,
) {
  stripStrategy.dispatchAffordance?.({
    event: { affordanceId: `resize-x-${childId}`, kind: 'drag', payload: { dx, dy: 0 } },
    affordance: {
      id: `resize-x-${childId}`,
      kind: 'resize-x',
      rect: { x: 0, y: 0, w: 4, h: 50 },
      childId,
    },
    store: store as never,
    parentId: 'root' as never,
    container: CONTAINER,
    options,
    items,
  });
}

function writtenFor(store: { patchPlacement: ReturnType<typeof vi.fn> }, id: string) {
  const call = store.patchPlacement.mock.calls.find((c) => c[0] === id);
  return (call?.[1] as { size: { w: number } } | undefined)?.size.w;
}

/** A seam moves the pane from where it renders. Any gap between the extent
 *  `layout` assigns and the base `dispatchAffordance` adds the delta to is a
 *  jump the user sees on the first drag. */
describe('strip resize starts from the laid-out extent', () => {
  it('with fill off, a hintless pane starts from defaultItemSize, not a share', () => {
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }];
    const options = { axis: 'x' };

    const store = fakeStore();
    drag(store, items, 'a', 50, options);

    expect(writtenFor(store, 'a')).toBe(laidOut(items, options, 'a') + 50);
  });

  it('with fill off and a defaultItemSize, it starts from that size', () => {
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }];
    const options = { axis: 'x', fill: false, defaultItemSize: 80 };

    const store = fakeStore();
    drag(store, items, 'a', 50, options);

    expect(laidOut(items, options, 'a')).toBe(80);
    expect(writtenFor(store, 'a')).toBe(130);
  });

  it('honors preferredSize, which a share ignores', () => {
    const items: LayoutItem[] = [
      { id: 'a', hints: { preferredSize: { w: 100, h: 0 } } },
      { id: 'b' },
    ];
    const options = { axis: 'x', fill: true };

    const store = fakeStore();
    drag(store, items, 'a', 40, options);

    expect(laidOut(items, options, 'a')).toBe(100);
    expect(writtenFor(store, 'a')).toBe(140);
  });

  it("pairs from the laid-out extents under resizeMode 'neighbor'", () => {
    const items: LayoutItem[] = [
      { id: 'a', hints: { preferredSize: { w: 100, h: 0 } } },
      { id: 'b', hints: { preferredSize: { w: 200, h: 0 } } },
      { id: 'c' },
    ];
    const options = { axis: 'x', fill: true, resizeMode: 'neighbor' };

    const store = fakeStore();
    drag(store, items, 'a', 40, options);

    expect(writtenFor(store, 'a')).toBe(140);
    expect(writtenFor(store, 'b')).toBe(160);
  });
});
