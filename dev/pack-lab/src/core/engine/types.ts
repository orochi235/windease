import type { LayoutItem, Rect, Size } from '#windease/layout-types.js';

/** One way to place an item: its own size, or turned a quarter with `w` and `h` swapped. */
export interface Turn {
  w: number;
  h: number;
  turned: boolean;
}

/** A spot a tracker offers for one turn of an item. `extra` holds the tracker's own features
 *  and whatever it needs back at commit. */
export interface Candidate {
  x: number;
  y: number;
  turn: Turn;
  extra: Record<string, number>;
}

/** Features the engine computes for every candidate, whatever the tracker. */
export const COMMON_FEATURES = [
  'x',
  'y',
  'bottom',
  'right',
  'peak',
  'overWidth',
  'turned',
  'drift',
] as const;

/** Holds the free space of one packing pass and lists where an item could go. */
export interface Tracker {
  /** Legal spots for `turns`, in tie order: the engine keeps the first of equal scores. */
  candidates(turns: readonly Turn[]): Candidate[];
  commit(candidate: Candidate): void;
}

/** What a tracker is built from: the run's settings and the sized queue it will place. */
export interface TrackerInput {
  container: Size;
  gap: number;
  options: Record<string, unknown>;
  sizes: readonly Size[];
}

export interface TrackerDef {
  id: string;
  /** Features this tracker adds to {@link COMMON_FEATURES}. */
  features: readonly string[];
  /** Option keys it reads beyond the engine's own. */
  configSpec: Record<string, 'number' | readonly string[]>;
  create(input: TrackerInput): Tracker;
}

/** Feature weights. A candidate's score in a tier is `Σ weight × feature`. */
export type Tier = Record<string, number>;

/**
 * A configuration of the engine: which tracker holds the free space, and how candidates are
 * ranked — tier by tier, a later tier deciding only among candidates tied on every earlier one.
 * Order, rotation, gap and bounds are run options, as they are for the shipped packers.
 */
export interface Recipe {
  id: string;
  tracker: string;
  tiers: readonly Tier[];
}

/** One pass's output, before it is wrapped as a `LayoutResult`. */
export interface EnginePass {
  placed: Map<string, Rect>;
  turned: Set<string>;
}

export interface EngineInput {
  items: readonly LayoutItem[];
  container: Size;
  options: Record<string, unknown>;
  /** Where each item sat last pass, read by the `drift` feature. */
  previous?: ReadonlyMap<string, Rect>;
}
