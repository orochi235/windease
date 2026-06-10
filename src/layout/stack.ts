import type {
  Affordance,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import { clampExplicitSizes } from './resize.js';


interface StackConfig {
  gap?: number;
  padding?: number;
  /**
   * When true (default), items without preferredSize.h share any leftover
   * vertical space. When false, hintless items use defaultItemSize (or 0).
   */
  fill?: boolean;
  /**
   * Height assigned to items without preferredSize.h when fill=false.
   * Defaults to 0. Ignored when fill=true (leftover-sharing wins).
   */
  defaultItemSize?: number;
  /**
   * When true (default), trailing-edge resize affordances are emitted on
   * every non-last child. Consumers can set false to disable.
   */
  resizable?: boolean;
  /**
   * Absolute cap on the number of items the zone accepts. Items beyond this
   * count go to `unplaced` and the default `canAccept` rejects drops that
   * would overflow it.
   */
  maxItems?: number;
}

function explicitH(item: LayoutItem): number | undefined {
  const size = (item as unknown as { placement?: { size?: { h?: number } } })
    .placement?.size?.h;
  return typeof size === 'number' ? size : undefined;
}

function effectiveMin(item: LayoutItem): number {
  return item.hints?.minSize?.h ?? 0;
}

function effectiveMax(item: LayoutItem): number | undefined {
  const m = (item as unknown as { hints?: { maxSize?: { h?: number } } }).hints
    ?.maxSize?.h;
  return typeof m === 'number' ? m : undefined;
}

/** @group Strategies */
export const stackStrategy: LayoutStrategy<void, string> = {
  name: 'stack',
  canAccept(items, options): boolean {
    const cap = (options as StackConfig).maxItems;
    if (cap === undefined) return true;
    return items.length <= Math.max(1, cap);
  },
  layout({
    items,
    container,
    options,
    preview,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string> {
    const cfg = options as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const resizable = cfg.resizable ?? true;

    const placements = new Map<string, Rect>();
    const affordances: Affordance[] = [];
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const itemCap =
      cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;
    const placedCount = Math.min(items.length, itemCap);
    const placedItems = items.slice(0, placedCount);

    const colX = padding;
    const colW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding - gap * (placedCount - 1);

    // If any child has explicit placement.size.h, use the clamp helper for the
    // whole row. Otherwise fall back to the existing preferredSize/fill path.
    const hasExplicit = placedItems.some((it) => explicitH(it) !== undefined);
    let heights: number[];
    if (hasExplicit) {
      const clamp = clampExplicitSizes({
        available: usableH,
        items: placedItems.map((it) => ({
          id: it.id,
          explicit: explicitH(it),
          min: effectiveMin(it),
        })),
      });
      heights = placedItems.map((it) => clamp.get(it.id) ?? 0);
    } else {
      const fill = cfg.fill ?? true;
      const defaultItemSize = cfg.defaultItemSize ?? 0;
      const preferredH = placedItems.map((item) => item.hints?.preferredSize?.h ?? 0);
      const totalPreferred = preferredH.reduce((sum, h) => sum + h, 0);
      const flexCount = preferredH.filter((h) => h === 0).length;
      const flexH =
        fill && flexCount > 0 ? Math.max(0, (usableH - totalPreferred) / flexCount) : 0;
      const fallbackH = fill ? flexH : defaultItemSize;
      heights = preferredH.map((h) => (h > 0 ? h : fallbackH));
    }

    let y = padding;
    for (let i = 0; i < placedCount; i++) {
      const item = placedItems[i]!;
      const h = heights[i]!;
      placements.set(item.id, { x: colX, y, w: colW, h });
      // Trailing-edge resize affordance, except on the last placed child.
      if (resizable && i < placedCount - 1) {
        affordances.push({
          id: `resize-y-${item.id}`,
          kind: 'resize-y',
          rect: { x: colX, y: y + h - 2, w: colW, h: 4 },
          cursor: 'ns-resize',
          childId: item.id,
        });
      }
      y += h + gap;
    }
    const unplaced: string[] = [];
    for (let i = placedCount; i < items.length; i++) {
      unplaced.push(items[i]!.id);
    }
    const result: LayoutResult<string> = { placements, affordances };
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (preview) result.isPreview = true;
    return result;
  },
  dispatchAffordance({ event, affordance, store, items, container, options }) {
    if (event.kind !== 'drag') return;
    if (affordance.kind !== 'resize-y') return;
    const childId = affordance.childId;
    if (!childId) return;
    const dy = event.payload.dy ?? 0;
    if (dy === 0) return;
    const item = items.find((it) => it.id === childId);
    if (!item) return;

    const current = explicitH(item);
    const cfg = options as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const usableH = container.h - 2 * padding - gap * (items.length - 1);

    // Base = current explicit (intent) if present, else what the strategy
    // would have laid out for this child (equal share among unconstrained).
    let base = current;
    if (base === undefined) {
      const explicits = items.filter((it) => explicitH(it) !== undefined);
      const explicitSum = explicits.reduce((s, it) => s + (explicitH(it) ?? 0), 0);
      const unconstrainedCount = items.length - explicits.length;
      base =
        unconstrainedCount > 0
          ? Math.max(0, (usableH - explicitSum) / unconstrainedCount)
          : 0;
    }

    let next = base + dy;
    const min = effectiveMin(item);
    const max = effectiveMax(item);
    if (next < min) next = min;
    if (max !== undefined && next > max) next = max;
    // Clamp to leave at least sum(min) for everyone else.
    const otherMinSum = items
      .filter((it) => it.id !== childId)
      .reduce((s, it) => s + effectiveMin(it), 0);
    const ceiling = usableH - otherMinSum;
    if (next > ceiling) next = ceiling;

    const node = (
      store as unknown as {
        getNode: (id: string) =>
          | { slot?: { placement?: Record<string, unknown> } }
          | undefined;
      }
    ).getNode(childId as string);
    const existingSize = (node?.slot?.placement?.size ?? {}) as {
      w?: number;
      h?: number;
    };
    (
      store as unknown as {
        patchPlacement: (id: string, patch: Record<string, unknown>) => void;
      }
    ).patchPlacement(childId as string, { size: { ...existingSize, h: next } });
  },
};
