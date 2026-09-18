import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const pref = (id: string, w: number): LayoutItem => ({
  id,
  hints: { preferredSize: { w, h: w } },
});

function run(items: LayoutItem[], options: Record<string, unknown>, w = 600, h = 600) {
  return stripStrategy.layout({
    items,
    container: { w, h },
    state: undefined as void,
    options,
  });
}

const starts = (items: LayoutItem[], options: Record<string, unknown>, w = 600) =>
  Object.fromEntries([...run(items, options, w).placements].map(([id, r]) => [id, r.x]));

describe('stripStrategy justify', () => {
  const two = () => [pref('a', 100), pref('b', 100)];

  it("defaults to 'start', packing the panes at the leading edge", () => {
    expect(starts(two(), {})).toEqual({ a: 0, b: 100 });
    expect(starts(two(), { justify: 'start' })).toEqual({ a: 0, b: 100 });
  });

  it("'center' splits the leftover space either side of the panes", () => {
    expect(starts(two(), { justify: 'center' })).toEqual({ a: 200, b: 300 });
  });

  it("'end' puts the leftover space before the panes", () => {
    expect(starts(two(), { justify: 'end' })).toEqual({ a: 400, b: 500 });
  });

  it("'between' spreads the leftover space into the gaps", () => {
    expect(starts([...two(), pref('c', 100)], { justify: 'between' })).toEqual({
      a: 0,
      b: 250,
      c: 500,
    });
  });

  it("'between' leaves a single pane at the start", () => {
    expect(starts([pref('a', 100)], { justify: 'between' })).toEqual({ a: 0 });
  });

  it('works inside padding and on top of gap', () => {
    const opts = { gap: 10, padding: 10 };
    expect(starts(two(), { ...opts, justify: 'between' })).toEqual({ a: 10, b: 490 });
    expect(starts(two(), { ...opts, justify: 'end' })).toEqual({ a: 380, b: 490 });
    expect(starts(two(), { ...opts, justify: 'center' })).toEqual({ a: 195, b: 305 });
  });

  it('places fill panes held at their cap, as with three browser tabs at 225px', () => {
    const tab = (id: string): LayoutItem => ({ id, hints: { maxSize: { w: 225, h: 40 } } });
    const tabs = [tab('a'), tab('b'), tab('c')];
    const center = starts(tabs, { fill: true, justify: 'center' }, 1000);
    expect(center).toEqual({ a: 162.5, b: 387.5, c: 612.5 });
  });

  it('does nothing when the panes fill the row', () => {
    const row = [{ id: 'a' }, { id: 'b' }];
    expect(starts(row, { fill: true, justify: 'end' })).toEqual({ a: 0, b: 300 });
  });

  it('does nothing when the panes overflow the row', () => {
    const row = [pref('a', 400), pref('b', 400)];
    expect(starts(row, { justify: 'center' })).toEqual({ a: 0, b: 400 });
  });

  it("keeps each seam on its pane's trailing edge", () => {
    const between = run(two(), { justify: 'between' });
    expect(between.affordances.find((a) => a.id === 'resize-x-a')?.rect.x).toBe(100 - 2);
    const centered = run(two(), { justify: 'center' });
    expect(centered.affordances.find((a) => a.id === 'resize-x-a')?.rect.x).toBe(300 - 2);
  });

  it('places along y on a y strip', () => {
    const r = run(two(), { axis: 'y', justify: 'end' }, 50, 600);
    expect(r.placements.get('a')?.y).toBe(400);
    expect(r.placements.get('b')?.y).toBe(500);
  });

  it('is declared in configSpec, so a misspelled value is reported', () => {
    expect(stripStrategy.configSpec?.justify).toEqual(['start', 'center', 'end', 'between']);
  });
});
