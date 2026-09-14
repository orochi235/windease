import { aspectScore } from './fit.js';
import type { Packing, RunSpec } from './types.js';

export interface Metric {
  id: string;
  label: string;
  /** Decimal places the table prints, the same for every row. */
  digits: number;
  value: (packing: Packing, spec: RunSpec, ms: number) => number;
}

/** Placed box area as a percentage of the bounds' area. */
export function fillPercent(packing: Packing): number {
  const { w, h } = packing.bounds;
  if (w <= 0 || h <= 0) return 0;
  let area = 0;
  for (const r of packing.placements.values()) area += r.w * r.h;
  return (area / (w * h)) * 100;
}

/** The ratio a run is judged against: its fit's, else its dataset's, else square. */
export function targetRatio(spec: RunSpec): number {
  return spec.fit.kind === 'aspect' ? spec.fit.ratio : (spec.dataset.hint?.aspect ?? 1);
}

export const METRICS: readonly Metric[] = [
  { id: 'width', label: 'width', digits: 1, value: (p) => p.bounds.w },
  { id: 'height', label: 'height', digits: 1, value: (p) => p.bounds.h },
  { id: 'fill', label: 'fill %', digits: 1, value: (p) => fillPercent(p) },
  {
    id: 'aspect',
    label: 'aspect error',
    digits: 3,
    value: (p, spec) => aspectScore(p, targetRatio(spec)),
  },
  { id: 'unplaced', label: 'unplaced', digits: 0, value: (p) => p.unplaced.length },
  { id: 'ms', label: 'ms', digits: 2, value: (_p, _spec, ms) => ms },
];

/** A metric's value as the table prints it. */
export const formatMetric = (metric: Metric, value: number): string =>
  Number.isFinite(value) ? value.toFixed(metric.digits) : '—';
