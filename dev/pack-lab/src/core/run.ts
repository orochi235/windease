import { fitPacking } from './fit.js';
import { METRICS } from './metrics.js';
import { optionKeys } from './packers.js';
import type { Dataset, Fit, Packer, Run, RunSpec } from './types.js';

/** The container and packer settings every instrument's config carries. */
export interface Settings {
  fit: 'width' | 'aspect';
  width: number;
  aspect: number;
  gap: number;
  columnWidth: number;
  /** Take gap, column width and aspect from the dataset where it has them. */
  useHints: boolean;
}

export function specFor(dataset: Dataset, packer: Packer, settings: Settings): RunSpec {
  const hint = settings.useHints ? (dataset.hint ?? {}) : {};
  const all: Record<string, unknown> = {
    gap: hint.gap ?? settings.gap,
    columnWidth: hint.columnWidth ?? settings.columnWidth,
  };
  const accepted = new Set(optionKeys(packer));
  const options = Object.fromEntries(Object.entries(all).filter(([key]) => accepted.has(key)));
  const aspectTarget = hint.aspect ?? settings.aspect;
  const fit: Fit =
    settings.fit === 'width'
      ? { kind: 'width', width: settings.width }
      : { kind: 'aspect', ratio: aspectTarget };
  return { dataset, packer, fit, options, aspectTarget };
}

export function run(spec: RunSpec): Run {
  const start = performance.now();
  const packing = fitPacking(spec.packer, spec.dataset.items, spec.fit, spec.options);
  const ms = performance.now() - start;
  const metrics = Object.fromEntries(METRICS.map((m) => [m.id, m.value(packing, spec, ms)]));
  return { ...spec, ...packing, ms, metrics };
}
