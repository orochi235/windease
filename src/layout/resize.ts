// src/layout/resize.ts

export interface ClampItem {
  id: string;
  /** Explicit user-intent size along the main axis, or undefined. */
  explicit: number | undefined;
  /** Minimum acceptable size along the main axis (0 if no hint). */
  min: number;
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
 *  2. Explicit items get their intent, then are scaled proportionally
 *     down until the leftover accommodates the unconstrained mins.
 *  3. Leftover after explicit items is distributed equally among
 *     unconstrained items (their min is honored as a floor).
 */
export function clampExplicitSizes(input: ClampInput): Map<string, number> {
  const out = new Map<string, number>();
  if (input.items.length === 0) return out;

  const explicits = input.items.filter((it) => it.explicit !== undefined);
  const unconstrained = input.items.filter((it) => it.explicit === undefined);
  const unconstrainedMinSum = unconstrained.reduce((s, it) => s + it.min, 0);
  const sumExplicit = explicits.reduce((s, it) => s + (it.explicit ?? 0), 0);

  // Budget available for explicit items: total minus what we MUST reserve
  // for unconstrained items' minimums.
  const explicitBudget = Math.max(0, input.available - unconstrainedMinSum);

  let scale = 1;
  if (sumExplicit > explicitBudget && sumExplicit > 0) {
    scale = explicitBudget / sumExplicit;
  }

  let usedByExplicit = 0;
  for (const it of explicits) {
    const v = (it.explicit ?? 0) * scale;
    out.set(it.id, v);
    usedByExplicit += v;
  }

  const leftover = Math.max(0, input.available - usedByExplicit);
  if (unconstrained.length > 0) {
    const per = leftover / unconstrained.length;
    for (const it of unconstrained) {
      out.set(it.id, Math.max(it.min, per));
    }
  }

  return out;
}
