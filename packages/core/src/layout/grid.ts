import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface GridConfig {
  cols?: number;
  gap?: number;
  padding?: number;
}

export const gridStrategy: LayoutStrategy<void, WindowId> = {
  name: 'grid',
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
    const cfg = options as GridConfig;
    const cols = Math.max(1, cfg.cols ?? 1);
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const rows = Math.ceil(items.length / cols);
    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements.set(item.id as WindowId, {
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
    return { placements, affordances: [] };
  },
};
