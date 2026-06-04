import * as React from 'react';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import type {
  Placement, WindowId, WindowRecord, ZoneId,
} from '@windease/core';
import { useWindease, useZone } from './hooks.js';

interface ZoneProps {
  id: ZoneId;
  /** If provided, skips ResizeObserver measurement and uses this viewport. */
  viewport?: { w: number; h: number };
  children: (window: WindowRecord, placement: Placement) => ReactNode;
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
  const visible = zone
    ? zone.windowIds
        .map((wid) => store.getWindow(wid))
        .filter((w): w is WindowRecord => w?.lifecycle.state === 'visible')
    : [];

  let placements: Map<WindowId, Placement> = new Map();
  if (zone && effectiveViewport && visible.length > 0) {
    placements = zone.strategy.layout({
      zone,
      windows: visible,
      viewport: effectiveViewport,
    });
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
