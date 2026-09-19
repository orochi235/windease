import type { LayoutItem, LayoutStrategy, Rect } from '#windease/layout-types.js';
import type { Recipe } from './engine/types.js';

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
  /** The engine recipe behind `strategy`, when it has one; the `moved` metric passes it the
   *  previous packing so `drift` has something to read. */
  recipe?: Recipe;
  /** Whether a new trial starts with this packer on. */
  on: boolean;
}

/** How wide the container is: fixed, or searched for the shape closest to a ratio. */
export type Fit =
  | {
      kind: 'width';
      width: number;
      /** A bin's height, which only a packer under `overflowMode: 'unplaced'` reads. */
      height?: number;
    }
  | { kind: 'aspect'; ratio: number };

export interface Packing {
  placements: ReadonlyMap<string, Rect>;
  unplaced: readonly string[];
  bounds: { w: number; h: number };
  /** The container width the packing ran at. */
  width: number;
  /** The container height it ran at: a bin's height, else 0. */
  height: number;
}

export interface RunSpec {
  dataset: Dataset;
  packer: Packer;
  fit: Fit;
  options: Record<string, unknown>;
  /** The aspect ratio the run is judged against — `specFor`'s call, not read back off the dataset. */
  aspectTarget: number;
}

export interface Run extends RunSpec, Packing {
  ms: number;
  metrics: Record<string, number>;
}
