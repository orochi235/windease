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

    const preferredH = items.map((item) => item.hints?.preferredSize?.h ?? 0);
    const totalPreferred = preferredH.reduce((sum, h) => sum + h, 0);
    const flexCount = preferredH.filter((h) => h === 0).length;
    const flexH = flexCount > 0 ? Math.max(0, (usableH - totalPreferred) / flexCount) : 0;

    let y = padding;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const h = preferredH[i]! > 0 ? preferredH[i]! : flexH;
      placements.set(item.id as WindowId, { x: colX, y, w: colW, h });
      y += h + gap;
    }
    return { placements, affordances: [] };
  },
};
