import { describe, expect, it } from 'vitest';
import { describePackContract, runPack, sized } from '../test-utils/pack-contract.js';
import { shelfStrategy } from './shelf.js';

describePackContract(shelfStrategy);

describe('shelfStrategy', () => {
  it('puts the first item at the origin', () => {
    const r = runPack(shelfStrategy, [sized('a', 70, 30), sized('b', 20, 90)], { w: 400, h: 400 });
    expect(r.placements.get('a')).toEqual({ x: 0, y: 0, z: 0, w: 70, h: 30 });
  });

  it('wraps below the tallest item in the row when the next would cross the width', () => {
    const items = [sized('a', 150, 60), sized('b', 150, 90), sized('c', 150, 40)];
    const r = runPack(shelfStrategy, items, { w: 320, h: 500 }, { gap: 10 });
    expect(r.placements.get('b')).toMatchObject({ x: 160, y: 0 });
    expect(r.placements.get('c')).toMatchObject({ x: 0, y: 100 });
  });

  it('keeps an item that ends exactly at the width on the row', () => {
    const items = [sized('a', 100, 10), sized('b', 100, 10), sized('c', 100, 10)];
    const r = runPack(shelfStrategy, items, { w: 300, h: 100 });
    expect([...r.placements.values()].map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [100, 0],
      [200, 0],
    ]);
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(shelfStrategy.configSpec ?? {})).toEqual(['gap', 'sort', 'overflowMode']);
  });
});
