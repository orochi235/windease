import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { checkStrategyConfig } from './config-check.js';
import { stackBands, stackStrategy } from './stack.js';

const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const container = { w: 400, h: 300 };
const run = (options: Record<string, unknown>, over: LayoutItem[] = items) =>
  stackStrategy.layout({ items: over, container, state: undefined as void, options });

describe('stack side', () => {
  it('puts the band on top by default, the body under it', () => {
    const r = run({ activeId: 'a', headerSize: 30 });
    expect(r.placements.get('a')).toEqual({ x: 0, y: 30, z: 0, w: 400, h: 270 });
    expect(r.channels?.get('a')).toEqual({ bandX: 0, bandY: 0, bandW: 400, bandH: 30 });
  });

  it('puts the band at the bottom and the body above it', () => {
    const r = run({ activeId: 'a', headerSize: 30, side: 'bottom', padding: 4 });
    expect(r.placements.get('a')).toEqual({ x: 4, y: 4, z: 0, w: 392, h: 262 });
    expect(r.channels?.get('a')).toEqual({ bandX: 0, bandY: 270, bandW: 400, bandH: 30 });
  });

  it('puts the band down the left edge and the body to its right', () => {
    const r = run({ activeId: 'a', headerSize: 90, side: 'left' });
    expect(r.placements.get('a')).toEqual({ x: 90, y: 0, z: 0, w: 310, h: 300 });
    expect(r.channels?.get('a')).toEqual({ bandX: 0, bandY: 0, bandW: 90, bandH: 300 });
  });

  it('puts the band down the right edge and the body to its left', () => {
    const r = run({ activeId: 'a', headerSize: 90, side: 'right', padding: 2 });
    expect(r.placements.get('a')).toEqual({ x: 2, y: 2, z: 0, w: 306, h: 296 });
    expect(r.channels?.get('a')).toEqual({ bandX: 310, bandY: 0, bandW: 90, bandH: 300 });
  });

  it('reports the band to every child, withheld ones included', () => {
    const r = run({ activeId: 'b', headerSize: 30 });
    expect([...(r.channels?.keys() ?? [])]).toEqual(['a', 'b', 'c']);
  });

  it('emits no channels when there is no band', () => {
    expect(run({ activeId: 'a' }).channels).toBeUndefined();
  });

  it('never lets a band outgrow the container', () => {
    const r = run({ activeId: 'a', headerSize: 900, side: 'bottom' });
    expect(r.channels?.get('a')).toMatchObject({ bandY: 0, bandH: 300 });
    expect(r.placements.get('a')).toMatchObject({ h: 0 });
  });
});

describe("stack tabs: 'stacked'", () => {
  it('makes the band one tabSize per child, whatever headerSize says', () => {
    const r = run({ activeId: 'b', tabs: 'stacked', tabSize: 20, headerSize: 99 });
    expect(r.placements.get('b')).toEqual({ x: 0, y: 60, z: 0, w: 400, h: 240 });
  });

  it('gives each child its own title bar, in child order', () => {
    const r = run({ activeId: 'b', tabs: 'stacked', tabSize: 20 });
    expect(r.channels?.get('a')).toMatchObject({ tabX: 0, tabY: 0, tabW: 400, tabH: 20 });
    expect(r.channels?.get('b')).toMatchObject({ tabY: 20 });
    expect(r.channels?.get('c')).toMatchObject({ tabY: 40, bandH: 60 });
  });

  it('grows the band as children arrive', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` }));
    const r = run({ tabs: 'stacked', tabSize: 20 }, five);
    expect(r.placements.get('t0')).toMatchObject({ y: 100, h: 200 });
  });

  it('falls back to headerSize for the bar thickness', () => {
    const r = run({ tabs: 'stacked', headerSize: 25 });
    expect(r.placements.get('a')).toMatchObject({ y: 75 });
  });

  it('stacks bars side by side on a left band', () => {
    const r = run({ tabs: 'stacked', tabSize: 24, side: 'left' });
    expect(r.placements.get('a')).toEqual({ x: 72, y: 0, z: 0, w: 328, h: 300 });
    expect(r.channels?.get('c')).toMatchObject({ tabX: 48, tabY: 0, tabW: 24, tabH: 300 });
  });

  it('stacks bars downward inside a bottom band', () => {
    const r = run({ tabs: 'stacked', tabSize: 20, side: 'bottom' });
    expect(r.placements.get('a')).toMatchObject({ y: 0, h: 240 });
    expect(r.channels?.get('a')).toMatchObject({ tabY: 240 });
    expect(r.channels?.get('c')).toMatchObject({ tabY: 280 });
  });

  it('still lets a zoomed child cover the band', () => {
    const r = run({ tabs: 'stacked', tabSize: 20, zoom: 'c' });
    expect(r.placements.get('c')).toEqual({ x: 0, y: 0, z: 0, w: 400, h: 300 });
  });

  it("'strip' reserves headerSize and ignores tabSize", () => {
    const r = run({ tabs: 'strip', headerSize: 30, tabSize: 20 });
    expect(r.placements.get('a')).toMatchObject({ y: 30 });
    expect(r.channels?.get('a')).not.toHaveProperty('tabY');
  });
});

describe('stackBands', () => {
  it('returns the body the layout places', () => {
    const opts = { tabs: 'stacked', tabSize: 20, side: 'right', padding: 3 };
    const { body, bars } = stackBands(opts, container, 3);
    expect(run(opts).placements.get('a')).toEqual(body);
    expect(bars).toHaveLength(3);
  });
});

describe('stack config', () => {
  it('reports a misspelled side or tabs value', () => {
    const problems = checkStrategyConfig(
      'stack',
      { side: 'up', tabs: 'stack' },
      stackStrategy.configSpec!,
    );
    expect(problems).toHaveLength(2);
  });
});
