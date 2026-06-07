import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';


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
}

/** @group Strategies */
export const stripStrategy: LayoutStrategy<void, string> = {
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
  }): LayoutResult<string> {
    const cfg = options as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const fill = cfg.fill ?? false;
    const defaultItemSize = cfg.defaultItemSize ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const main = axis === 'x' ? container.w : container.h;
    const preferred = items.map((item) =>
      axis === 'x' ? (item.hints?.preferredSize?.w ?? 0) : (item.hints?.preferredSize?.h ?? 0),
    );
    const totalPreferred = preferred.reduce((sum, v) => sum + v, 0);
    const flexCount = preferred.filter((v) => v === 0).length;
    const usableMain = main - 2 * padding - gap * (items.length - 1);
    const flexMain = fill && flexCount > 0 ? Math.max(0, (usableMain - totalPreferred) / flexCount) : 0;
    const fallbackMain = fill ? flexMain : defaultItemSize;

    if (axis === 'x') {
      const y = padding;
      const h = container.h - 2 * padding;
      let x = padding;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const w = preferred[i]! > 0 ? preferred[i]! : fallbackMain;
        placements.set(item.id, { x, y, w, h });
        x += w + gap;
      }
    } else {
      const x = padding;
      const w = container.w - 2 * padding;
      let y = padding;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const h = preferred[i]! > 0 ? preferred[i]! : fallbackMain;
        placements.set(item.id, { x, y, w, h });
        y += h + gap;
      }
    }
    return { placements, affordances: [] };
  },
};
