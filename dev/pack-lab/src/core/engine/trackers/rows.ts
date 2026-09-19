import { fitsWithin } from '../geometry.js';
import type { Candidate, TrackerDef, Turn } from '../types.js';

/**
 * Shelf rows: one open row, filled left to right. An item can continue the row — any turn that
 * fits its remaining width without raising it, or upright raising it — or start a new row under
 * the tallest item in this one.
 *
 * Features: `newRow` (1 when the spot starts a row below a non-empty one), `raise` (1 when it
 * makes the row taller), `rowWidth` (the width it takes from the row; 0 on a new row).
 */
export const rowsTracker: TrackerDef = {
  id: 'rows',
  features: ['newRow', 'raise', 'rowWidth'],
  configSpec: {},
  create({ container, gap }) {
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    return {
      candidates(turns: readonly Turn[]): Candidate[] {
        const out: Candidate[] = [];
        if (x > 0) {
          for (const turn of turns) {
            if (!fitsWithin(x + turn.w, container.w)) continue;
            const raise = fitsWithin(turn.h, rowHeight) ? 0 : 1;
            if (raise && turn.turned) continue;
            out.push({ x, y, turn, extra: { newRow: 0, raise, rowWidth: turn.w } });
          }
        }
        const top = x > 0 ? y + rowHeight + gap : y;
        const newRow = x > 0 ? 1 : 0;
        for (const turn of turns) {
          out.push({ x: 0, y: top, turn, extra: { newRow, raise: 0, rowWidth: 0 } });
        }
        return out;
      },
      commit({ x: at, y: top, turn }) {
        if (at === 0 && x > 0) {
          y = top;
          rowHeight = 0;
        }
        rowHeight = Math.max(rowHeight, turn.h);
        x = at + (turn.w + gap);
      },
    };
  },
};
