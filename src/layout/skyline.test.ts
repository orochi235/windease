import { describe, expect, it } from 'vitest';
import { describePackContract, runPack, sized } from '../test-utils/pack-contract.js';
import { shelfStrategy } from './shelf.js';
import { skylineStrategy } from './skyline.js';

describePackContract(skylineStrategy);

describe('skylineStrategy', () => {
  it('puts the first item at the origin and the next beside it', () => {
    const r = runPack(skylineStrategy, [sized('a', 50, 50), sized('b', 50, 50)], {
      w: 100,
      h: 100,
    });
    expect(r.placements.get('a')).toEqual({ x: 0, y: 0, z: 0, w: 50, h: 50 });
    expect(r.placements.get('b')).toMatchObject({ x: 50, y: 0 });
  });

  it('drops a small item into the space beside a tall one that a shelf leaves empty', () => {
    const items = [sized('tall', 60, 100), sized('b', 40, 20), sized('c', 40, 20)];
    const container = { w: 100, h: 1000 };
    const skyline = runPack(skylineStrategy, items, container).placements.get('c')!;
    const shelf = runPack(shelfStrategy, items, container).placements.get('c')!;
    expect(skyline).toEqual({ x: 60, y: 20, z: 0, w: 40, h: 20 });
    expect(shelf.y).toBe(100);
    expect(skyline.y).toBeLessThan(shelf.y);
  });

  it('keeps the gap below an item it stacks under', () => {
    const items = [sized('tall', 60, 100), sized('b', 40, 20), sized('c', 40, 20)];
    const r = runPack(skylineStrategy, items, { w: 110, h: 1000 }, { gap: 10 });
    expect(r.placements.get('b')).toMatchObject({ x: 70, y: 0 });
    expect(r.placements.get('c')).toMatchObject({ x: 70, y: 30 });
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(skylineStrategy.configSpec ?? {})).toEqual(['gap', 'sort', 'overflowMode']);
  });
});
