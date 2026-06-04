import type { LayoutItem, Rect, WindowId, WindowRecord, ZoneId } from '@windease/core';
import type * as React from 'react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useWindease, useZone } from './hooks.js';

interface ZoneProps {
  id: ZoneId;
  /** If provided, skips ResizeObserver measurement and uses this viewport. */
  viewport?: { w: number; h: number };
  children: (window: WindowRecord, placement: Rect) => ReactNode;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export function Zone({ id, viewport, children }: ZoneProps): React.JSX.Element {
  const store = useWindease();
  const zone = useZone(id);
  const ref = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Depend on whether viewport is provided, not on its identity — consumers commonly pass inline-literal viewport props.
  useEffect(() => {
    if (viewport || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport === undefined]);

  const effectiveViewport = viewport ?? measured;
  const visible: WindowRecord[] = zone
    ? zone.windowIds
        .map((wid) => store.getWindow(wid))
        .filter((w): w is WindowRecord => w?.lifecycle.state === 'visible')
    : [];

  let placements: Map<WindowId, Rect> = new Map();
  if (zone && effectiveViewport && visible.length > 0) {
    const items: LayoutItem[] = visible.map((w) => ({
      id: w.id,
      ...(w.hints && Object.keys(w.hints).length > 0 ? { hints: w.hints } : {}),
    }));
    const result = zone.strategy.layout({
      items,
      container: effectiveViewport,
      state: undefined as never,
      options: zone.config,
    });
    placements = result.placements as Map<WindowId, Rect>;
  }

  return (
    <div ref={ref} className="windease-zone" data-zone-id={id}>
      {visible.map((w) => {
        const p = placements.get(w.id);
        if (!p) {
          warnOnce(
            `${id}:${w.id}`,
            `[windease] zone "${id}" strategy "${zone?.strategy.name}" produced no placement for window "${w.id}"`,
          );
          return null;
        }
        const style: CSSProperties = {
          '--w-x': `${p.x}px`,
          '--w-y': `${p.y}px`,
          '--w-w': `${p.w}px`,
          '--w-h': `${p.h}px`,
        } as CSSProperties;
        return (
          <div
            key={w.id}
            className="windease-window"
            data-window-id={w.id}
            data-window-kind={w.kind}
            data-window-state={w.lifecycle.state}
            style={style}
          >
            {children(w, p)}
          </div>
        );
      })}
    </div>
  );
}
