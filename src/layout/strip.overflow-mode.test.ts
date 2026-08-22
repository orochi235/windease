import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const CONTAINER = { w: 200, h: 400 };

const run = (items: LayoutItem[], options: Record<string, unknown>) =>
  stripStrategy.layout({ items, container: CONTAINER, state: undefined as void, options });

/** Three panes each asking for 200 in a 400 column: 200 too many. */
const asking = (h: number, n = 3): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    placement: { size: { h } },
  })) as unknown as LayoutItem[];

/** Content-sized panes that declare no floor — the silent case. */
const measured = (h: number, n = 3): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    hints: { sizing: { h: 'content' as const } },
    natural: { w: 200, h },
  })) as unknown as LayoutItem[];

const heights = (r: ReturnType<typeof run>) => [...r.placements.values()].map((p) => p.h);

describe('strip overflowMode', () => {
  it('squeezes by default, unchanged from before the option existed', () => {
    const r = run(asking(200), { axis: 'y' });
    for (const h of heights(r)) expect(h).toBeCloseTo(400 / 3, 6);
    expect(r.overflow).toBeUndefined();
  });

  it('squeeze is the same as saying nothing', () => {
    const a = run(asking(200), { axis: 'y' });
    const b = run(asking(200), { axis: 'y', overflowMode: 'squeeze' });
    expect(heights(b)).toEqual(heights(a));
  });

  describe('scroll', () => {
    it('lays out at the intrinsic extent instead of compressing', () => {
      const r = run(asking(200), { axis: 'y', overflowMode: 'scroll' });
      expect(heights(r)).toEqual([200, 200, 200]);
    });

    it('reports the excess so the host can size a scrolling box', () => {
      const r = run(asking(200), { axis: 'y', overflowMode: 'scroll' });
      expect(r.overflow).toEqual({ w: 0, h: 200 });
    });

    it('counts gap and padding in the extent it reports', () => {
      const r = run(asking(200), { axis: 'y', overflowMode: 'scroll', gap: 10, padding: 5 });
      // 3*200 + 2*10 + 2*5 = 630, over a 400 container.
      expect(r.overflow).toEqual({ w: 0, h: 230 });
    });

    it('holds a content-sized pane at its measurement rather than shrinking it', () => {
      // The silent case: a measurement is a stated size that scales under
      // pressure, and with no `minSize` the floor is zero, so these panes
      // quietly shrank and `overflow` stayed absent.
      const r = run(measured(150), { axis: 'y', overflowMode: 'scroll' });
      expect(heights(r)).toEqual([150, 150, 150]);
      expect(r.overflow).toEqual({ w: 0, h: 50 });
    });

    it('changes nothing when the content already fits', () => {
      const a = run(asking(100), { axis: 'y' });
      const b = run(asking(100), { axis: 'y', overflowMode: 'scroll' });
      expect(heights(b)).toEqual(heights(a));
      expect(b.overflow).toBeUndefined();
    });

    it('still floors unconstrained siblings at their minimum', () => {
      const items = [
        { id: 'a', placement: { size: { h: 380 } } },
        { id: 'b', hints: { minSize: { w: 0, h: 60 } } },
      ] as unknown as LayoutItem[];
      const r = run(items, { axis: 'y', overflowMode: 'scroll' });
      expect(heights(r)).toEqual([380, 60]);
      expect(r.overflow).toEqual({ w: 0, h: 40 });
    });

    it('works on the horizontal axis too', () => {
      const items = [
        { id: 'a', placement: { size: { w: 150 } } },
        { id: 'b', placement: { size: { w: 150 } } },
      ] as unknown as LayoutItem[];
      const r = run(items, { axis: 'x', overflowMode: 'scroll' });
      expect([...r.placements.values()].map((p) => p.w)).toEqual([150, 150]);
      expect(r.overflow).toEqual({ w: 100, h: 0 });
    });
  });

  describe('unplace', () => {
    it('drops the panes that do not fit rather than shrinking any of them', () => {
      const r = run(asking(150), { axis: 'y', overflowMode: 'unplace' });
      expect(heights(r)).toEqual([150, 150]);
      expect(r.unplaced).toEqual(['p3']);
    });

    it('keeps the panes it placed at their asked extent', () => {
      const r = run(asking(150), { axis: 'y', overflowMode: 'unplace' });
      expect(r.overflow).toBeUndefined();
    });

    it('counts gap and padding against the budget', () => {
      // 2 panes of 150 plus one 10px gap and 2*5 padding is 320; a third would
      // need another 160 and the container holds 400.
      const r = run(asking(150), { axis: 'y', overflowMode: 'unplace', gap: 10, padding: 5 });
      expect(r.unplaced).toEqual(['p3']);
    });

    it('places the first pane even when it alone does not fit, clamped', () => {
      // Placing nothing renders an empty container and hides the problem. The
      // one pane that must be placed is clamped rather than overflowed, so the
      // mode keeps its promise that `unplace` never reports overflow.
      const r = run(asking(900, 2), { axis: 'y', overflowMode: 'unplace' });
      expect(heights(r)).toEqual([400]);
      expect(r.unplaced).toEqual(['p2']);
      expect(r.overflow).toBeUndefined();
    });

    it('composes with the count cap rather than replacing it', () => {
      const r = run(asking(50, 4), { axis: 'y', overflowMode: 'unplace', maxItems: 2 });
      expect(r.unplaced).toEqual(['p3', 'p4']);
    });

    it('unplaces nothing when everything fits', () => {
      const r = run(asking(100), { axis: 'y', overflowMode: 'unplace' });
      expect(heights(r)).toEqual([100, 100, 100]);
      expect(r.unplaced).toBeUndefined();
    });
  });

  describe('affordances agree with the placements', () => {
    it('emits no seam for a pane the size policy unplaced', () => {
      const r = run(asking(150), { axis: 'y', overflowMode: 'unplace', resizable: true });
      const ids = r.affordances.map((a) => a.childId);
      expect(ids).not.toContain('p3');
    });

    it('a scroll-mode seam reports the extent actually rendered', () => {
      const r = run(asking(200), { axis: 'y', overflowMode: 'scroll', resizable: true });
      expect(r.affordances[0]?.bounds?.valueNow).toBe(200);
    });
  });
});
