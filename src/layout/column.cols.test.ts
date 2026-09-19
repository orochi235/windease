import { describe, expect, it } from 'vitest';
import { runPack, sized } from '../test-utils/pack-contract.js';
import { columnStrategy } from './column.js';
import { checkStrategyConfig } from './config-check.js';

const xs = (r: ReturnType<typeof runPack>) => [...r.placements.values()].map((p) => p.x);
const problems = (config: Record<string, unknown>) =>
  checkStrategyConfig(
    'column',
    config,
    columnStrategy.configSpec ?? {},
    columnStrategy.configConflicts,
  );

describe('columnStrategy cols', () => {
  it('sets the column count and widens the columns to fill the container', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => sized(id, 100, 10));
    const r = runPack(columnStrategy, items, { w: 1000, h: 500 }, { cols: 3, gap: 20 });
    // (1000 − 2·20) / 3 = 320 wide, so a pitch of 340.
    expect(xs(r)).toEqual([0, 340, 680, 0]);
    expect(r.placements.get('d')).toMatchObject({ y: 30 });
  });

  it('keeps each item at its own size inside its column', () => {
    const r = runPack(columnStrategy, [sized('a', 100, 10)], { w: 1000, h: 500 }, { cols: 3 });
    expect(r.placements.get('a')).toEqual({ x: 0, y: 0, z: 0, w: 100, h: 10 });
  });

  it('spans an item wider than one fluid column across as many as it needs', () => {
    const items = [sized('wide', 150, 40), sized('n', 100, 10)];
    const r = runPack(columnStrategy, items, { w: 400, h: 500 }, { cols: 4 });
    expect(r.placements.get('n')).toMatchObject({ x: 200, y: 0 });
  });

  it('fills the width exactly with columns of a third despite float drift', () => {
    const items = ['a', 'b', 'c'].map((id) => sized(id, 1000 / 3, 10));
    const r = runPack(columnStrategy, items, { w: 1000, h: 500 }, { cols: 3 });
    expect([...r.placements.values()].map((p) => p.y)).toEqual([0, 0, 0]);
    expect(r.overflow).toBeUndefined();
  });

  it('ignores a column count below one', () => {
    const items = [sized('a', 100, 10), sized('b', 100, 10)];
    const plain = runPack(columnStrategy, items, { w: 300, h: 500 });
    for (const cols of [0, -2, Number.NaN]) {
      expect(runPack(columnStrategy, items, { w: 300, h: 500 }, { cols })).toEqual(plain);
    }
  });

  it('places without NaN in a container too narrow for its gaps', () => {
    const items = [sized('a', 10, 10), sized('b', 10, 10)];
    const r = runPack(columnStrategy, items, { w: 0, h: 500 }, { cols: 3, gap: 8 });
    for (const rect of r.placements.values()) {
      expect(Number.isFinite(rect.x) && Number.isFinite(rect.y)).toBe(true);
    }
  });

  it('is mutually exclusive with columnWidth, and makes justify do nothing', () => {
    expect(problems({ cols: 3, columnWidth: 100 })).toEqual([
      "column: config 'cols' and 'columnWidth' are mutually exclusive — set one",
    ]);
    expect(problems({ cols: 3, justify: 'center' })).toEqual([
      "column: config 'justify' is ignored when 'cols' is set",
    ]);
    expect(problems({ cols: 3, justify: 'center', gap: 4, sort: 'area' }).length).toBe(1);
    expect(problems({ columnWidth: 100, justify: 'end' })).toEqual([]);
  });
});

describe('columnStrategy justify', () => {
  const items = ['a', 'b', 'c'].map((id) => sized(id, 100, 10));
  const at = (justify?: string) =>
    xs(runPack(columnStrategy, items, { w: 350, h: 500 }, { columnWidth: 100, justify }));

  it('packs the columns at the start by default', () => {
    expect(at()).toEqual([0, 100, 200]);
    expect(at('start')).toEqual([0, 100, 200]);
  });

  it('centers the columns, or pushes them to the end, in the width they leave', () => {
    expect(at('center')).toEqual([25, 125, 225]);
    expect(at('end')).toEqual([50, 150, 250]);
  });

  it('centers the column grid, not the items, when there are fewer items than columns', () => {
    const r = runPack(
      columnStrategy,
      [sized('a', 100, 10)],
      { w: 350, h: 500 },
      {
        columnWidth: 100,
        justify: 'center',
      },
    );
    expect(r.placements.get('a')).toMatchObject({ x: 25 });
  });

  it('counts the gaps between columns in what they leave', () => {
    const r = runPack(
      columnStrategy,
      items,
      { w: 340, h: 500 },
      {
        columnWidth: 100,
        gap: 10,
        justify: 'center',
      },
    );
    // 3·100 + 2·10 = 320 of 340.
    expect(xs(r)).toEqual([10, 120, 230]);
  });

  it('keeps an item wider than every column inside the width', () => {
    const r = runPack(
      columnStrategy,
      [sized('a', 100, 10), sized('big', 330, 20)],
      {
        w: 350,
        h: 500,
      },
      { columnWidth: 100, justify: 'end' },
    );
    expect(r.placements.get('big')).toMatchObject({ x: 20 });
    expect(r.overflow).toBeUndefined();
  });

  it('puts an item wider than the container at the left edge', () => {
    const r = runPack(
      columnStrategy,
      [sized('a', 100, 10), sized('huge', 500, 20)],
      {
        w: 350,
        h: 500,
      },
      { columnWidth: 100, justify: 'center' },
    );
    expect(r.placements.get('huge')).toMatchObject({ x: 0 });
  });

  it('shifts the default narrowest-item columns too', () => {
    const r = runPack(columnStrategy, items, { w: 350, h: 500 }, { justify: 'center' });
    expect(xs(r)).toEqual([25, 125, 225]);
  });
});
