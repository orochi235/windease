import { describe, expect, it } from 'vitest';
import { FLOATING_CORNERS, floatingStrategy, stackStrategy } from '../index.js';

describe('floating public entry', () => {
  it('reaches a consumer from the package entry point alone', () => {
    const s = floatingStrategy(stackStrategy);
    const panel = { id: 'legend', meta: { floating: true }, natural: { w: 10, h: 10 } };
    const state = s.initialState([panel], {});
    const r = s.layout({ items: [panel], container: { w: 100, h: 100 }, state, options: {} });
    expect(r.placements.get('legend')).toEqual({ x: 12, y: 78, w: 10, h: 10 });
  });

  it('exports the corner vocabulary a consumer needs to configure it', () => {
    expect(FLOATING_CORNERS).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  });
});
