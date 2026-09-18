import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { captureTrace } from '../test-utils/capture-trace.js';
import { desktopStrategy } from './desktop.js';
import { gridStrategy } from './grid.js';
import { shelfStrategy } from './shelf.js';

const container = { w: 400, h: 300 };

function run(
  items: LayoutItem[],
  options: Record<string, unknown> = {},
  inner?: Parameters<typeof desktopStrategy>[0],
) {
  const s = desktopStrategy(inner);
  const state = s.initialState(items, options);
  return s.layout({ items, container, state, options });
}

const win = (id: string, meta: Record<string, unknown> = {}, w = 100, h = 80): LayoutItem => ({
  id,
  meta,
  hints: { preferredSize: { w, h } },
});

describe('desktopStrategy windows', () => {
  it('places a window at its own x and y, at its own size', () => {
    const r = run([win('a', { x: 30, y: 40 })]);
    expect(r.placements.get('a')).toEqual({ x: 30, y: 40, z: 1, w: 100, h: 80 });
  });

  it('takes size from placement.size over natural over preferredSize, per axis', () => {
    const item: LayoutItem = {
      id: 'a',
      meta: { x: 0, y: 0 },
      placement: { size: { w: 150 } },
      natural: { w: 90, h: 70 },
      hints: { preferredSize: { w: 10, h: 10 } },
    };
    expect(run([item]).placements.get('a')).toMatchObject({ w: 150, h: 70 });
  });

  it('stacks later items above earlier ones, all above zero', () => {
    const r = run([
      win('a', { x: 0, y: 0 }),
      win('b', { x: 10, y: 10 }),
      win('c', { x: 20, y: 20 }),
    ]);
    expect(['a', 'b', 'c'].map((id) => r.placements.get(id)?.z)).toEqual([1, 2, 3]);
  });

  it('cascades windows with no position, and skips positioned ones in the count', () => {
    const r = run([win('a'), win('b', { x: 200, y: 5 }), win('c'), win('d', { x: 7 })]);
    expect(r.placements.get('a')).toMatchObject({ x: 0, y: 0 });
    expect(r.placements.get('b')).toMatchObject({ x: 200, y: 5 });
    expect(r.placements.get('c')).toMatchObject({ x: 24, y: 24 });
    expect(r.placements.get('d')).toMatchObject({ x: 48, y: 48 });
  });

  it('honors a cascade step from config', () => {
    const r = run([win('a'), win('b')], { cascade: 40 });
    expect(r.placements.get('b')).toMatchObject({ x: 40, y: 40 });
  });

  it('leaves a window with no size unplaced, without spending a stacking rank', () => {
    const r = run([win('a', { x: 0, y: 0 }), { id: 'b' }, win('c', { x: 0, y: 0 })]);
    expect(r.unplaced).toEqual(['b']);
    expect(r.placements.has('b')).toBe(false);
    expect(r.placements.get('c')?.z).toBe(2);
  });

  it('does not clamp a window past the edge, and reports the overflow on every side', () => {
    const r = run([win('a', { x: 350, y: -20 }), win('b', { x: 0, y: 260 })]);
    expect(r.placements.get('a')).toMatchObject({ x: 350, y: -20 });
    expect(r.overflow).toEqual({ w: 50, h: 40, top: 20 });
  });

  it('reports no overflow when every window fits', () => {
    expect(run([win('a', { x: 0, y: 0 })]).overflow).toBeUndefined();
  });

  it('emits no affordances of its own', () => {
    expect(run([win('a', { x: 0, y: 0 })]).affordances).toEqual([]);
  });
});

describe('desktopStrategy minimize', () => {
  it('shades a minimized window in place by default', () => {
    const r = run([win('a', { x: 30, y: 40, minimized: true })]);
    expect(r.placements.get('a')).toEqual({ x: 30, y: 40, z: 1, w: 100, h: 28 });
  });

  it('honors shadeHeight', () => {
    const r = run([win('a', { x: 0, y: 0, minimized: true })], { shadeHeight: 12 });
    expect(r.placements.get('a')?.h).toBe(12);
  });

  it("hands a minimized window to the icon layer under minimize: 'icon'", () => {
    const r = run(
      [win('a', { x: 30, y: 40 }), win('b', { x: 50, y: 60, minimized: true })],
      { minimize: 'icon' },
      shelfStrategy,
    );
    expect(r.placements.get('b')).toEqual({ x: 0, y: 0, z: 0, w: 64, h: 64 });
    expect(r.placements.get('a')?.z).toBe(1);
  });

  it('sizes a minimized icon from iconWidth and iconHeight', () => {
    const r = run(
      [win('b', { minimized: true })],
      { minimize: 'icon', iconWidth: 40, iconHeight: 30 },
      shelfStrategy,
    );
    expect(r.placements.get('b')).toMatchObject({ w: 40, h: 30 });
  });

  it("shades under minimize: 'icon' when there is no icon layer, and says so", () => {
    const traces = captureTrace('layout');
    const r = run([win('a', { x: 5, y: 5, minimized: true })], { minimize: 'icon' });
    expect(r.placements.get('a')).toEqual({ x: 5, y: 5, z: 1, w: 100, h: 28 });
    expect(traces.matching(/a minimized to an icon with no icon layer/)).toHaveLength(1);
  });
});

describe('desktopStrategy icons', () => {
  const icon = (id: string): LayoutItem => ({ id, meta: { icon: true } });

  it('tiles icons with the inner strategy at depth zero, under every window', () => {
    const r = run([win('w', { x: 0, y: 0 }), icon('i1'), icon('i2')], { cols: 2 }, gridStrategy);
    expect(r.placements.get('i1')).toMatchObject({ x: 0, y: 0, z: 0, w: 200, h: 300 });
    expect(r.placements.get('i2')).toMatchObject({ x: 200, z: 0 });
    expect(r.placements.get('w')?.z).toBe(1);
  });

  it('leaves icons unplaced when there is no inner strategy', () => {
    const r = run([icon('i1'), win('w', { x: 0, y: 0 })]);
    expect(r.unplaced).toEqual(['i1']);
    expect(r.placements.get('w')?.z).toBe(1);
  });

  it("passes the inner strategy's affordances through", () => {
    const r = run([icon('i1'), icon('i2')], { cols: 2, resizable: true }, gridStrategy);
    expect(r.affordances.length).toBeGreaterThan(0);
  });

  it("combines the inner strategy's overflow with the windows' by maximum", () => {
    const tall: LayoutItem = {
      id: 'i',
      meta: { icon: true },
      hints: { preferredSize: { w: 10, h: 500 } },
    };
    const r = run([tall, win('w', { x: 380, y: 0 })], {}, shelfStrategy);
    expect(r.overflow).toEqual({ w: 80, h: 200 });
  });

  it('asks the inner strategy whether it accepts, over the icon layer only', () => {
    const seen: string[][] = [];
    const inner = {
      ...shelfStrategy,
      canAccept: (items: LayoutItem[]) => {
        seen.push(items.map((i) => i.id));
        return false;
      },
    };
    const s = desktopStrategy(inner);
    expect(s.canAccept?.([win('w'), icon('i')], {})).toBe(false);
    expect(seen).toEqual([['i']]);
    expect(desktopStrategy().canAccept?.([win('w')], {})).toBe(true);
  });
});

describe('desktopStrategy config', () => {
  it("declares its own keys alongside the inner strategy's", () => {
    const spec = desktopStrategy(shelfStrategy).configSpec ?? {};
    expect(spec).toMatchObject({
      minimize: ['shade', 'icon'],
      shadeHeight: 'number',
      iconWidth: 'number',
      iconHeight: 'number',
      cascade: 'number',
      raise: ['click', 'focus'],
      gap: 'number',
    });
  });

  it('names itself after what it wraps', () => {
    expect(desktopStrategy().name).toBe('desktop');
    expect(desktopStrategy(gridStrategy).name).toBe('desktop(grid)');
  });
});
