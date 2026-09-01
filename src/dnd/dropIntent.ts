import type { ItemId, Rect } from '../layout-types.js';
import { insertionIndexByMidpoint } from './insertionIndex.js';

/** What kind of drop the cursor is asking for. */
export type DropIntent =
  | { kind: 'insert'; index: number }
  | { kind: 'stack'; ontoId: ItemId }
  /** `axis` is the strip axis of the group a split would create — the *cross*
   *  axis of the container that resolved this, not that container's own. */
  | { kind: 'split'; ontoId: ItemId; edge: 'start' | 'end'; axis: 'x' | 'y' };

/** Which restructuring intents a hit-test may return. Everything is off by
 *  default: both stacking and splitting reshape the tree. */
export interface DropIntentOptions {
  /** Carve a centre band that stacks onto the hovered child. */
  stack?: boolean;
  /** Carve cross-axis bands that split the hovered child. */
  split?: boolean;
  /** Band thickness as a fraction of the child's extent. Defaults to 0.25. */
  band?: number;
}

/** Largest band fraction that still leaves a centre, so no pane is ever too
 *  narrow to stack onto. */
const MAX_BAND = 0.49;
const DEFAULT_BAND = 0.25;

/**
 * Resolve what a drop at `cursor` is asking for, from the same child rects the
 * insertion index is computed over. Pure: the caller measures.
 *
 * Within the hovered child, bands along the main axis resolve to `insert` at
 * the neighbouring seam, bands along the cross axis to `split`, and the centre
 * to `stack`. Corners go to the main axis. Bands are carved only for the
 * intents `options` enables, so with none enabled this returns exactly what
 * `insertionIndexByMidpoint` returns for the same cursor.
 */
export function resolveDropIntent(
  rects: readonly { id: ItemId; rect: Rect }[],
  cursor: { x: number; y: number },
  axis: 'x' | 'y',
  options: DropIntentOptions = {},
): DropIntent {
  const bounds = rects.map((r) =>
    axis === 'x'
      ? { left: r.rect.x, right: r.rect.x + r.rect.w }
      : { top: r.rect.y, bottom: r.rect.y + r.rect.h },
  );
  const main = axis === 'x' ? cursor.x : cursor.y;
  const insert = (): DropIntent => ({
    kind: 'insert',
    index: insertionIndexByMidpoint(bounds, main, axis),
  });

  if (!options.stack && !options.split) return insert();

  const hit = rects.findIndex(
    (r) =>
      cursor.x >= r.rect.x &&
      cursor.x <= r.rect.x + r.rect.w &&
      cursor.y >= r.rect.y &&
      cursor.y <= r.rect.y + r.rect.h,
  );
  if (hit === -1) return insert();

  const { id, rect } = rects[hit]!;
  const band = Math.min(options.band ?? DEFAULT_BAND, MAX_BAND);
  const mainStart = axis === 'x' ? rect.x : rect.y;
  const mainExtent = axis === 'x' ? rect.w : rect.h;

  // Main axis wins the corners: an insert is the reversible answer, and a
  // gesture that reaches a corner was usually aiming at the seam.
  const mainOffset = main - mainStart;
  if (mainOffset < mainExtent * band) return { kind: 'insert', index: hit };
  if (mainOffset > mainExtent * (1 - band)) return { kind: 'insert', index: hit + 1 };

  if (options.split) {
    const cross: 'x' | 'y' = axis === 'x' ? 'y' : 'x';
    const crossPos = axis === 'x' ? cursor.y : cursor.x;
    const crossStart = axis === 'x' ? rect.y : rect.x;
    const crossExtent = axis === 'x' ? rect.h : rect.w;
    const crossOffset = crossPos - crossStart;
    if (crossOffset < crossExtent * band) {
      return { kind: 'split', ontoId: id, edge: 'start', axis: cross };
    }
    if (crossOffset > crossExtent * (1 - band)) {
      return { kind: 'split', ontoId: id, edge: 'end', axis: cross };
    }
  }

  if (options.stack) return { kind: 'stack', ontoId: id };
  return insert();
}
