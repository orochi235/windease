import { describe, expect, it } from 'vitest';
import type { LayoutPreview, LayoutStrategy, Rect } from '../layout-types.js';
import { splitPreviewPlacements } from './split-preview.js';
import { stripStrategy } from './strip.js';

const strip = stripStrategy as unknown as LayoutStrategy<never, string, unknown>;
const slot: Rect = { x: 100, y: 40, w: 300, h: 200 };
const split = (over: Partial<NonNullable<LayoutPreview['split']>> = {}) => ({
  ontoId: 'b',
  edge: 'start' as const,
  axis: 'y' as const,
  ...over,
});

describe('splitPreviewPlacements', () => {
  it('halves the slot on the split axis and offsets by its origin', () => {
    const out = splitPreviewPlacements(slot, 'd', split(), strip);
    expect(out?.get('d')).toEqual({ x: 100, y: 40, w: 300, h: 100 });
    expect(out?.get('b')).toEqual({ x: 100, y: 140, w: 300, h: 100 });
  });

  it("puts the source second on edge 'end'", () => {
    const out = splitPreviewPlacements(slot, 'd', split({ edge: 'end' }), strip);
    expect(out?.get('b')).toEqual({ x: 100, y: 40, w: 300, h: 100 });
    expect(out?.get('d')).toEqual({ x: 100, y: 140, w: 300, h: 100 });
  });

  it('splits across the x axis when the intent says so', () => {
    const out = splitPreviewPlacements(slot, 'd', split({ axis: 'x' }), strip);
    expect(out?.get('d')).toEqual({ x: 100, y: 40, w: 150, h: 200 });
    expect(out?.get('b')).toEqual({ x: 250, y: 40, w: 150, h: 200 });
  });

  it('honors the prospective group config, so the preview matches the commit', () => {
    const out = splitPreviewPlacements(slot, 'd', split({ config: { gap: 10 } }), strip);
    expect(out?.get('d')).toEqual({ x: 100, y: 40, w: 300, h: 95 });
    expect(out?.get('b')).toEqual({ x: 100, y: 145, w: 300, h: 95 });
  });

  it('places both children even when the slot is too small to halve cleanly', () => {
    const out = splitPreviewPlacements({ x: 0, y: 0, w: 10, h: 3 }, 'd', split(), strip);
    expect(out?.size).toBe(2);
  });

  it('returns null when the strategy places neither child', () => {
    const placesNothing: LayoutStrategy<never, string, unknown> = {
      name: 'nothing',
      layout: () => ({ placements: new Map(), affordances: [] }),
    };
    expect(splitPreviewPlacements(slot, 'd', split(), placesNothing)).toBeNull();
  });

  it('reports only placements — the seam is not draggable until the group exists', () => {
    const out = splitPreviewPlacements(slot, 'd', split(), strip);
    expect(out && [...out.keys()].sort()).toEqual(['b', 'd']);
  });
});
