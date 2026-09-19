import { describe, expect, it } from 'vitest';
import { optionKeys, PACKERS, packerById } from './packers.js';

describe('packers', () => {
  it('registers the three packing strategies by name', () => {
    expect(PACKERS.map((p) => p.id)).toEqual(['shelf', 'column', 'skyline']);
  });

  it('offers the option keys each strategy declares', () => {
    expect(optionKeys(packerById('column')).sort()).toEqual([
      'cols',
      'columnWidth',
      'gap',
      'justify',
      'overflowMode',
      'rotate',
      'sort',
    ]);
    expect(optionKeys(packerById('shelf'))).toEqual(['gap', 'sort', 'rotate', 'overflowMode']);
  });

  it('throws on an unknown packer', () => {
    expect(() => packerById('nope')).toThrow('no packer "nope"');
  });
});
