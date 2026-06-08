import type {
  Affordance,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import { clampExplicitSizes } from './resize.js';


interface StripConfig {
  axis?: 'x' | 'y';
  gap?: number;
  padding?: number;
  /**
   * When true, items without a preferredSize along the main axis share any
   * leftover space. When false (default), hintless items use defaultItemSize.
   */
  fill?: boolean;
  /**
   * Main-axis size assigned to items without preferredSize when fill=false.
   * Defaults to 0. Ignored when fill=true.
   */
  defaultItemSize?: number;
  /**
   * When true (default), trailing-edge resize affordances are emitted on
   * every non-last child. Consumers can set false to disable.
   */
  resizable?: boolean;
}

function explicitAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const size = (item as unknown as { placement?: { size?: { w?: number; h?: number } } })
    .placement?.size;
  const v = axis === 'x' ? size?.w : size?.h;
  return typeof v === 'number' ? v : undefined;
}

function effectiveMinAxis(item: LayoutItem, axis: 'x' | 'y'): number {
  const m = item.hints?.minSize;
  if (!m) return 0;
  return axis === 'x' ? m.w : m.h;
}

function effectiveMaxAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const m = (item as unknown as { hints?: { maxSize?: { w?: number; h?: number } } })
    .hints?.maxSize;
  if (!m) return undefined;
  const v = axis === 'x' ? m.w : m.h;
  return typeof v === 'number' ? v : undefined;
}

/** @group Strategies */
export const stripStrategy: LayoutStrategy<void, string> = {
  name: 'strip',
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
    const cfg = options as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const fill = cfg.fill ?? false;
    const defaultItemSize = cfg.defaultItemSize ?? 0;
    const resizable = cfg.resizable ?? true;

    const placements = new Map<string, Rect>();
    const affordances: Affordance[] = [];
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const main = axis === 'x' ? container.w : container.h;
    const usableMain = main - 2 * padding - gap * (items.length - 1);

    // If any child has explicit placement.size on the main axis, use the
    // clamp helper for the whole row. Otherwise fall back to the existing
    // preferredSize/fill path.
    const hasExplicit = items.some((it) => explicitAxis(it, axis) !== undefined);
    let sizes: number[];
    if (hasExplicit) {
      const clamp = clampExplicitSizes({
        available: usableMain,
        items: items.map((it) => ({
          id: it.id,
          explicit: explicitAxis(it, axis),
          min: effectiveMinAxis(it, axis),
        })),
      });
      sizes = items.map((it) => clamp.get(it.id) ?? 0);
    } else {
      const preferred = items.map((item) =>
        axis === 'x' ? (item.hints?.preferredSize?.w ?? 0) : (item.hints?.preferredSize?.h ?? 0),
      );
      const totalPreferred = preferred.reduce((sum, v) => sum + v, 0);
      const flexCount = preferred.filter((v) => v === 0).length;
      const flexMain = fill && flexCount > 0 ? Math.max(0, (usableMain - totalPreferred) / flexCount) : 0;
      const fallbackMain = fill ? flexMain : defaultItemSize;
      sizes = preferred.map((v) => (v > 0 ? v : fallbackMain));
    }

    if (axis === 'x') {
      const y = padding;
      const h = container.h - 2 * padding;
      let x = padding;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const w = sizes[i]!;
        placements.set(item.id, { x, y, w, h });
        if (resizable && i < items.length - 1) {
          affordances.push({
            id: `resize-x-${item.id}`,
            kind: 'resize-x',
            rect: { x: x + w - 2, y, w: 4, h },
            cursor: 'ew-resize',
            childId: item.id,
          });
        }
        x += w + gap;
      }
    } else {
      const x = padding;
      const w = container.w - 2 * padding;
      let y = padding;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const h = sizes[i]!;
        placements.set(item.id, { x, y, w, h });
        if (resizable && i < items.length - 1) {
          affordances.push({
            id: `resize-y-${item.id}`,
            kind: 'resize-y',
            rect: { x, y: y + h - 2, w, h: 4 },
            cursor: 'ns-resize',
            childId: item.id,
          });
        }
        y += h + gap;
      }
    }
    const result: LayoutResult<string> = { placements, affordances };
    if (preview) result.isPreview = true;
    return result;
  },
  dispatchAffordance({ event, affordance, store, items, container, options }) {
    if (event.kind !== 'drag') return;
    if (affordance.kind !== 'resize-x' && affordance.kind !== 'resize-y') return;
    const childId = affordance.childId;
    if (!childId) return;
    const axis: 'x' | 'y' = affordance.kind === 'resize-x' ? 'x' : 'y';
    const delta = axis === 'x' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
    if (delta === 0) return;
    const item = items.find((it) => it.id === childId);
    if (!item) return;

    const cfg = options as StripConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const main = axis === 'x' ? container.w : container.h;
    const usableMain = main - 2 * padding - gap * (items.length - 1);

    let base = explicitAxis(item, axis);
    if (base === undefined) {
      const explicits = items.filter((it) => explicitAxis(it, axis) !== undefined);
      const explicitSum = explicits.reduce((s, it) => s + (explicitAxis(it, axis) ?? 0), 0);
      const unconstrainedCount = items.length - explicits.length;
      base =
        unconstrainedCount > 0
          ? Math.max(0, (usableMain - explicitSum) / unconstrainedCount)
          : 0;
    }

    let next = base + delta;
    const min = effectiveMinAxis(item, axis);
    const max = effectiveMaxAxis(item, axis);
    if (next < min) next = min;
    if (max !== undefined && next > max) next = max;
    const otherMinSum = items
      .filter((it) => it.id !== childId)
      .reduce((s, it) => s + effectiveMinAxis(it, axis), 0);
    const ceiling = usableMain - otherMinSum;
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
    const patch = axis === 'x' ? { ...existingSize, w: next } : { ...existingSize, h: next };
    (
      store as unknown as {
        patchPlacement: (id: string, patch: Record<string, unknown>) => void;
      }
    ).patchPlacement(childId as string, { size: patch });
  },
};
