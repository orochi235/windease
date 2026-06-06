import type { LayoutResult, NodeId, Rect } from '@windease/core';
import { runStrategyForContainer } from '@windease/core';
import { type RefObject, useEffect, useMemo, useState } from 'react';
import { useNodeStore } from './NodeProvider.js';
import { useNode } from './hooks.js';
import { useStrategyRegistry } from './strategies.js';

export interface ContainerLayout {
  placements: Map<NodeId, Rect>;
  unplaced: NodeId[];
  viewport: { w: number; h: number } | null;
}

/**
 * Measure `viewportRef`'s element (or accept an explicit viewport size),
 * resolve the strategy registered for the container's `strategyId`, and
 * return a NodeId-keyed map of placements for the container's visible
 * children. Updates on resize, container config changes, and child changes.
 */
export function useContainerLayout(
  parentId: NodeId,
  viewportRef: RefObject<Element | null> | null,
  fixedViewport?: { w: number; h: number },
): ContainerLayout {
  const store = useNodeStore();
  const node = useNode(parentId);
  const registry = useStrategyRegistry();
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    fixedViewport ?? null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on whether fixedViewport is provided, not its identity.
  useEffect(() => {
    if (fixedViewport) {
      setMeasured(fixedViewport);
      return;
    }
    if (!viewportRef?.current) return;
    const el = viewportRef.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedViewport === undefined, viewportRef]);

  const viewport = fixedViewport ?? measured;

  return useMemo<ContainerLayout>(() => {
    if (!node?.container || !viewport) {
      return { placements: new Map(), unplaced: [], viewport };
    }
    const strategy = registry.get(node.container.strategyId);
    if (!strategy) {
      return { placements: new Map(), unplaced: [], viewport };
    }
    const initial = strategy.initialState
      ? strategy.initialState(
          store
            .getChildren(parentId)
            .filter((c) => c.lifecycle.state === 'visible')
            .map((c) => ({ id: c.id })),
        )
      : undefined;
    const result: LayoutResult<NodeId, unknown> = runStrategyForContainer(
      store,
      parentId,
      viewport,
      strategy,
      initial as never,
    );
    return {
      placements: result.placements,
      unplaced: result.unplaced ?? [],
      viewport,
    };
  }, [store, node?.container, viewport, registry, parentId]);
}
