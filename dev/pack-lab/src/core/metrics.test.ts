import { describe, expect, it } from 'vitest';
import { packAt } from './fit.js';
import { fillPercent, formatMetric, METRICS, targetRatio } from './metrics.js';
import { packerById } from './packers.js';
import type { Dataset, RunSpec } from './types.js';

const tens = (...ids: string[]) =>
  ids.map((id) => ({ id, hints: { preferredSize: { w: 10, h: 10 } } }));
const dataset: Dataset = { id: 'd', label: 'd', domain: 'test', items: [], hint: { aspect: 2 } };
const spec = (fit: RunSpec['fit']): RunSpec => ({
  dataset,
  packer: packerById('shelf'),
  fit,
  options: {},
});

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
  it("is the fit's ratio for an aspect fit, else the dataset's", () => {
    expect(targetRatio(spec({ kind: 'aspect', ratio: 3 }))).toBe(3);
    expect(targetRatio(spec({ kind: 'width', width: 100 }))).toBe(2);
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
