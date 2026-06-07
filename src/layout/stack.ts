import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';


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
}

export const stackStrategy: LayoutStrategy<void, string> = {
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
  }): LayoutResult<string> {
    const cfg = options as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const colX = padding;
    const colW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding - gap * (items.length - 1);

    const fill = cfg.fill ?? true;
    const defaultItemSize = cfg.defaultItemSize ?? 0;
    const preferredH = items.map((item) => item.hints?.preferredSize?.h ?? 0);
    const totalPreferred = preferredH.reduce((sum, h) => sum + h, 0);
    const flexCount = preferredH.filter((h) => h === 0).length;
    const flexH = fill && flexCount > 0 ? Math.max(0, (usableH - totalPreferred) / flexCount) : 0;
    const fallbackH = fill ? flexH : defaultItemSize;

    let y = padding;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const h = preferredH[i]! > 0 ? preferredH[i]! : fallbackH;
      placements.set(item.id, { x: colX, y, w: colW, h });
      y += h + gap;
    }
    return { placements, affordances: [] };
  },
};
