import { fitsWithin } from '../geometry.js';
import type { Candidate, TrackerDef, Turn } from '../types.js';

/** One flat stretch of the packed outline: `[x, end)` is filled down to `top`. */
interface Segment {
  x: number;
  end: number;
  top: number;
}

/** The outline with `[from, to)` raised to `top`, neighbors of equal height merged. The same
 *  outline `raise` in src/layout/skyline.ts builds, in one pass. */
function raise(sky: readonly Segment[], from: number, to: number, top: number): Segment[] {
  const next: Segment[] = [];
  const push = (segment: Segment) => {
    const last = next[next.length - 1];
    if (last && last.top === segment.top && last.end === segment.x) last.end = segment.end;
    else next.push(segment);
  };
  for (const s of sky) if (s.x < from) push({ x: s.x, end: Math.min(s.end, from), top: s.top });
  push({ x: from, end: to, top });
  for (const s of sky) if (s.end > to) push({ x: Math.max(s.x, to), end: s.end, top: s.top });
  return next;
}

/**
 * Skyline: the outline of what is packed, and a spot at each segment start along it, the item
 * resting on the highest segment it spans. Spots run left to right and stop at the first that
 * crosses the width, except that the left edge is always offered.
 *
 * Features: `waste`, the area left enclosed between the item's bottom edge and the outline.
 */
export const outlineTracker: TrackerDef = {
  id: 'outline',
  features: ['waste'],
  configSpec: {},
  create({ container, gap }) {
    let sky: Segment[] = [{ x: 0, end: Math.max(0, container.w), top: 0 }];
    return {
      candidates(turns: readonly Turn[]): Candidate[] {
        const out: Candidate[] = [];
        for (const turn of turns) {
          for (let i = 0; i < sky.length; i++) {
            const x = sky[i]!.x;
            if (x > 0 && !fitsWithin(x + turn.w, container.w)) break;
            const to = x + turn.w + gap;
            let top = 0;
            for (let j = i; j < sky.length && sky[j]!.x < to; j++) top = Math.max(top, sky[j]!.top);
            let waste = 0;
            const right = x + turn.w;
            for (let j = i; j < sky.length && sky[j]!.x < right; j++) {
              const s = sky[j]!;
              waste += (top - s.top) * (Math.min(s.end, right) - s.x);
            }
            out.push({ x, y: top, turn, extra: { waste } });
          }
        }
        return out;
      },
      commit({ x, y, turn }) {
        sky = raise(sky, x, x + turn.w + gap, y + turn.h + gap);
      },
    };
  },
};
