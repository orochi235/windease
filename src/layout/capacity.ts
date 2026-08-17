// src/layout/capacity.ts

import type { LayoutItem } from '../layout-types.js';

export interface CapacitySelection {
  placed: LayoutItem[];
  unplaced: string[];
}

/**
 * Select which items survive when a container is over capacity.
 *
 * Rules:
 *  1. Pinned items (`meta.pinned` set to a number — a legacy boolean `true`
 *     does not count) win the capacity race and survive first, in
 *     childOrder.
 *  2. Unpinned items fill any remaining slots, also in childOrder.
 *  3. Pinning cannot expand capacity: once `capacity` survivors are chosen,
 *     later items overflow regardless of pin status.
 *  4. `placed` preserves original `items` order — selection decides who
 *     survives, not layout order.
 */
export function selectByCapacity(items: LayoutItem[], capacity: number): CapacitySelection {
  const isPinned = (it: LayoutItem) => typeof it.meta?.pinned === 'number';
  const keep = new Set<string>();
  for (const it of items) if (isPinned(it) && keep.size < capacity) keep.add(it.id);
  for (const it of items) if (!keep.has(it.id) && keep.size < capacity) keep.add(it.id);

  const placed: LayoutItem[] = [];
  const unplaced: string[] = [];
  for (const it of items) {
    if (keep.has(it.id)) placed.push(it);
    else unplaced.push(it.id);
  }
  return { placed, unplaced };
}
