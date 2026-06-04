import type { WindowId } from '../window.js';
import type { LayoutInput, LayoutStrategy, Placement } from '../zone.js';

interface GridConfig {
  cols?: number;
  gap?: number;
  padding?: number;
}

export const gridStrategy: LayoutStrategy = {
  name: 'grid',
  layout({ zone, windows, viewport }: LayoutInput): Map<WindowId, Placement> {
    const cfg = zone.config as GridConfig;
    const cols = Math.max(1, cfg.cols ?? 1);
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const byId = new Map(windows.map((w) => [w.id, w]));
    const ordered = zone.windowIds.map((id) => byId.get(id)).filter((w) => w !== undefined);
    const out = new Map<WindowId, Placement>();
    if (ordered.length === 0) return out;

    const rows = Math.ceil(ordered.length / cols);
    const usableW = viewport.w - 2 * padding;
    const usableH = viewport.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (let i = 0; i < ordered.length; i++) {
      const w = ordered[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      out.set(w.id, {
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
    return out;
  },
};
