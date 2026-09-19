import { describe, expect, it } from 'vitest';
import { packerById } from './packers.js';
import { run, type Settings, specFor } from './run.js';
import type { Dataset } from './types.js';

const dataset: Dataset = {
  id: 'd',
  label: 'd',
  domain: 'test',
  items: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`,
    hints: { preferredSize: { w: 8, h: 3 + (i % 4) * 2 } },
  })),
  hint: { gap: 1, columnWidth: 8, aspect: 1.6 },
};

const settings: Settings = {
  fit: 'aspect',
  width: 400,
  aspect: 1,
  gap: 4,
  columnWidth: 0,
  useHints: true,
};

describe('specFor', () => {
  it("takes gap, column width and aspect from the dataset's hints when told to", () => {
    const spec = specFor(dataset, packerById('column'), settings);
    expect(spec.options).toEqual({ gap: 1, columnWidth: 8 });
    expect(spec.fit).toEqual({ kind: 'aspect', ratio: 1.6 });
  });

  it('passes a strategy only the options it declares', () => {
    expect(specFor(dataset, packerById('shelf'), settings).options).toEqual({ gap: 1 });
  });

  it('passes a sort other than none, and nothing for none', () => {
    expect(specFor(dataset, packerById('shelf'), { ...settings, sort: 'area' }).options).toEqual({
      gap: 1,
      sort: 'area',
    });
    expect(specFor(dataset, packerById('shelf'), { ...settings, sort: 'none' }).options).toEqual({
      gap: 1,
    });
  });

  it('passes rotate only when it is on', () => {
    expect(specFor(dataset, packerById('skyline'), { ...settings, rotate: true }).options).toEqual({
      gap: 1,
      rotate: true,
    });
    expect(specFor(dataset, packerById('skyline'), settings).options).toEqual({ gap: 1 });
  });

  it('uses its own settings when hints are off', () => {
    const spec = specFor(dataset, packerById('column'), {
      ...settings,
      useHints: false,
      fit: 'width',
    });
    expect(spec.options).toEqual({ gap: 4, columnWidth: 0 });
    expect(spec.fit).toEqual({ kind: 'width', width: 400 });
  });
});

describe('run', () => {
  it('returns the same placements and metrics every time, apart from time', () => {
    const spec = specFor(dataset, packerById('skyline'), settings);
    const a = run(spec);
    const b = run(spec);
    expect(b.placements).toEqual(a.placements);
    expect({ ...b.metrics, ms: 0 }).toEqual({ ...a.metrics, ms: 0 });
    expect(Object.keys(a.metrics)).toEqual([
      'width',
      'height',
      'fill',
      'aspect',
      'unplaced',
      'moved',
      'refill',
      'ms',
    ]);
    expect(a.placements.size).toBe(12);
    expect(a.metrics.width).toBe(a.bounds.w);
    expect(a.metrics.height).toBe(a.bounds.h);
    expect(a.metrics.unplaced).toBe(0);
    expect(a.metrics.fill).toBeGreaterThan(0);
  });
});

describe('specFor with an order only the engine has', () => {
  it('passes it to an engine packer and leaves a shipped one in dataset order', () => {
    const ordered = { ...settings, sort: 'perimeter' as const };
    expect(specFor(dataset, packerById('engine:skyline'), ordered).options.sort).toBe('perimeter');
    expect(specFor(dataset, packerById('skyline'), ordered).options.sort).toBeUndefined();
  });
});
