import { describe, it, expect } from 'vitest';
import { gridStrategy } from './grid.js';
import { createWindowRecord, asWindowId, asZoneId } from '../window.js';
import { createZoneRecord } from '../zone.js';

function mkWin(id: string) {
  return createWindowRecord({ id: asWindowId(id), kind: 'panel' });
}

describe('gridStrategy', () => {
  it('lays out windows in a grid with cols, gap, padding', () => {
    const zone = createZoneRecord({
      id: asZoneId('main'),
      strategy: gridStrategy,
      config: { cols: 2, gap: 10, padding: 20 },
    });
    const windows = [mkWin('a'), mkWin('b'), mkWin('c'), mkWin('d')];
    zone.windowIds = windows.map((w) => w.id);
    const result = gridStrategy.layout({
      zone,
      windows,
      viewport: { w: 410, h: 410 },
    });
    // Usable: 410 - 2*20 = 370; cellW = (370 - 10) / 2 = 180; same h.
    expect(result.get(asWindowId('a'))).toEqual({ x: 20, y: 20, w: 180, h: 180 });
    expect(result.get(asWindowId('b'))).toEqual({ x: 210, y: 20, w: 180, h: 180 });
    expect(result.get(asWindowId('c'))).toEqual({ x: 20, y: 210, w: 180, h: 180 });
    expect(result.get(asWindowId('d'))).toEqual({ x: 210, y: 210, w: 180, h: 180 });
  });

  it('defaults cols=1, gap=0, padding=0', () => {
    const zone = createZoneRecord({ id: asZoneId('m'), strategy: gridStrategy });
    const w = mkWin('a');
    zone.windowIds = [w.id];
    const result = gridStrategy.layout({
      zone, windows: [w], viewport: { w: 100, h: 80 },
    });
    expect(result.get(asWindowId('a'))).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('returns empty for empty zone', () => {
    const zone = createZoneRecord({ id: asZoneId('m'), strategy: gridStrategy });
    expect(gridStrategy.layout({ zone, windows: [], viewport: { w: 100, h: 100 } }).size).toBe(0);
  });
});
