import { createContext, createElement, type ReactNode, useContext, useMemo, useRef } from 'react';
import type { GeometrySource, NodeId, Rect } from '../../index.js';

/**
 * The rect table plus a change signal. Layout arrives from a ResizeObserver,
 * which the store knows nothing about — a reader that only watched the store
 * would sample this while it was still empty and never look again.
 */
export interface GeometryRegistry {
  rects: Map<string, Rect>;
  /** Publish accumulated writes. No-op when nothing actually moved. */
  commit(): void;
  subscribe(fn: () => void): () => void;
}

const GeometryContext = createContext<GeometryRegistry | null>(null);

function createRegistry(): GeometryRegistry {
  const rects = new Map<string, Rect>();
  const subscribers = new Set<() => void>();
  let published = '';
  return {
    rects,
    commit() {
      const next = JSON.stringify([...rects].sort(([a], [b]) => (a < b ? -1 : 1)));
      if (next === published) return;
      published = next;
      for (const fn of subscribers) fn();
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

/**
 * Collects absolute rects for every placed node so the resolver can compare
 * across containers. `<Container>` reports each child's rect composed with its
 * own origin, which is what makes directional navigation work across nesting
 * without anyone calling `getBoundingClientRect`.
 */
export function GeometryProvider({ children }: { children: ReactNode }) {
  const registry = useRef<GeometryRegistry | null>(null);
  registry.current ??= createRegistry();
  return createElement(GeometryContext.Provider, { value: registry.current }, children);
}

export function useGeometryRegistry(): GeometryRegistry | null {
  return useContext(GeometryContext);
}

export function useGeometrySource(): GeometrySource {
  const registry = useContext(GeometryContext);
  return useMemo(
    () => ({
      rectOf(id: NodeId): Rect | null {
        return registry?.rects.get(String(id)) ?? null;
      },
    }),
    [registry],
  );
}
