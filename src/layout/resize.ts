// src/layout/resize.ts

export interface ClampItem {
  id: string;
  /** Explicit user-intent size along the main axis, or undefined. */
  explicit: number | undefined;
  /** Minimum acceptable size along the main axis (0 if no hint). */
  min: number;
  /** Maximum acceptable size along the main axis, or undefined for no ceiling. */
  max?: number | undefined;
}

export interface ClampInput {
  /** Total main-axis extent available after subtracting padding + gaps. */
  available: number;
  items: readonly ClampItem[];
}

/**
 * Compute per-item main-axis extents given a mix of explicitly-sized and
 * unconstrained items.
 *
 * Rules:
 *  1. Unconstrained items collectively need at least sum(min).
 *  2. Explicit items are clamped to their own [min, max] first — a
 *     contradictory `min > max` resolves to `max`, matching
 *     `dispatchAffordance`'s clamp order — then scaled proportionally down
 *     until the leftover accommodates the unconstrained mins. Space a cap
 *     frees up flows into the leftover pool rather than being lost.
 *  3. Leftover after explicit items is distributed equally among
 *     unconstrained items (their min is honored as a floor).
 */
export function clampExplicitSizes(input: ClampInput): Map<string, number> {
  const out = new Map<string, number>();
  if (input.items.length === 0) return out;

  const explicits = input.items.filter((it) => it.explicit !== undefined);
  const unconstrained = input.items.filter((it) => it.explicit === undefined);
  const unconstrainedMinSum = unconstrained.reduce((s, it) => s + it.min, 0);

  const requested = new Map<string, number>();
  for (const it of explicits) {
    let v = it.explicit ?? 0;
    if (v < it.min) v = it.min;
    if (it.max !== undefined && v > it.max) v = it.max;
    requested.set(it.id, v);
  }

  // Budget available for explicit items: total minus what we MUST reserve
  // for unconstrained items' minimums.
  const explicitBudget = Math.max(0, input.available - unconstrainedMinSum);

  // Proportional scaling alone drives items under their own min, so an item
  // whose scaled value would fall below its floor freezes there and leaves the
  // pool; the rest rescale against what's left. An item capped by a max below
  // its min floors at that cap, preserving the min-then-max resolution above.
  const floorOf = (it: ClampItem): number => Math.min(it.min, requested.get(it.id) ?? 0);

  let pool = [...explicits];
  let frozenSum = 0;
  while (pool.length > 0) {
    const freeBudget = Math.max(0, explicitBudget - frozenSum);
    const poolSum = pool.reduce((s, it) => s + (requested.get(it.id) ?? 0), 0);
    const scale = poolSum > freeBudget && poolSum > 0 ? freeBudget / poolSum : 1;

    const violator = pool.find((it) => (requested.get(it.id) ?? 0) * scale < floorOf(it));
    if (!violator) {
      for (const it of pool) out.set(it.id, (requested.get(it.id) ?? 0) * scale);
      break;
    }
    const floor = floorOf(violator);
    out.set(violator.id, floor);
    frozenSum += floor;
    pool = pool.filter((it) => it.id !== violator.id);
  }

  let usedByExplicit = 0;
  for (const it of explicits) usedByExplicit += out.get(it.id) ?? 0;

  const leftover = Math.max(0, input.available - usedByExplicit);
  if (unconstrained.length > 0) {
    const per = leftover / unconstrained.length;
    for (const it of unconstrained) {
      out.set(it.id, Math.max(it.min, per));
    }
  }

  return out;
}
