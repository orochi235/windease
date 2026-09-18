import { useEffect, useMemo, useState } from 'react';
import { runStrategyForContainer } from '../../layout-node-adapter.js';
import type { Rect, Size } from '../../layout-types.js';
import { asNodeId, type NodeId } from '../../node.js';
import type { Store } from '../../store.js';
import { useStore } from '../Provider.js';
import { useOptionalStrategyRegistry } from '../strategies.js';

/** A tint per strategy id; anything unlisted falls back to gray. */
const TINTS: Record<string, string> = {
  strip: '#2563eb',
  grid: '#16a34a',
  stack: '#9333ea',
  floating: '#ea580c',
  desktop: '#db2777',
  shelf: '#0891b2',
  skyline: '#0d9488',
  column: '#ca8a04',
};
const tint = (strategy: string) =>
  TINTS[strategy] ?? Object.entries(TINTS).find(([k]) => strategy.includes(k))?.[1] ?? '#64748b';

interface Box {
  id: string;
  rect: Rect;
  depth: number;
  /** Set on a container: its strategy id and a short config summary. */
  strategy?: string;
  label?: string;
}

/** Every node's rect in root coordinates, laying each container out at the rect its parent gave it. */
function mapTree(
  store: Store,
  rootId: NodeId,
  viewport: Size,
  registry: ReturnType<typeof useOptionalStrategyRegistry>,
): Box[] {
  const out: Box[] = [];
  const visit = (id: NodeId, at: Rect, depth: number) => {
    const node = store.getNode(id);
    if (!node) return;
    const c = node.container;
    if (!c) {
      out.push({ id, rect: at, depth });
      return;
    }
    const config = (c.config ?? {}) as Record<string, unknown>;
    const detail = ['axis', 'cols', 'rows', 'maxCols', 'maxRows', 'resizeMode', 'overflowMode']
      .filter((k) => config[k] !== undefined)
      .map((k) => `${k} ${String(config[k])}`)
      .join(', ');
    out.push({
      id,
      rect: at,
      depth,
      strategy: c.strategyId,
      label: detail ? `${c.strategyId} · ${detail}` : c.strategyId,
    });
    const strategy = registry?.get(c.strategyId);
    if (!strategy) return;
    const state = c.state ?? strategy.initialState?.([], config);
    let result: ReturnType<typeof runStrategyForContainer>;
    try {
      result = runStrategyForContainer(store, id, { w: at.w, h: at.h }, strategy, state);
    } catch {
      return;
    }
    for (const [childId, r] of result.placements) {
      visit(childId, { ...r, x: at.x + r.x, y: at.y + r.y }, depth + 1);
    }
  };
  visit(rootId, { x: 0, y: 0, z: 0, w: viewport.w, h: viewport.h }, 0);
  return out;
}

/**
 * A miniature of the live layout: every container outlined and tinted by the
 * strategy that places its children, every pane a plain box. Laid out
 * headlessly from the store, so it redraws as the example changes.
 */
export function StrategyMap({ rootId, viewport }: { rootId: string; viewport: Size }) {
  const store = useStore();
  const registry = useOptionalStrategyRegistry();
  const [tick, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the store-changed signal.
  const boxes = useMemo(
    () => mapTree(store, asNodeId(rootId), viewport, registry),
    [store, rootId, viewport.w, viewport.h, registry, tick],
  );
  const used = [...new Set(boxes.flatMap((b) => (b.strategy ? [b.strategy] : [])))];
  const width = 560;
  const scale = Math.min(width / Math.max(viewport.w, 1), 320 / Math.max(viewport.h, 1));
  const containers = boxes.filter((b) => b.strategy);
  // Each label is centered on its box and shrunk to fit its width (monospace:
  // ~0.6em per character). Innermost boxes place first; an outer label that
  // would land on one already placed steps a line down or up until it clears.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const labels = [...containers]
    .sort((a, b) => b.depth - a.depth)
    .map((box) => {
      const text = box.label ?? '';
      const fits = (box.rect.w * 0.92) / Math.max(text.length * 0.6, 1);
      const size = Math.max(Math.min(14 / scale, fits), 9 / scale);
      const halfW = (text.length * 0.6 * size) / 2;
      const line = size * 1.3;
      const cx = box.rect.x + box.rect.w / 2;
      const cy = box.rect.y + box.rect.h / 2;
      const hits = (y: number) =>
        placed.some(
          (p) =>
            cx - halfW < p.x1 && cx + halfW > p.x0 && y - line / 2 < p.y1 && y + line / 2 > p.y0,
        );
      let y = cy;
      for (let step = 1; step <= 12 && hits(y); step++) {
        y = cy + Math.ceil(step / 2) * line * (step % 2 ? 1 : -1);
      }
      placed.push({ x0: cx - halfW, x1: cx + halfW, y0: y - line / 2, y1: y + line / 2 });
      return { box, x: cx, y, size };
    });
  return (
    <figure className="strategy-map">
      <svg
        className="strategy-map__svg"
        viewBox={`0 0 ${viewport.w} ${viewport.h}`}
        width={viewport.w * scale}
        height={viewport.h * scale}
        role="img"
        aria-label={`Layout map: ${used.join(', ')}`}
      >
        {boxes
          .filter((b) => !b.strategy)
          .map((b) => (
            <rect
              key={b.id}
              className="strategy-map__pane"
              x={b.rect.x}
              y={b.rect.y}
              width={Math.max(b.rect.w, 0)}
              height={Math.max(b.rect.h, 0)}
              strokeWidth={1 / scale}
            >
              <title>{b.id}</title>
            </rect>
          ))}
        {containers.map((b) => (
          <rect
            key={b.id}
            x={b.rect.x}
            y={b.rect.y}
            width={Math.max(b.rect.w, 0)}
            height={Math.max(b.rect.h, 0)}
            fill={tint(b.strategy!)}
            fillOpacity={0.08}
            stroke={tint(b.strategy!)}
            strokeWidth={2 / scale}
          >
            <title>
              {b.id}: {b.label}
            </title>
          </rect>
        ))}
        {labels.map(({ box, x, y, size }) => (
          <text
            key={box.id}
            className="strategy-map__label"
            x={x}
            y={y}
            fontSize={size}
            strokeWidth={3 / scale}
            fill={tint(box.strategy!)}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {box.label}
          </text>
        ))}
      </svg>
      <figcaption className="strategy-map__legend">
        {used.map((s) => (
          <span key={s} className="strategy-map__key">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" fill={tint(s)} />
            </svg>{' '}
            {s}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
