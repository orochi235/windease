import { type ReactNode, createContext, useContext, useMemo } from 'react';
import type { NodeId } from '../index.js';

/** Current parent id for descendant presets. `null` means "root of the store". */
export const ParentContext = createContext<NodeId | null>(null);

/** Push `parentId` into context for the subtree. Use inside container presets. */
export function ParentScope({
  parentId,
  children,
}: {
  parentId: NodeId;
  children: ReactNode;
}) {
  return <ParentContext.Provider value={parentId}>{children}</ParentContext.Provider>;
}

/**
 * Mechanism by which JSX-mounted child presets report their id (and optional
 * `order`) to their parent during render, so the parent can reconcile sibling
 * order after children have self-registered.
 *
 * The registry is a mutable list that is RESET at the top of every parent
 * render (see `useChildRegistry`). Children push during their own render
 * (which happens after the parent's render body but before its layout
 * effect). The parent reads in a layout effect.
 */
export interface ChildEntry {
  id: NodeId;
  order: number | undefined;
}

export interface ChildRegistryAPI {
  /** Called by a child preset during render to report its identity + order. */
  report(entry: ChildEntry): void;
  /** Read the current snapshot. Called from the parent's layout effect. */
  snapshot(): readonly ChildEntry[];
  /** Called by the parent at the start of its render body to clear stale state. */
  reset(): void;
}

const NOOP_REGISTRY: ChildRegistryAPI = {
  report() {},
  snapshot() {
    return [];
  },
  reset() {},
};

export const ChildRegistryContext = createContext<ChildRegistryAPI>(NOOP_REGISTRY);

/** Provider wrapper. Allocates a stable registry that lives for the parent's
 *  lifetime and is reset on each render. */
export function useChildRegistry(): ChildRegistryAPI {
  // Stable across renders; reset by the parent at render start.
  return useMemo<ChildRegistryAPI>(() => {
    let entries: ChildEntry[] = [];
    return {
      report(entry) {
        entries.push(entry);
      },
      snapshot() {
        return entries;
      },
      reset() {
        entries = [];
      },
    };
  }, []);
}

export function useParentId(): NodeId | null {
  return useContext(ParentContext);
}

export function useChildRegistryFromContext(): ChildRegistryAPI {
  return useContext(ChildRegistryContext);
}
