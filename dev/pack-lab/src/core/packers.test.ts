import { describe, expect, it } from 'vitest';
import { optionKeys, PACKERS, packerById } from './packers.js';

describe('packers', () => {
  it('registers the three packing strategies on, then every engine recipe off', () => {
    expect(PACKERS.filter((p) => p.on).map((p) => p.id)).toEqual(['shelf', 'column', 'skyline']);
    expect(PACKERS.filter((p) => !p.on).map((p) => p.id)).toContain('engine:maxrects-bssf');
    expect(PACKERS.filter((p) => !p.on).every((p) => p.recipe !== undefined)).toBe(true);
  });

  it("gives an engine recipe its tracker's options", () => {
    expect(optionKeys(packerById('engine:column'))).toContain('cols');
    expect(optionKeys(packerById('engine:skyline'))).not.toContain('cols');
  });

  it('offers the option keys each strategy declares', () => {
    expect(optionKeys(packerById('column')).sort()).toEqual([
      'cols',
      'columnWidth',
      'gap',
      'justify',
      'overflowMode',
      'pocket',
      'rotate',
      'sort',
    ]);
    expect(optionKeys(packerById('shelf'))).toEqual([
      'gap',
      'sort',
      'rotate',
      'overflowMode',
      'pocket',
    ]);
  });

  it('throws on an unknown packer', () => {
    expect(() => packerById('nope')).toThrow('no packer "nope"');
  });
});
