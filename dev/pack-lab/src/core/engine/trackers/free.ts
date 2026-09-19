import { fitsWithin } from '../geometry.js';
import type { Candidate, TrackerDef, Turn } from '../types.js';

interface Free {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Free, b: Free): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const contains = (a: Free, b: Free): boolean =>
  b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

/** `free` with `used` carved out: each rect it overlaps is replaced by up to four maximal
 *  pieces around it, and any piece inside another is dropped. An untouched rect is never
 *  inside a piece, which lies within a rect it was already maximal against. */
export function carve(free: readonly Free[], used: Free): Free[] {
  const kept: Free[] = [];
  const pieces: Free[] = [];
  for (const f of free) {
    if (!overlaps(f, used)) {
      kept.push(f);
      continue;
    }
    if (used.x > f.x) pieces.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
    if (used.x + used.w < f.x + f.w) {
      pieces.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h });
    }
    if (used.y > f.y) pieces.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
    if (used.y + used.h < f.y + f.h) {
      pieces.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) });
    }
  }
  const fresh = pieces.filter(
    (p, i) =>
      !kept.some((q) => contains(q, p)) &&
      !pieces.some((q, j) => j !== i && contains(q, p) && (!contains(p, q) || j < i)),
  );
  return kept.concat(fresh);
}

/**
 * MaxRects: every maximal free rectangle, and a spot at the top-left corner of each one an
 * item fits, listed top to bottom and then left to right. Without a height bound the free
 * space runs down without end. An item wider than the container gets one spot, at the left
 * edge below everything.
 *
 * Features: `shortSide` and `longSide`, the smaller and larger space the item leaves in the
 * free rectangle it takes.
 */
export const freeTracker: TrackerDef = {
  id: 'free',
  features: ['shortSide', 'longSide'],
  configSpec: {},
  create({ container, gap, options }) {
    // Every box is packed grown by `gap` on its right and bottom, in a container grown to match,
    // so a free rect never offers a spot closer than `gap` to a placed box.
    const height =
      options.overflowMode === 'unplaced' ? container.h + gap : Number.POSITIVE_INFINITY;
    let free: Free[] = [{ x: 0, y: 0, w: Math.max(0, container.w) + gap, h: height }];
    let floor = 0;
    return {
      candidates(turns: readonly Turn[]): Candidate[] {
        free.sort((a, b) => a.y - b.y || a.x - b.x);
        const out: Candidate[] = [];
        for (const turn of turns) {
          if (!fitsWithin(turn.w, container.w)) {
            out.push({ x: 0, y: floor, turn, extra: { shortSide: 0, longSide: 0 } });
            continue;
          }
          for (const f of free) {
            const w = turn.w + gap;
            const h = turn.h + gap;
            if (!fitsWithin(w, f.w) || !fitsWithin(h, f.h)) continue;
            const dw = Math.max(0, f.w - w);
            const dh = Math.max(0, f.h - h);
            out.push({
              x: f.x,
              y: f.y,
              turn,
              extra: { shortSide: Math.min(dw, dh), longSide: Math.max(dw, dh) },
            });
          }
        }
        return out;
      },
      commit({ x, y, turn }) {
        free = carve(free, { x, y, w: turn.w + gap, h: turn.h + gap });
        floor = Math.max(floor, y + turn.h + gap);
      },
    };
  },
};
