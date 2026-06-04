import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface StripConfig {
  axis?: 'x' | 'y';
  gap?: number;
  padding?: number;
}

export const stripStrategy: LayoutStrategy<void, WindowId> = {
  name: 'strip',
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
    const cfg = options as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    if (axis === 'x') {
      const y = padding;
      const h = container.h - 2 * padding;
      let x = padding;
      for (const item of items) {
        const w = item.hints?.preferredSize?.w ?? 0;
        placements.set(item.id as WindowId, { x, y, w, h });
        x += w + gap;
      }
    } else {
      const x = padding;
      const w = container.w - 2 * padding;
      let y = padding;
      for (const item of items) {
        const h = item.hints?.preferredSize?.h ?? 0;
        placements.set(item.id as WindowId, { x, y, w, h });
        y += h + gap;
      }
    }
    return { placements, affordances: [] };
  },
};
