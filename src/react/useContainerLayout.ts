import { type RefObject, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { LayoutEvent, LayoutPreview, NodeId, PlacementCommit } from '../index.js';
import { ContainerHost, type ContainerLayout as HostLayout } from '../index.js';
import { useStore } from './Provider.js';
import { useStrategyRegistry } from './strategies.js';

export interface ContainerLayout extends HostLayout {
  /**
   * Feed a strategy event (e.g. drag delta on an affordance) into the
   * container's `reduce()` and persist the new state on the store. State
   * lives in a side-channel map (not snapshotted, not in undo history).
   * No-op when the strategy has no `reduce`.
   */
  dispatchAffordance: (event: LayoutEvent) => void;
  /**
   * Measure `el` as `id`'s content extent for `hints.sizing`. Returns a
   * teardown. Pass an element the layout does not size — see
   * `ContainerHost.observeNatural`.
   */
  observeNatural: (id: NodeId, el: Element) => () => void;
  /**
   * Make `id`'s placement controlled: a gesture hands the bag to `commit`
   * instead of writing the store. See `ContainerHost.registerPlacementControl`.
   */
  registerPlacementControl: (id: NodeId, commit: PlacementCommit) => () => void;
}

/**
 * Measure `viewportRef`'s element (or accept an explicit viewport size),
 * resolve the strategy registered for the container's `strategyId`, and
 * return a NodeId-keyed map of placements for the container's visible
 * children. Updates on resize, container config changes, and child changes.
 *
 * A thin wrapper over `ContainerHost`, which owns all of the above and is
 * usable with no React present.
 *
 * @group Hooks
 */
export function useContainerLayout(
  parentId: NodeId,
  viewportRef: RefObject<Element | null> | null,
  fixedViewport?: { w: number; h: number },
  preview?: LayoutPreview,
): ContainerLayout {
  const store = useStore();
  const registry = useStrategyRegistry();

  const host = useMemo(
    () => new ContainerHost(store, parentId, registry),
    [store, parentId, registry],
  );
  useEffect(() => {
    // `host` comes from useMemo, so a StrictMode remount hands back the same
    // instance this cleanup destroyed. Re-attach rather than assume a fresh one.
    host.attach();
    return () => host.destroy();
  }, [host]);

  const fixedW = fixedViewport?.w;
  const fixedH = fixedViewport?.h;
  useEffect(() => {
    if (fixedW !== undefined && fixedH !== undefined) {
      host.setViewport({ w: fixedW, h: fixedH });
      return;
    }
    const el = viewportRef?.current;
    if (!el) return;
    return host.observe(el);
  }, [host, viewportRef, fixedW, fixedH]);

  // Identity of `preview` changes every pointermove; the host dedupes by value.
  const previewKey = preview
    ? `${preview.insertId}|${preview.insertIndex ?? '-'}|${preview.cursor.x}|${preview.cursor.y}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewKey is a stable identity for `preview`.
  useEffect(() => {
    host.setPreview(preview ?? null);
  }, [host, previewKey]);

  const layout = useSyncExternalStore(host.subscribe, host.layout, host.layout);

  const dispatchAffordance = useCallback(
    (event: LayoutEvent) => host.dispatchAffordance(event),
    [host],
  );

  const observeNatural = useCallback(
    (id: NodeId, el: Element) => host.observeNatural(id, el),
    [host],
  );

  const registerPlacementControl = useCallback(
    (id: NodeId, commit: PlacementCommit) => host.registerPlacementControl(id, commit),
    [host],
  );

  return { ...layout, dispatchAffordance, observeNatural, registerPlacementControl };
}
