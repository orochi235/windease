import { describe, expect, it } from 'vitest';
import { gridStrategy } from './layout/grid.js';
import { WindeaseStore } from './store.js';
import { asWindowId, asZoneId } from './window.js';

describe('snapshot / hydrate', () => {
  it('round-trips windows, zones, membership, focus, and lifecycle', () => {
    const a = new WindeaseStore();
    a.registerZone({ id: asZoneId('main'), strategy: gridStrategy, config: { cols: 2 } });
    a.createWindow({ id: asWindowId('w1'), kind: 'panel', meta: { tag: 'x' } });
    a.show(asWindowId('w1'));
    a.claim(asZoneId('main'), asWindowId('w1'));
    a.focus(asWindowId('w1'));
    const snap = a.snapshot();

    const b = new WindeaseStore();
    b.hydrate(snap, { strategies: { grid: gridStrategy } });

    const w = b.getWindow(asWindowId('w1'));
    expect(w?.kind).toBe('panel');
    expect(w?.lifecycle.state).toBe('visible');
    expect(w?.focus.state).toBe('focused');
    expect(w?.zoneId).toBe('main');
    expect(w?.meta).toEqual({ tag: 'x' });
    expect(b.getZone(asZoneId('main'))?.windowIds).toEqual(['w1']);
    expect(b.getZone(asZoneId('main'))?.strategy.name).toBe('grid');
  });

  it('hydrate throws UNKNOWN_STRATEGY for unmapped strategy name', () => {
    const a = new WindeaseStore();
    a.registerZone({ id: asZoneId('main'), strategy: gridStrategy });
    const snap = a.snapshot();
    const b = new WindeaseStore();
    expect(() => b.hydrate(snap, { strategies: {} })).toThrow();
  });
});
