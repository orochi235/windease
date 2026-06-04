import type { LayoutInput, LayoutStrategy, Placement } from '../zone.js';
import type { WindowId } from '../window.js';

interface StripConfig {
  axis?: 'x' | 'y';
  gap?: number;
  padding?: number;
}

export const stripStrategy: LayoutStrategy = {
  name: 'strip',
  layout({ zone, windows, viewport }: LayoutInput): Map<WindowId, Placement> {
    const cfg = zone.config as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const byId = new Map(windows.map((w) => [w.id, w]));
    const ordered = zone.windowIds.map((id) => byId.get(id)).filter((w) => w !== undefined);
    const out = new Map<WindowId, Placement>();
    if (ordered.length === 0) return out;

    if (axis === 'x') {
      const y = padding;
      const h = viewport.h - 2 * padding;
      let x = padding;
      for (const w of ordered) {
        const ww = w.hints.preferredSize?.w ?? 0;
        out.set(w.id, { x, y, w: ww, h });
        x += ww + gap;
      }
    } else {
      const x = padding;
      const ww = viewport.w - 2 * padding;
      let y = padding;
      for (const w of ordered) {
        const h = w.hints.preferredSize?.h ?? 0;
        out.set(w.id, { x, y, w: ww, h });
        y += h + gap;
      }
    }
    return out;
  },
};
