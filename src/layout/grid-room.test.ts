import { describe, expect, it } from 'vitest';
import { gridRoom } from './grid-room.js';

const open = () => true;

describe('gridRoom', () => {
  // 3-wide blocks on a 7-wide row use 6 of its cells; a 1-wide block beside
  // them leaves a 6-wide run, which still holds 6.
  it('counts only what the widths can fill along each row', () => {
    const room = gridRoom(open, 7, 1, [{ cols: 3, rows: 1 }]);
    expect(room.admits(0, 0, 1, 1, 6)).toBe(true);
    expect(room.admits(0, 0, 1, 1, 7)).toBe(false);
    // In the middle it splits the row into runs of 3 and 3.
    expect(room.admits(3, 0, 1, 1, 6)).toBe(true);
    // At column 2 it leaves runs of 2 and 4, which hold 0 and 3.
    expect(room.admits(2, 0, 1, 1, 4)).toBe(false);
    expect(room.admits(2, 0, 1, 1, 3)).toBe(true);
  });

  it('counts only what the heights can fill down each column', () => {
    const room = gridRoom(open, 1, 7, [{ cols: 1, rows: 3 }]);
    expect(room.admits(0, 2, 1, 1, 3)).toBe(true);
    expect(room.admits(0, 2, 1, 1, 4)).toBe(false);
  });

  it('starts from the cells already taken', () => {
    // Column 0 taken on both rows: each row's run is 3 wide and holds 2, and
    // a block at column 2 cuts row 0's into two that hold nothing.
    const room = gridRoom((col) => col > 0, 4, 2, [{ cols: 2, rows: 1 }]);
    expect(room.admits(1, 0, 1, 1, 4)).toBe(true);
    expect(room.admits(2, 0, 1, 1, 2)).toBe(true);
    expect(room.admits(2, 0, 1, 1, 3)).toBe(false);
    expect(room.admits(1, 1, 3, 1, 2)).toBe(true);
    expect(room.admits(1, 1, 3, 1, 3)).toBe(false);
  });

  it('takes nothing for an empty block', () => {
    // Each 3-tall column holds 2; the rows hold 6 between them.
    const room = gridRoom(open, 2, 3, [{ cols: 1, rows: 2 }]);
    expect(room.admits(0, 2, 1, -1, 4)).toBe(true);
    expect(room.admits(0, 2, 1, -1, 5)).toBe(false);
  });
});
