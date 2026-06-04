import { describe, expect, it } from 'vitest';
import { asWindowId, createWindowRecord } from './window.js';

describe('createWindowRecord', () => {
  it('initializes all three machines in their initial states', () => {
    const w = createWindowRecord({ id: asWindowId('w1'), kind: 'panel' });
    expect(w.lifecycle.state).toBe('mounted');
    expect(w.transit.state).toBe('idle');
    expect(w.focus.state).toBe('blurred');
    expect(w.zoneId).toBeNull();
    expect(w.hints).toEqual({});
    expect(w.meta).toEqual({});
  });

  it('preserves hints and meta', () => {
    const w = createWindowRecord({
      id: asWindowId('w2'),
      kind: 'widget',
      hints: { minSize: { w: 100, h: 50 } },
      meta: { tag: 'x' },
    });
    expect(w.hints.minSize).toEqual({ w: 100, h: 50 });
    expect(w.meta).toEqual({ tag: 'x' });
  });
});
