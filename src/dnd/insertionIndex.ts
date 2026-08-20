export interface RectYBounds {
  top: number;
  bottom: number;
}
export interface RectXBounds {
  left: number;
  right: number;
}

/**
 * Compute a 0-based insertion index based on which child midpoint the cursor
 * has passed along the main axis. The returned value is in [0, rects.length].
 *
 * Use with `axis: 'y'` for vertical stacks; `axis: 'x'` for horizontal strips.
 */
export function insertionIndexByMidpoint(
  rects: ReadonlyArray<RectYBounds | RectXBounds>,
  cursorMain: number,
  axis: 'x' | 'y',
): number {
  if (rects.length === 0) return 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const mid =
      axis === 'y'
        ? ((r as RectYBounds).top + (r as RectYBounds).bottom) / 2
        : ((r as RectXBounds).left + (r as RectXBounds).right) / 2;
    if (cursorMain < mid) return i;
  }
  return rects.length;
}

/**
 * Given a container element, return DOMRects (in viewport coords) for each
 * direct child carrying a `data-node` attribute, in DOM order. Used by the
 * default `getInsertionIndex` wiring in `<Container>`.
 */
export function childRectsForContainer(container: Element): { id: string; rect: DOMRect }[] {
  const out: { id: string; rect: DOMRect }[] = [];
  const kids = container.querySelectorAll('[data-node]');
  for (const k of Array.from(kids)) {
    // Skip nested data-node nodes that aren't direct chrome children.
    if (
      k.parentElement?.getAttribute('data-node-container') !==
      container.getAttribute('data-node-container')
    ) {
      continue;
    }
    const id = k.getAttribute('data-node');
    if (!id) continue;
    out.push({ id, rect: k.getBoundingClientRect() });
  }
  return out;
}
