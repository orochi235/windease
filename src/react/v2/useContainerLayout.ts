import type { Affordance, LayoutEvent, LayoutResult, NodeId, Rect } from '../../index.js';
import { runStrategyForContainer } from '../../index.js';
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { useNodeStore } from './NodeProvider.js';
import { useNode } from './hooks.js';
import { useStrategyRegistry } from './strategies.js';

export interface ContainerLayout {
  placements: Map<NodeId, Rect>;
  affordances: Affordance[];
  unplaced: NodeId[];
  viewport: { w: number; h: number } | null;
  /**
   * Feed a strategy event (e.g. drag delta on an affordance) into the
   * container's `reduce()` and persist the new state on the store. State
   * lives in a side-channel map (not snapshotted, not in undo history).
   * No-op when the strategy has no `reduce`.
   */
  dispatchAffordance: (event: LayoutEvent) => void;
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

  // Subscribe to container.stateChanged so layout re-runs when the persisted
  // strategy state (e.g. binarySplit ratio) is updated via dispatchAffordance.
  const [stateTick, setStateTick] = useState(0);
  useEffect(() => {
    return store.events.on('container.stateChanged', (e) => {
      if (e.id === parentId) setStateTick((t) => t + 1);
    });
  }, [store, parentId]);

  const dispatchAffordance = useCallback<ContainerLayout['dispatchAffordance']>(
    (event) => {
      const container = node?.container;
      if (!container || !viewport) return;
      const strategy = registry.get(container.strategyId);
      if (!strategy?.reduce) return;
      const visibleChildren = store
        .getChildren(parentId)
        .filter((c) => c.lifecycle.state === 'visible')
        .map((c) => {
          const item: { id: string; hints?: { minSize?: { w: number; h: number } } } = { id: c.id };
          if (c.hints?.minSize) item.hints = { minSize: c.hints.minSize };
          return item;
        });
      const current =
        store.getContainerState(parentId) ??
        (strategy.initialState ? strategy.initialState(visibleChildren) : undefined);
      const next = strategy.reduce(current as never, event, {
        container: viewport,
        options: (container.config ?? {}) as Record<string, unknown>,
        items: visibleChildren,
      });
      if (next === current) return;
      store.setContainerState(parentId, next);
    },
    [store, parentId, node?.container, viewport, registry],
  );

  const layout = useMemo<Omit<ContainerLayout, 'dispatchAffordance'>>(() => {
    if (!node?.container || !viewport) {
      return { placements: new Map(), affordances: [], unplaced: [], viewport };
    }
    const strategy = registry.get(node.container.strategyId);
    if (!strategy) {
      return { placements: new Map(), affordances: [], unplaced: [], viewport };
    }
    const persisted = store.getContainerState(parentId);
    const state =
      persisted ??
      (strategy.initialState
        ? strategy.initialState(
            store
              .getChildren(parentId)
              .filter((c) => c.lifecycle.state === 'visible')
              .map((c) => ({ id: c.id })),
          )
        : undefined);
    const result: LayoutResult<NodeId, unknown> = runStrategyForContainer(
      store,
      parentId,
      viewport,
      strategy,
      state as never,
    );
    return {
      placements: result.placements,
      affordances: result.affordances,
      unplaced: result.unplaced ?? [],
      viewport,
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: stateTick is a re-run gate.
  }, [store, node?.container, viewport, registry, parentId, stateTick]);

  return { ...layout, dispatchAffordance };
}
