import type { LayoutInput, LayoutStrategy, Placement } from '../zone.js';
import type { WindowId } from '../window.js';

interface StackConfig {
  gap?: number;
  padding?: number;
}

export const stackStrategy: LayoutStrategy = {
  name: 'stack',
  layout({ zone, windows, viewport }: LayoutInput): Map<WindowId, Placement> {
    const cfg = zone.config as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const byId = new Map(windows.map((w) => [w.id, w]));
    const ordered = zone.windowIds.map((id) => byId.get(id)).filter((w) => w !== undefined);
    const out = new Map<WindowId, Placement>();
    if (ordered.length === 0) return out;

    const colX = padding;
    const colW = viewport.w - 2 * padding;
    const usableH = viewport.h - 2 * padding - gap * (ordered.length - 1);

    const totalPreferred = ordered.reduce(
      (sum, w) => sum + (w.hints.preferredSize?.h ?? 0),
      0,
    );
    const hasPreferred = totalPreferred > 0;
    const fallbackH = usableH / ordered.length;

    let y = padding;
    for (const w of ordered) {
      const h = hasPreferred ? (w.hints.preferredSize?.h ?? 0) : fallbackH;
      out.set(w.id, { x: colX, y, w: colW, h });
      y += h + gap;
    }
    return out;
  },
};
