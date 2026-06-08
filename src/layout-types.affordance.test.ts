import { describe, expect, it } from 'vitest';
import type { Affordance, LayoutStrategy } from './layout-types.js';

describe('Affordance + LayoutStrategy extensions', () => {
  it('Affordance accepts resize kinds and optional childId', () => {
    const a: Affordance = {
      id: 'resize-z',
      kind: 'resize-y',
      rect: { x: 0, y: 0, w: 10, h: 4 },
      childId: 'child-a',
    };
    expect(a.kind).toBe('resize-y');
    expect(a.childId).toBe('child-a');
  });

  it('LayoutStrategy may declare a dispatchAffordance hook', () => {
    const strat: LayoutStrategy = {
      name: 'test',
      layout: () => ({ placements: new Map(), affordances: [] }),
      dispatchAffordance: (_ctx) => {
        // no-op
      },
    };
    expect(typeof strat.dispatchAffordance).toBe('function');
  });
});
