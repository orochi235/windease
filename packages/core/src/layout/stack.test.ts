import { describe, expect, it } from 'vitest';
import { asWindowId, asZoneId, createWindowRecord } from '../window.js';
import { createZoneRecord } from '../zone.js';
import { stackStrategy } from './stack.js';

const mkWin = (id: string, preferredH?: number) =>
  createWindowRecord({
    id: asWindowId(id),
    kind: 'panel',
    ...(preferredH ? { hints: { preferredSize: { w: 0, h: preferredH } } } : {}),
  });

describe('stackStrategy', () => {
  it('stacks windows vertically using preferredSize.h, gap, padding', () => {
    const zone = createZoneRecord({
      id: asZoneId('side'),
      strategy: stackStrategy,
      config: { gap: 5, padding: 10 },
    });
    const wins = [mkWin('a', 50), mkWin('b', 30)];
    zone.windowIds = wins.map((w) => w.id);
    const result = stackStrategy.layout({
      zone,
      windows: wins,
      viewport: { w: 200, h: 200 },
    });
    expect(result.get(asWindowId('a'))).toEqual({ x: 10, y: 10, w: 180, h: 50 });
    expect(result.get(asWindowId('b'))).toEqual({ x: 10, y: 65, w: 180, h: 30 });
  });

  it('falls back to equal heights when no preferredSize', () => {
    const zone = createZoneRecord({ id: asZoneId('s'), strategy: stackStrategy });
    const wins = [mkWin('a'), mkWin('b')];
    zone.windowIds = wins.map((w) => w.id);
    const result = stackStrategy.layout({
      zone,
      windows: wins,
      viewport: { w: 100, h: 100 },
    });
    expect(result.get(asWindowId('a'))?.h).toBe(50);
    expect(result.get(asWindowId('b'))?.h).toBe(50);
  });
});
