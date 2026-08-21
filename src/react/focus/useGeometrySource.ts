import { createContext, createElement, type ReactNode, useContext, useMemo, useRef } from 'react';
import type { GeometrySource, NodeId, Rect } from '../../index.js';

type RectRegistry = Map<string, Rect>;

const GeometryContext = createContext<RectRegistry | null>(null);

/**
 * Collects absolute rects for every placed node so the resolver can compare
 * across containers. `<Container>` reports each child's rect composed with its
 * own origin, which is what makes directional navigation work across nesting
 * without anyone calling `getBoundingClientRect`.
 */
export function GeometryProvider({ children }: { children: ReactNode }) {
  const registry = useRef<RectRegistry>(new Map()).current;
  return createElement(GeometryContext.Provider, { value: registry }, children);
}

export function useGeometryRegistry(): RectRegistry | null {
  return useContext(GeometryContext);
}

export function useGeometrySource(): GeometrySource {
  const registry = useContext(GeometryContext);
  return useMemo(
    () => ({
      rectOf(id: NodeId): Rect | null {
        return registry?.get(String(id)) ?? null;
      },
    }),
    [registry],
  );
}
