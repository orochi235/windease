import { describe, expect, it } from 'vitest';
import { datasetsFromCapture } from './capture.js';

const capture = {
  source: 'astv',
  commit: 'abc1234',
  captured: '2026-09-13',
  gap: 1,
  plates: [
    {
      id: 'dir:src',
      columnWidth: 8,
      aspect: 1.6,
      boxes: [
        [8, 3.2],
        [8, 5],
      ],
    },
  ],
};

describe('datasetsFromCapture', () => {
  it('turns each plate into a dataset carrying the settings astv packed it with', () => {
    const [dataset] = datasetsFromCapture(capture);
    expect(dataset).toMatchObject({
      id: 'astv@abc1234:dir:src',
      label: 'dir:src',
      domain: 'astv',
      hint: { gap: 1, columnWidth: 8, aspect: 1.6 },
    });
    expect(dataset?.items.map((i) => i.hints?.preferredSize)).toEqual([
      { w: 8, h: 3.2 },
      { w: 8, h: 5 },
    ]);
  });

  it('names the plate and the box a malformed entry is in', () => {
    const bad = { ...capture, plates: [{ id: 'dir:src', boxes: [[8, 'tall']] }] };
    expect(() => datasetsFromCapture(bad)).toThrow('astv plate dir:src box 0 is not a [w, h] pair');
  });

  it('rejects a file that is not a capture', () => {
    expect(() => datasetsFromCapture({ plates: 3 })).toThrow(
      'a capture needs a `source` and a `plates` array',
    );
  });

  it('names the source, plate and key of a hint that is not a positive number', () => {
    const bad = { ...capture, plates: [{ ...capture.plates[0], aspect: -1 }] };
    expect(() => datasetsFromCapture(bad)).toThrow(
      'astv plate dir:src `aspect` is not a positive number',
    );
  });

  it('rejects a box with a zero or negative side', () => {
    const bad = { ...capture, plates: [{ id: 'dir:src', boxes: [[8, 0]] }] };
    expect(() => datasetsFromCapture(bad)).toThrow('astv plate dir:src box 0 is not a [w, h] pair');
  });

  it('rejects a duplicate plate id, naming it', () => {
    const bad = { ...capture, plates: [capture.plates[0], capture.plates[0]] };
    expect(() => datasetsFromCapture(bad)).toThrow('astv has more than one plate named dir:src');
  });
});
