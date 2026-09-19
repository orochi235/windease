import { describe, expect, it, vi } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stackStrategy } from './stack.js';
import { stripStrategy } from './strip.js';

const container = { w: 600, h: 300 };
const items: LayoutItem[] = [
  { id: 'a', placement: { size: { w: 150 } } },
  { id: 'b' },
  { id: 'c', placement: { size: { w: 100 } } },
];

const strip = (options: Record<string, unknown>, over: LayoutItem[] = items) =>
  stripStrategy.layout({ items: over, container, state: undefined, options });
const stack = (options: Record<string, unknown>, over: LayoutItem[] = items) =>
  stackStrategy.layout({ items: over, container, state: undefined, options });

describe('strip zoom', () => {
  it('gives the zoomed child the whole container, inside the padding', () => {
    const r = strip({ zoom: 'b', padding: 5, gap: 4, fill: true });
    expect(r.placements.get('b')).toEqual({ x: 5, y: 5, z: 0, w: 590, h: 290 });
  });

  it('withholds the rest as unplaced, in order', () => {
    const r = strip({ zoom: 'b', fill: true });
    expect([...r.placements.keys()]).toEqual(['b']);
    expect(r.unplaced).toEqual(['a', 'c']);
  });

  it('emits no seams while zoomed', () => {
    expect(strip({ zoom: 'b', fill: true }).affordances).toEqual([]);
  });

  it('fills the cross axis of a vertical strip too', () => {
    expect(strip({ zoom: 'a', axis: 'y' }).placements.get('a')).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: 600,
      h: 300,
    });
  });

  it('reports no overflow while zoomed, whatever the row would', () => {
    const wide = items.map((it) => ({ ...it, placement: { size: { w: 900 } } }));
    expect(strip({ zoom: 'a', overflowMode: 'scroll' }, wide).overflow).toBeUndefined();
  });

  it('lays the row out as before once zoom is cleared', () => {
    const before = strip({ fill: true });
    strip({ zoom: 'b', fill: true });
    expect(strip({ fill: true, zoom: undefined })).toEqual(before);
  });

  it('ignores a zoom naming no child', () => {
    expect(strip({ zoom: 'gone', fill: true })).toEqual(strip({ fill: true }));
  });

  it('refuses a seam drag while zoomed', () => {
    const patchPlacement = vi.fn();
    stripStrategy.dispatchAffordance?.({
      event: { affordanceId: 'resize-x-a', kind: 'drag', payload: { dx: 20, dy: 0 } },
      affordance: {
        id: 'resize-x-a',
        kind: 'resize-x',
        rect: { x: 0, y: 0, z: 0, w: 4, h: 4 },
        childId: 'a',
      },
      store: { patchPlacement, getNode: () => undefined } as never,
      parentId: 'root' as never,
      container,
      options: { zoom: 'b', fill: true },
      items,
    });
    expect(patchPlacement).not.toHaveBeenCalled();
  });

  it('is in the config spec', () => {
    expect(stripStrategy.configSpec?.zoom).toBe('string');
  });
});

describe('stack zoom', () => {
  it('gives the zoomed child the header band as well as the body', () => {
    expect(stack({ zoom: 'c', activeId: 'a', headerSize: 30, padding: 4 }).placements).toEqual(
      new Map([['c', { x: 4, y: 4, z: 0, w: 592, h: 292 }]]),
    );
  });

  it('withholds the rest, the active child included', () => {
    expect(stack({ zoom: 'c', activeId: 'a', headerSize: 30 }).unplaced).toEqual(['a', 'b']);
  });

  it('ignores a zoom naming no child', () => {
    const plain = stack({ activeId: 'b', headerSize: 30 });
    expect(stack({ activeId: 'b', headerSize: 30, zoom: 'gone' })).toEqual(plain);
  });

  it('is in the config spec', () => {
    expect(stackStrategy.configSpec?.zoom).toBe('string');
  });
});
