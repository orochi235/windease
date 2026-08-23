import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { trace } from '../trace.js';

interface StackConfig {
  /** Which child fills the body. Defaults to the first in `childOrder`. */
  activeId?: string;
  /** Pixels reserved at the top for the consumer's tab strip. An input, not a
   *  measurement — the core never measures the strip it does not draw. */
  headerSize?: number;
  padding?: number;
}

/**
 * One child visible, the rest withheld. The tab strip is the consumer's to
 * draw; `headerSize` is what reserves room for it.
 *
 * @group Layout
 */
export const stackStrategy: LayoutStrategy<void, string> = {
  name: 'stack',
  configSpec: {
    activeId: 'string',
    headerSize: 'number',
    padding: 'number',
  },
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
    const headerSize = cfg.headerSize ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const active = items.find((i) => i.id === cfg.activeId) ?? items[0]!;
    placements.set(active.id, {
      x: padding,
      y: headerSize + padding,
      w: Math.max(0, container.w - padding * 2),
      h: Math.max(0, container.h - headerSize - padding * 2),
    });

    const unplaced = items.filter((i) => i.id !== active.id).map((i) => i.id);
    const result: LayoutResult<string> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    trace('layout', `stack: active=${active.id}, ${unplaced.length} withheld of ${items.length}`);
    return result;
  },
};
