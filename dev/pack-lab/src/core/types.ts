import type { LayoutItem, LayoutStrategy, Rect } from '#windease/layout-types.js';

/** What a dataset's source packed it with, so a run can reproduce that. */
export interface DatasetHint {
  gap?: number;
  columnWidth?: number;
  aspect?: number;
}

/** A named set of boxes to pack. */
export interface Dataset {
  id: string;
  label: string;
  domain: string;
  items: readonly LayoutItem[];
  hint?: DatasetHint;
}

export interface Packer {
  id: string;
  strategy: LayoutStrategy<void, string>;
}

/** How wide the container is: fixed, or searched for the shape closest to a ratio. */
export type Fit = { kind: 'width'; width: number } | { kind: 'aspect'; ratio: number };

export interface Packing {
  placements: ReadonlyMap<string, Rect>;
  unplaced: readonly string[];
  bounds: { w: number; h: number };
  /** The container width the packing ran at. */
  width: number;
}

export interface RunSpec {
  dataset: Dataset;
  packer: Packer;
  fit: Fit;
  options: Record<string, unknown>;
}

export interface Run extends RunSpec, Packing {
  ms: number;
  metrics: Record<string, number>;
}
