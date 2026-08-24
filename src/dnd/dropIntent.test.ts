import { describe, expect, it } from 'vitest';
import { resolveDropIntent } from './dropIntent.js';
import { insertionIndexByMidpoint } from './insertionIndex.js';

const row = [
  { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
  { id: 'b', rect: { x: 100, y: 0, w: 100, h: 100 } },
  { id: 'c', rect: { x: 200, y: 0, w: 100, h: 100 } },
];

describe('resolveDropIntent', () => {
  it('agrees with insertionIndexByMidpoint at every x when no other intent is enabled', () => {
    const bounds = row.map((r) => ({ left: r.rect.x, right: r.rect.x + r.rect.w }));
    for (let x = 0; x <= 300; x += 1) {
      const intent = resolveDropIntent(row, { x, y: 50 }, 'x');
      expect(intent).toEqual({ kind: 'insert', index: insertionIndexByMidpoint(bounds, x, 'x') });
    }
  });

  it('stacks in the centre band when stacking is enabled', () => {
    expect(resolveDropIntent(row, { x: 150, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'stack',
      ontoId: 'b',
    });
  });

  it('inserts at the neighbouring seam from a main-axis band', () => {
    expect(resolveDropIntent(row, { x: 105, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 1,
    });
    expect(resolveDropIntent(row, { x: 195, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 2,
    });
  });

  it('resolves corners to insert, not split', () => {
    expect(resolveDropIntent(row, { x: 105, y: 5 }, 'x', { stack: true, split: true })).toEqual({
      kind: 'insert',
      index: 1,
    });
  });

  it('splits from a cross-axis band when splitting is enabled', () => {
    expect(resolveDropIntent(row, { x: 150, y: 5 }, 'x', { stack: true, split: true })).toEqual({
      kind: 'split',
      ontoId: 'b',
      edge: 'start',
      axis: 'y',
    });
    expect(resolveDropIntent(row, { x: 150, y: 95 }, 'x', { stack: true, split: true })).toEqual({
      kind: 'split',
      ontoId: 'b',
      edge: 'end',
      axis: 'y',
    });
  });

  it('clamps a band that would swallow the centre', () => {
    const narrow = [{ id: 'n', rect: { x: 0, y: 0, w: 10, h: 100 } }];
    // band 0.9 unclamped puts x=5 inside the leading band; the clamp has to
    // leave a centre or a pane becomes impossible to stack onto.
    expect(resolveDropIntent(narrow, { x: 5, y: 50 }, 'x', { stack: true, band: 0.9 })).toEqual({
      kind: 'stack',
      ontoId: 'n',
    });
  });

  it('returns index 0 for an empty child list', () => {
    expect(resolveDropIntent([], { x: 0, y: 0 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 0,
    });
  });

  it('falls back to a midpoint insert when the cursor is over no child', () => {
    expect(resolveDropIntent(row, { x: 400, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 3,
    });
  });

  it('resolves the same bands on a vertical stack', () => {
    const col = [
      { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
      { id: 'b', rect: { x: 0, y: 100, w: 100, h: 100 } },
    ];
    expect(resolveDropIntent(col, { x: 50, y: 150 }, 'y', { stack: true })).toEqual({
      kind: 'stack',
      ontoId: 'b',
    });
    expect(resolveDropIntent(col, { x: 50, y: 105 }, 'y', { stack: true })).toEqual({
      kind: 'insert',
      index: 1,
    });
  });

  it('splits with the cross axis of a horizontal container', () => {
    const intent = resolveDropIntent(row, { x: 150, y: 5 }, 'x', { split: true });
    expect(intent).toEqual({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' });
  });

  it('splits with the cross axis of a vertical container', () => {
    const column = [
      { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
      { id: 'b', rect: { x: 0, y: 100, w: 100, h: 100 } },
    ];
    const intent = resolveDropIntent(column, { x: 95, y: 150 }, 'y', { split: true });
    expect(intent).toEqual({ kind: 'split', ontoId: 'b', edge: 'end', axis: 'x' });
  });
});
