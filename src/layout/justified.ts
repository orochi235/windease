import type { LayoutItem, LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import { packGap, packResult, packSize } from './pack.js';

interface JustifiedConfig {
  rowHeight?: number;
  gap?: number;
  maxRowHeight?: number;
  justifyLast?: boolean;
}

const DEFAULT_ROW_HEIGHT = 200;

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** `hints.aspect`, else the measured or preferred size's width ÷ height. */
function aspectOf(item: LayoutItem): number | null {
  if (positive(item.hints?.aspect)) return item.hints.aspect;
  const size = packSize(item);
  return size ? size.w / size.h : null;
}

/**
 * Justified rows, the Flickr and Google Photos layout: each item keeps its
 * aspect, and each row is scaled so it fills the container's width exactly.
 * Row breaks are chosen together, minimizing the summed squared difference
 * between each row's height and `rowHeight`, so one awkward item does not
 * leave a row badly stretched the way a greedy fill can.
 *
 * The last row stays at `rowHeight`, ragged, unless `justifyLast` is set or it
 * is too wide to fit at that height. A row that would have to grow past
 * `maxRowHeight` to fill the width also stays ragged at `rowHeight`; a
 * `maxRowHeight` below `rowHeight` reads as `rowHeight`. Rows grow
 * down past `container.h`, and the excess is reported as `overflow`.
 *
 * Aspect is `hints.aspect`, else `natural` or `hints.preferredSize`; an item
 * with none goes to `unplaced`. Config takes `rowHeight` (default 200), `gap`,
 * `maxRowHeight` and `justifyLast`.
 * @group Strategies
 */
export const justifiedStrategy: LayoutStrategy<void, string> = {
  name: 'justified',
  configSpec: {
    rowHeight: 'number',
    gap: 'number',
    maxRowHeight: 'number',
    justifyLast: 'boolean',
  },
  layout({ items, container, options }): LayoutResult<string> {
    const cfg = options as JustifiedConfig;
    const gap = packGap(options);
    const target = positive(cfg.rowHeight) ? cfg.rowHeight : DEFAULT_ROW_HEIGHT;
    const maxRowHeight = positive(cfg.maxRowHeight)
      ? Math.max(cfg.maxRowHeight, target)
      : Number.POSITIVE_INFINITY;
    const justifyLast = cfg.justifyLast === true;
    const width = container.w;

    const unplaced: string[] = [];
    const ids: string[] = [];
    const aspects: number[] = [];
    for (const item of items) {
      const aspect = positive(width) ? aspectOf(item) : null;
      if (aspect === null) unplaced.push(item.id);
      else {
        ids.push(item.id);
        aspects.push(aspect);
      }
    }

    const n = aspects.length;
    const prefix = [0];
    for (const a of aspects) prefix.push(prefix[prefix.length - 1]! + a);
    /** Height that makes items `i..j-1` fill the width; `<= 0` when the gaps alone overfill it. */
    const fillHeight = (i: number, j: number) =>
      (width - gap * (j - i - 1)) / (prefix[j]! - prefix[i]!);
    const lastFits = (i: number) => target * (prefix[n]! - prefix[i]!) + gap * (n - i - 1) <= width;

    // cost[i] is the least deviation laying out items i..n-1; next[i] where row i ends.
    const cost = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const next = new Array<number>(n + 1).fill(n);
    cost[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j <= n; j++) {
        const h = fillHeight(i, j);
        if (j > i + 1 && h <= 0) break;
        const rowCost = j === n && !justifyLast && lastFits(i) ? 0 : (h - target) ** 2;
        const total = rowCost + cost[j]!;
        if (total < cost[i]!) {
          cost[i] = total;
          next[i] = j;
        }
        // Below the target, adding items only grows this row's cost, so once it
        // alone matches the best total no longer row can win.
        if (h < target && rowCost >= cost[i]!) break;
      }
    }

    const placements = new Map<string, Rect>();
    let y = 0;
    let rows = 0;
    let ragged = 0;
    for (let i = 0; i < n; i = next[i]!) {
      const j = next[i]!;
      const fill = fillHeight(i, j);
      const lastRow = j === n;
      const keepTarget = (lastRow && !justifyLast && lastFits(i)) || fill > maxRowHeight;
      const h = keepTarget ? target : fill;
      if (keepTarget) ragged++;
      let x = 0;
      for (let k = i; k < j; k++) {
        const w = !keepTarget && k === j - 1 ? width - x : aspects[k]! * h;
        placements.set(ids[k]!, { x, y, z: 0, w, h });
        x += w + gap;
      }
      y += h + gap;
      rows++;
    }

    const result = packResult(items, placements, container);
    trace(
      'layout',
      `justified: ${n} of ${items.length} in ${rows} rows (${ragged} ragged) at w=${width}, target ${target}, gap ${gap}`,
      { unplaced, overflow: result.overflow },
    );
    return result;
  },
};
