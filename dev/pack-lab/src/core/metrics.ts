import { aspectScore } from './fit.js';
import type { Packing, RunSpec } from './types.js';

export interface Metric {
  id: string;
  label: string;
  digits: number;
  value: (packing: Packing, spec: RunSpec, ms: number) => number;
}

export function fillPercent(packing: Packing): number {
  const { w, h } = packing.bounds;
  if (w <= 0 || h <= 0) return 0;
  let area = 0;
  for (const r of packing.placements.values()) area += r.w * r.h;
  return (area / (w * h)) * 100;
}

/**
 * The ratio a run is judged against, as `specFor` recorded it — reading the dataset's hint here
 * directly would ignore the "use hints" toggle for a width fit.
 */
export function targetRatio(spec: RunSpec): number {
  return spec.aspectTarget;
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

export const formatMetric = (metric: Metric, value: number): string =>
  Number.isFinite(value) ? value.toFixed(metric.digits) : '—';
