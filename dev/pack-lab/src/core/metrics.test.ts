import { describe, expect, it } from 'vitest';
import { packAt } from './fit.js';
import { fillPercent, formatMetric, METRICS, targetRatio } from './metrics.js';
import { packerById } from './packers.js';
import { type Settings, specFor } from './run.js';
import type { Dataset } from './types.js';

const tens = (...ids: string[]) =>
  ids.map((id) => ({ id, hints: { preferredSize: { w: 10, h: 10 } } }));
const dataset: Dataset = { id: 'd', label: 'd', domain: 'test', items: [], hint: { aspect: 2 } };
const settings: Settings = {
  fit: 'width',
  width: 100,
  aspect: 5,
  gap: 0,
  columnWidth: 0,
  useHints: true,
};

describe('fillPercent', () => {
  it('is 100 when the boxes tile their bounds', () => {
    expect(fillPercent(packAt(packerById('shelf'), tens('a', 'b', 'c', 'd'), 20, {}))).toBe(100);
  });

  it('counts the gap between boxes as unfilled', () => {
    const packing = packAt(packerById('shelf'), tens('a', 'b'), 100, { gap: 10 });
    expect(fillPercent(packing)).toBeCloseTo((200 / 300) * 100);
  });
});

describe('targetRatio', () => {
  it('judges a width fit against the dataset when hints are on', () => {
    const spec = specFor(dataset, packerById('shelf'), settings);
    expect(targetRatio(spec)).toBe(2);
  });

  it("judges a width fit against the settings' aspect when hints are off", () => {
    const spec = specFor(dataset, packerById('shelf'), { ...settings, useHints: false });
    expect(targetRatio(spec)).toBe(5);
  });
});

describe('formatMetric', () => {
  it('prints every value in a column with the same number of decimals', () => {
    const fill = METRICS.find((m) => m.id === 'fill');
    if (!fill) throw new Error('no fill metric');
    expect(formatMetric(fill, 50)).toBe('50.0');
    expect(formatMetric(fill, Number.POSITIVE_INFINITY)).toBe('—');
  });
});
