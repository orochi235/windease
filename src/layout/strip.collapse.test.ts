import { describe, expect, it, vi } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const CONTAINER = { w: 620, h: 100 };

const layout = (items: LayoutItem[], options: Record<string, unknown> = {}) =>
  stripStrategy.layout({
    items,
    container: CONTAINER,
    state: undefined,
    options: { axis: 'x', fill: true, gap: 10, ...options },
  });

const widths = (items: LayoutItem[], options?: Record<string, unknown>) => {
  const { placements } = layout(items, options);
  return items.map((it) => placements.get(it.id)?.w);
};

function fakeStore() {
  const patchPlacement = vi.fn();
  return {
    patchPlacement,
    getNode: () => ({ membership: { placement: {} } }),
  } as never as { patchPlacement: ReturnType<typeof vi.fn> };
}

const drag = (
  store: unknown,
  items: LayoutItem[],
  childId: string,
  dx: number,
  options: Record<string, unknown>,
) =>
  stripStrategy.dispatchAffordance?.({
    event: { affordanceId: `resize-x-${childId}`, kind: 'drag', payload: { dx, dy: 0 } },
    affordance: {
      id: `resize-x-${childId}`,
      kind: 'resize-x',
      rect: { x: 0, y: 0, z: 0, w: 4, h: 100 },
      childId,
    },
    store: store as never,
    parentId: 'root' as never,
    container: CONTAINER,
    options: { axis: 'x', fill: true, gap: 10, ...options },
    items,
  });

describe('stripStrategy with a collapsed child', () => {
  it('lays the row out as if a child collapsed to zero were not in it', () => {
    const side: LayoutItem = {
      id: 'side',
      collapse: { extent: 0 },
      placement: { size: { w: 240 } },
      hints: { minSize: { w: 120, h: 0 } },
    };
    // Two panes and one gap, not three panes and two.
    expect(widths([side, { id: 'a' }, { id: 'b' }])).toEqual([0, 305, 305]);
    expect(widths([{ id: 'a' }, { id: 'b' }])).toEqual([305, 305]);
  });

  it('places a child collapsed to zero where it sits in the row', () => {
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'side', collapse: { extent: 0 } }, { id: 'b' }];
    const { placements } = layout(items);
    expect(placements.get('side')).toMatchObject({ x: 315, w: 0, h: 100 });
    const last = layout([{ id: 'a' }, { id: 'b' }, { id: 'side', collapse: { extent: 0 } }]);
    expect(last.placements.get('side')).toMatchObject({ x: 620, w: 0 });
  });

  it('holds a rail at its extent over a stored size, a floor and a ceiling', () => {
    const side: LayoutItem = {
      id: 'side',
      collapse: { extent: 24 },
      placement: { size: { w: 240 }, share: 0.5 },
      hints: { minSize: { w: 120, h: 0 }, maxSize: { w: 20, h: 1000 } },
    };
    expect(widths([side, { id: 'a' }])).toEqual([24, 586]);
  });

  it('leaves siblings sized by preferredSize sized that way', () => {
    const items: LayoutItem[] = [
      { id: 'side', collapse: { extent: 24 } },
      { id: 'a', hints: { preferredSize: { w: 100, h: 0 } } },
      { id: 'b', hints: { preferredSize: { w: 150, h: 0 } } },
    ];
    expect(widths(items, { fill: false })).toEqual([24, 100, 150]);
  });

  it('holds a rail at its extent when the row is squeezed', () => {
    const items: LayoutItem[] = [
      { id: 'side', collapse: { extent: 24 } },
      { id: 'a', placement: { size: { w: 600 } } },
      { id: 'b', placement: { size: { w: 600 } } },
    ];
    expect(widths(items)).toEqual([24, 288, 288]);
  });

  it('draws no seam on a collapsed child or against one', () => {
    const items: LayoutItem[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'rail', collapse: { extent: 24 } },
      { id: 'c' },
      { id: 'shut', collapse: { extent: 0 } },
      { id: 'd' },
    ];
    const seams = layout(items).affordances.map((a) => a.childId);
    // a|b is the only pair with no collapsed pane on either side, plus c|d,
    // which are neighbors once `shut` is out of the row.
    expect(seams).toEqual(['a', 'c']);
  });

  it('never stores a size on a collapsed child', () => {
    const items: LayoutItem[] = [
      { id: 'a', placement: { size: { w: 400 } } },
      { id: 'b', placement: { size: { w: 400 } } },
      { id: 'rail', collapse: { extent: 24 }, placement: { size: { w: 240 } } },
    ];
    const store = fakeStore();
    // The row is squeezed, so nothing absorbs the delta and it is shared out
    // among every other pane, the rail included.
    drag(store, items, 'a', 40, {});
    const written = store.patchPlacement.mock.calls.map((c) => c[0]);
    expect(written).toEqual(['a', 'b']);
  });

  it('refuses a drag on a collapsed child, and on its neighbor in neighbor mode', () => {
    const items: LayoutItem[] = [
      { id: 'a', placement: { size: { w: 200 } } },
      { id: 'rail', collapse: { extent: 24 } },
      { id: 'b' },
    ];
    const store = fakeStore();
    drag(store, items, 'rail', 40, {});
    drag(store, items, 'a', 40, { resizeMode: 'neighbor' });
    expect(store.patchPlacement).not.toHaveBeenCalled();
  });

  it('marks the rect of every collapsed child, and no other', () => {
    const items: LayoutItem[] = [
      { id: 'a' },
      { id: 'rail', collapse: { extent: 24 } },
      { id: 'shut', collapse: { extent: 0 } },
    ];
    const { placements } = layout(items);
    expect(items.map((it) => placements.get(it.id)?.collapsed)).toEqual([undefined, true, true]);
  });

  it('ignores an extent that is not a usable number', () => {
    const side = { id: 'side', collapse: { extent: Number.NaN } } as LayoutItem;
    expect(widths([side, { id: 'a' }])).toEqual([305, 305]);
  });
});
