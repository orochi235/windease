// src/layout/resize.ts

export interface ClampItem {
  id: string;
  /** Explicit user-intent size along the main axis, or undefined. */
  explicit: number | undefined;
  /** Minimum acceptable size along the main axis (0 if no hint). */
  min: number;
  /** Maximum acceptable size along the main axis, or undefined for no ceiling. */
  max?: number | undefined;
  /** Positive fraction of what the explicit items leave. Ignored when
   *  `explicit` is set. */
  share?: number | undefined;
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
 * `minSize` floors an item that did not ask for a size. An explicit size is
 * the consumer's stated intent and is rendered as written, even below that
 * item's own min — which is what makes a deliberately undersized pane (a
 * collapsed palette shrunk to its header) expressible without a second piece
 * of state. `min` remains a hard floor on the *resize* path, so a gutter drag
 * still refuses to cross it; see `stripStrategy.dispatchAffordance`.
 *
 * Rules:
 *  1. Unconstrained items collectively need at least sum(min).
 *  2. Explicit items are capped at their own `max`, then scaled proportionally
 *     down until the leftover accommodates the unconstrained mins. An item
 *     that would scale below its floor freezes there and leaves the pool, so
 *     nothing collapses to zero under pressure. Space a cap frees up flows
 *     into the leftover pool rather than being lost.
 *  3. Shared items split the leftover after explicit items in proportion to
 *     their shares. With unconstrained items present a share is a fraction of
 *     that leftover (shares summing past 1 are normalized); without any, the
 *     shares are normalized to fill it. Each is floored at its min and capped
 *     at its max, then resolved like an explicit size: scaled down, floors
 *     frozen, until the unconstrained mins fit. The shared floors are reserved
 *     in step 2 alongside the unconstrained ones.
 *  4. Leftover after explicit and shared items is distributed equally among
 *     unconstrained items, within each one's `[min, max]`: an item whose
 *     bound binds takes it, and the others share the rest. So a larger floor
 *     is paid for by its siblings rather than overflowing a row that fits.
 */
export function clampExplicitSizes(input: ClampInput): Map<string, number> {
  const out = new Map<string, number>();
  if (input.items.length === 0) return out;

  const explicits = input.items.filter((it) => it.explicit !== undefined);
  const shared = input.items.filter((it) => it.explicit === undefined && it.share !== undefined);
  const unconstrained = input.items.filter(
    (it) => it.explicit === undefined && it.share === undefined,
  );
  const unconstrainedMinSum = unconstrained.reduce((s, it) => s + autoFloor(it), 0);
  const sharedMinSum = shared.reduce((s, it) => s + autoFloor(it), 0);

  const requested = new Map<string, number>();
  for (const it of explicits) {
    let v = it.explicit ?? 0;
    if (it.max !== undefined && v > it.max) v = it.max;
    requested.set(it.id, v);
  }

  // Budget available for explicit items: total minus what we MUST reserve
  // for the other items' minimums.
  const explicitBudget = Math.max(0, input.available - unconstrainedMinSum - sharedMinSum);
  // An item capped by a max below its min floors at that cap, preserving the
  // min-then-max resolution above.
  scaleInto(
    explicits,
    requested,
    (it) => Math.min(it.min, requested.get(it.id) ?? 0),
    explicitBudget,
    out,
  );

  let usedByExplicit = 0;
  for (const it of explicits) usedByExplicit += out.get(it.id) ?? 0;
  const afterExplicit = Math.max(0, input.available - usedByExplicit);

  let usedByShared = 0;
  if (shared.length > 0) {
    const total = shared.reduce((s, it) => s + (it.share ?? 0), 0);
    const denom = unconstrained.length > 0 ? Math.max(1, total) : total;
    for (const it of shared) {
      let v = denom > 0 ? ((it.share ?? 0) / denom) * afterExplicit : 0;
      if (it.max !== undefined && v > it.max) v = it.max;
      requested.set(it.id, Math.max(v, autoFloor(it)));
    }
    scaleInto(shared, requested, autoFloor, Math.max(0, afterExplicit - unconstrainedMinSum), out);
    for (const it of shared) usedByShared += out.get(it.id) ?? 0;
  }

  const leftover = Math.max(0, afterExplicit - usedByShared);
  const shares = shareLeftover(
    unconstrained.map((it) => ({ lo: autoFloor(it), hi: it.max ?? Number.POSITIVE_INFINITY })),
    leftover,
  );
  unconstrained.forEach((it, i) => {
    out.set(it.id, shares[i] ?? 0);
  });

  return out;
}

/**
 * Writes each item's `requested` extent into `out`, scaled down proportionally
 * when their sum exceeds `budget`. Proportional scaling alone drives items
 * under their floor, so an item whose scaled value would fall below it freezes
 * there and leaves the pool; the rest rescale against what's left.
 */
function scaleInto(
  items: readonly ClampItem[],
  requested: ReadonlyMap<string, number>,
  floorOf: (it: ClampItem) => number,
  budget: number,
  out: Map<string, number>,
): void {
  let pool = [...items];
  let frozenSum = 0;
  while (pool.length > 0) {
    const freeBudget = Math.max(0, budget - frozenSum);
    const poolSum = pool.reduce((s, it) => s + (requested.get(it.id) ?? 0), 0);
    const scale = poolSum > freeBudget && poolSum > 0 ? freeBudget / poolSum : 1;

    const violator = pool.find((it) => (requested.get(it.id) ?? 0) * scale < floorOf(it));
    if (!violator) {
      for (const it of pool) out.set(it.id, (requested.get(it.id) ?? 0) * scale);
      return;
    }
    const floor = floorOf(violator);
    out.set(violator.id, floor);
    frozenSum += floor;
    pool = pool.filter((it) => it.id !== violator.id);
  }
}

/** An unconstrained item's floor: its min, unless a max sits under it. */
function autoFloor(it: ClampItem): number {
  return it.max !== undefined && it.max < it.min ? it.max : it.min;
}

/**
 * Splits `total` equally across items bounded by `[lo, hi]`, so an item whose
 * bound binds takes that bound and the rest share what it leaves. Sums to
 * `total` whenever the bounds allow it; otherwise every item sits at the bound
 * that stopped it.
 */
export function shareLeftover(
  items: readonly { lo: number; hi: number }[],
  total: number,
): number[] {
  if (items.length === 0) return [];
  const clamp = (it: { lo: number; hi: number }, s: number) => Math.min(it.hi, Math.max(it.lo, s));
  const per = total / items.length;
  if (items.every((it) => it.lo <= per && per <= it.hi)) return items.map(() => per);

  // The sum at a common level `s` is piecewise linear in `s`, bending at each
  // bound; find the segment where it crosses `total` and solve inside it.
  const at = (s: number) => items.reduce((sum, it) => sum + clamp(it, s), 0);
  const points = [...new Set(items.flatMap((it) => [it.lo, it.hi]))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let level = points[0] ?? 0;
  if (at(level) < total) {
    // Binary search for the first bend at or past `total`; `at` is monotone.
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(points[mid]!) >= total) hi = mid;
      else lo = mid + 1;
    }
    const next = points[lo];
    const from = points[lo - 1]!;
    const slope = items.filter((it) => it.lo <= from && it.hi > from).length;
    level = slope > 0 ? from + (total - at(from)) / slope : from;
    if (next !== undefined && level > next) level = next;
  }
  return items.map((it) => clamp(it, level));
}
