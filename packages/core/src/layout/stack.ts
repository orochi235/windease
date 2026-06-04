import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface StackConfig {
  gap?: number;
  padding?: number;
}

export const stackStrategy: LayoutStrategy<void, WindowId> = {
  name: 'stack',
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<WindowId> {
    const cfg = options as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const colX = padding;
    const colW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding - gap * (items.length - 1);

    const totalPreferred = items.reduce(
      (sum, item) => sum + (item.hints?.preferredSize?.h ?? 0),
      0,
    );
    const hasPreferred = totalPreferred > 0;
    const fallbackH = usableH / items.length;

    let y = padding;
    for (const item of items) {
      const h = hasPreferred ? (item.hints?.preferredSize?.h ?? 0) : fallbackH;
      placements.set(item.id as WindowId, { x: colX, y, w: colW, h });
      y += h + gap;
    }
    return { placements, affordances: [] };
  },
};
