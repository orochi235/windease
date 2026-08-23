import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stackStrategy } from './stack.js';

const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const container = { w: 400, h: 300 };
const run = (options: Record<string, unknown>, over: LayoutItem[] = items) =>
  stackStrategy.layout({ items: over, container, state: undefined as void, options });

describe('stackStrategy', () => {
  it('gives the active child the container less the header and padding', () => {
    expect(run({ activeId: 'b', headerSize: 30, padding: 4 }).placements.get('b')).toEqual({
      x: 4,
      y: 34,
      w: 392,
      h: 262,
    });
  });

  it('sends every inactive child to unplaced', () => {
    const r = run({ activeId: 'b', headerSize: 30 });
    expect(r.unplaced).toEqual(['a', 'c']);
    expect(r.placements.has('a')).toBe(false);
    expect(r.placements.has('c')).toBe(false);
  });

  it('falls back to the first child when activeId names one that has left', () => {
    const r = run({ activeId: 'gone', headerSize: 30 });
    expect(r.placements.has('a')).toBe(true);
    expect(r.unplaced).toEqual(['b', 'c']);
  });

  it('falls back to the first child when activeId is unset', () => {
    expect(run({ headerSize: 30 }).placements.has('a')).toBe(true);
  });

  it('places nothing and reports no unplaced for an empty container', () => {
    const r = run({}, []);
    expect(r.placements.size).toBe(0);
    expect(r.unplaced ?? []).toEqual([]);
  });

  it('reports no unplaced for a stack holding one child', () => {
    const r = run({ activeId: 'a' }, [{ id: 'a' }]);
    expect(r.unplaced ?? []).toEqual([]);
  });

  it('never gives the active child a negative extent', () => {
    const r = stackStrategy.layout({
      items,
      container: { w: 40, h: 10 },
      state: undefined as void,
      options: { activeId: 'a', headerSize: 30, padding: 8 },
    });
    const rect = r.placements.get('a')!;
    expect(rect.w).toBeGreaterThanOrEqual(0);
    expect(rect.h).toBeGreaterThanOrEqual(0);
  });

  it('emits no affordances — a stack has no seams', () => {
    expect(run({ activeId: 'a' }).affordances).toEqual([]);
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(stackStrategy.configSpec ?? {}).sort()).toEqual([
      'activeId',
      'headerSize',
      'padding',
    ]);
  });
});
