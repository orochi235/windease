import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../../layout-types.js';

/**
 * One layout lifted from real software: where it comes from, the container it
 * runs in, and the items and config that reproduce it. JSON-safe, so a story
 * and a test read the same fixture.
 */
export interface Scenario {
  id: string;
  /** The real product or corpus this reproduces, e.g. "Blender 4.x area splits". */
  source: string;
  /** What about it stresses the strategy, in one line. */
  stress: string;
  container: Size;
  items: LayoutItem[];
  options: Record<string, unknown>;
  /** Strategy state to lay out with; `initialState` when absent. */
  state?: unknown;
}

export function runScenario<TState>(
  strategy: LayoutStrategy<TState, string>,
  scenario: Pick<Scenario, 'items' | 'container' | 'options' | 'state'>,
): LayoutResult<string> {
  const state = (scenario.state ??
    strategy.initialState?.(scenario.items, scenario.options)) as TState;
  return strategy.layout({
    items: scenario.items,
    container: scenario.container,
    state,
    options: scenario.options,
  });
}

/** Ids whose rect holds a NaN, an infinity, or a negative extent. */
export function malformedRects(placements: Map<string, Rect>): string[] {
  const bad: string[] = [];
  for (const [id, r] of placements) {
    const values = [r.x, r.y, r.z, r.w, r.h];
    if (!values.every(Number.isFinite) || r.w < 0 || r.h < 0) bad.push(id);
  }
  return bad;
}

/** Pairs of same-z rects closer than `gap`, as `a/b`. Zero-area rects never collide. */
export function overlaps(placements: Map<string, Rect>, gap = 0): string[] {
  const entries = [...placements.entries()].filter(([, r]) => r.w > 0 && r.h > 0);
  const found: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i]!;
      const [idB, b] = entries[j]!;
      if (a.z !== b.z) continue;
      const apart =
        a.x + a.w + gap <= b.x + EPS ||
        b.x + b.w + gap <= a.x + EPS ||
        a.y + a.h + gap <= b.y + EPS ||
        b.y + b.h + gap <= a.y + EPS;
      if (!apart) found.push(`${idA}/${idB}`);
    }
  }
  return found;
}

/** Ids whose rect leaves `[0, container]` on either axis. */
export function outOfBounds(placements: Map<string, Rect>, container: Size): string[] {
  const out: string[] = [];
  for (const [id, r] of placements) {
    if (
      r.x < -EPS ||
      r.y < -EPS ||
      r.x + r.w > container.w + EPS ||
      r.y + r.h > container.h + EPS
    ) {
      out.push(id);
    }
  }
  return out;
}

/** Item ids the result neither placed nor listed as unplaced — silently dropped. */
export function dropped(items: LayoutItem[], result: LayoutResult<string>): string[] {
  const unplaced = new Set(result.unplaced ?? []);
  return items.map((i) => i.id).filter((id) => !result.placements.has(id) && !unplaced.has(id));
}

/** Tolerance for sub-pixel arithmetic; a layout off by less than this is not wrong. */
export const EPS = 1e-6;

/**
 * Deterministic PRNG (Lehmer / Park–Miller), so a generated corpus is the same
 * on every run and a failure names a reproducible seed.
 */
export function prng(seed: number): (lo: number, hi: number) => number {
  let s = seed % 2147483647 || 1;
  return (lo, hi) => {
    s = (s * 48271) % 2147483647;
    return lo + (s % (hi - lo + 1));
  };
}
