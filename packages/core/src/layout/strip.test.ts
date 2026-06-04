import { describe, expect, it } from 'vitest';
import { asWindowId, asZoneId, createWindowRecord } from '../window.js';
import { createZoneRecord } from '../zone.js';
import { stripStrategy } from './strip.js';

const mkWin = (id: string, preferredW?: number) =>
  createWindowRecord({
    id: asWindowId(id),
    kind: 'panel',
    ...(preferredW ? { hints: { preferredSize: { w: preferredW, h: 0 } } } : {}),
  });

describe('stripStrategy', () => {
  it('lays out horizontally by default', () => {
    const zone = createZoneRecord({
      id: asZoneId('dock'),
      strategy: stripStrategy,
      config: { axis: 'x', gap: 4, padding: 8 },
    });
    const wins = [mkWin('a', 60), mkWin('b', 40)];
    zone.windowIds = wins.map((w) => w.id);
    const result = stripStrategy.layout({
      zone,
      windows: wins,
      viewport: { w: 200, h: 40 },
    });
    expect(result.get(asWindowId('a'))).toEqual({ x: 8, y: 8, w: 60, h: 24 });
    expect(result.get(asWindowId('b'))).toEqual({ x: 72, y: 8, w: 40, h: 24 });
  });

  it('axis y lays out vertically', () => {
    const zone = createZoneRecord({
      id: asZoneId('rail'),
      strategy: stripStrategy,
      config: { axis: 'y', gap: 0, padding: 0 },
    });
    const wins = [mkWin('a'), mkWin('b')];
    wins[0]!.hints = { preferredSize: { w: 0, h: 20 } };
    wins[1]!.hints = { preferredSize: { w: 0, h: 30 } };
    zone.windowIds = wins.map((w) => w.id);
    const result = stripStrategy.layout({
      zone,
      windows: wins,
      viewport: { w: 50, h: 100 },
    });
    expect(result.get(asWindowId('a'))).toEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(result.get(asWindowId('b'))).toEqual({ x: 0, y: 20, w: 50, h: 30 });
  });
});
