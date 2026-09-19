import { describe, expect, it } from 'vitest';
import { describePackContract, runPack, sized } from '../test-utils/pack-contract.js';
import { columnStrategy } from './column.js';

describePackContract(columnStrategy);

describe('columnStrategy', () => {
  it('spans a wide item across the columns its width needs, and no more', () => {
    const items = [sized('wide', 150, 40), sized('n', 100, 10), sized('m', 100, 10)];
    const r = runPack(columnStrategy, items, { w: 300, h: 500 }, { columnWidth: 100 });
    expect(r.placements.get('wide')).toMatchObject({ x: 0, y: 0 });
    // The third column stayed free: both narrow items stack there.
    expect(r.placements.get('n')).toMatchObject({ x: 200, y: 0 });
    expect(r.placements.get('m')).toMatchObject({ x: 200, y: 10 });
  });

  it('counts the gap a spanning item covers between its columns', () => {
    const items = [sized('wide', 210, 40), sized('n', 100, 10)];
    const r = runPack(columnStrategy, items, { w: 320, h: 500 }, { columnWidth: 100, gap: 10 });
    expect(r.placements.get('wide')).toMatchObject({ x: 0, y: 0 });
    expect(r.placements.get('n')).toMatchObject({ x: 220, y: 0 });
  });

  it('puts the next item on the shortest column', () => {
    const items = [
      sized('a', 100, 200),
      sized('b', 100, 50),
      sized('c', 100, 80),
      sized('d', 100, 10),
    ];
    const r = runPack(columnStrategy, items, { w: 300, h: 500 });
    expect(r.placements.get('d')).toMatchObject({ x: 100, y: 50 });
  });

  it('breaks a tie between equally short columns to the left', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => sized(id, 100, 10));
    const r = runPack(columnStrategy, items, { w: 300, h: 500 });
    expect(r.placements.get('d')).toMatchObject({ x: 0, y: 10 });
  });

  it('defaults the column width to the narrowest item', () => {
    const items = [sized('a', 120, 10), sized('b', 80, 10)];
    const r = runPack(columnStrategy, items, { w: 400, h: 500 });
    // Columns of 80: `a` spans the first two, so `b` starts the third.
    expect(r.placements.get('b')).toMatchObject({ x: 160, y: 0 });
  });

  it('keeps its columns when one item is wider than the container', () => {
    const items = [
      sized('a', 100, 50),
      sized('b', 100, 50),
      sized('c', 100, 50),
      sized('wide', 500, 40),
    ];
    const r = runPack(columnStrategy, items, { w: 400, h: 500 });
    expect(['a', 'b', 'c'].map((id) => r.placements.get(id)?.x)).toEqual([0, 100, 200]);
    expect(r.placements.get('wide')).toMatchObject({ x: 0, y: 50 });
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(columnStrategy.configSpec ?? {}).sort()).toEqual([
      'columnWidth',
      'gap',
      'overflowMode',
      'rotate',
      'sort',
    ]);
  });

  describe('rotate', () => {
    it('turns an item to span fewer columns beside a taller one', () => {
      // At 299 wide, tower cannot lie down, and upright wide spans both columns.
      const items = [sized('tower', 100, 300), sized('wide', 250, 90)];
      const r = runPack(columnStrategy, items, { w: 299, h: 1000 }, { rotate: true });
      expect(r.placements.get('wide')).toEqual({ x: 100, y: 0, z: 0, w: 90, h: 250 });
      expect(r.channels?.get('wide')).toEqual({ rotation: 90 });
    });

    it('keeps a wide item upright where turning it would make the layout taller', () => {
      const items = [sized('wide', 250, 90), sized('n', 100, 10)];
      const r = runPack(columnStrategy, items, { w: 300, h: 1000 }, { rotate: true });
      expect(r.placements.get('wide')).toEqual({ x: 0, y: 0, z: 0, w: 250, h: 90 });
      expect(r.channels?.get('wide')).toEqual({ rotation: 0 });
    });

    it('of two ways that grow the layout alike, takes the one spanning fewer columns', () => {
      const items = [sized('tower', 100, 400), sized('b', 150, 90)];
      const r = runPack(columnStrategy, items, { w: 399, h: 1000 }, { rotate: true });
      // Upright b spans cols 1–2 to 90; turned it takes col 1 alone to 150. Neither passes 400.
      expect(r.placements.get('b')).toMatchObject({ x: 100, w: 90, h: 150 });
    });
  });
});
