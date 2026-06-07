import { useEffect, useId, useRef } from 'react';
import type { Node, NodeId, Store } from '../index.js';
import { useStore } from './Provider.js';
import { useChildRegistryFromContext, useParentId } from './ParentContext.js';

export interface NodeBindingOptions {
  /** Explicit id from props. If absent, a stable auto-id is minted. */
  id?: NodeId;
  /** Optional explicit parentId override. If absent, uses ParentContext. */
  parentId?: NodeId;
  /** Sort key reported to the parent's ChildRegistry. */
  order?: number;
  /** Build the initial Node to register. Called exactly once per id. */
  factory: (id: NodeId, parentId: NodeId | null) => Node;
  /** Apply prop-derived state to the already-registered node. Called on every render. */
  reconcile?: (store: Store, id: NodeId) => void;
  /** Hint used by the auto-id minter ("panel-:r1:", "zone-:r2:"). */
  kindHintForAutoId?: string;
}

export interface NodeBindingResult {
  id: NodeId;
}

/**
 * Marker stored on `node.meta[JSX_OWNER_META_KEY]` so collisions with
 * imperative registrations can be detected. The value is a Symbol unique to
 * each component mount.
 */
export const JSX_OWNER_META_KEY = '__windease_jsxOwner';

/**
 * Render-time, ref-guarded node registration with prop reconciliation,
 * ChildRegistry reporting, and unmount cleanup.
 *
 * Why render-time and not useLayoutEffect? Parents render before children,
 * so registering during render means the parent is in the store before any
 * child tries to attach to it. A ref guard makes the call idempotent across
 * re-renders and StrictMode double-invokes. Unregister happens in a useEffect
 * cleanup.
 */
export function useNodeBinding(opts: NodeBindingOptions): NodeBindingResult {
  const store = useStore();
  const parentIdFromCtx = useParentId();
  const parentId = opts.parentId ?? parentIdFromCtx ?? null;
  const reactId = useId();

  // Stable auto-id when none provided. Strip React's id-internal colons since
  // some downstream tooling treats them as CSS selectors.
  const id =
    opts.id ??
    (`${opts.kindHintForAutoId ?? 'node'}-${reactId.replace(/:/g, '')}` as NodeId);

  // Per-mount ownership token. Distinct for every component instance so we can
  // tell our own registration apart from an imperative one with the same id.
  const ownerRef = useRef<symbol | null>(null);
  if (ownerRef.current === null) ownerRef.current = Symbol(`jsx:${id}`);

  // Render-time registration, guarded so re-renders don't re-register.
  const registeredRef = useRef(false);
  if (!registeredRef.current) {
    const existing = store.getNode(id);
    if (existing) {
      const owner = (existing.meta as Record<string, unknown> | undefined)?.[
        JSX_OWNER_META_KEY
      ];
      if (owner === undefined || owner === null) {
        throw new Error(
          `windease: node "${id}" is already registered imperatively; remove the imperative ` +
            `registerNode call or change the JSX preset's id.`,
        );
      }
      if (owner !== ownerRef.current) {
        throw new Error(
          `windease: node "${id}" is already mounted by another <Panel/Group/Zone>; ids must be unique.`,
        );
      }
      // StrictMode replay path: same owner, already registered. No-op.
    } else {
      const node = opts.factory(id, parentId);
      const existingMeta = (node.meta ?? {}) as Record<string, unknown>;
      const mergedMeta = { ...existingMeta, [JSX_OWNER_META_KEY]: ownerRef.current };
      store.registerNode({ ...node, meta: mergedMeta });
    }
    registeredRef.current = true;
  }

  // Report to parent's ChildRegistry every render so the parent always sees
  // children in their current JSX order.
  const registry = useChildRegistryFromContext();
  registry.report({ id, order: opts.order });

  // Prop reconciliation every render (after registration).
  if (opts.reconcile) {
    opts.reconcile(store, id);
  }

  // Unregister on unmount. In StrictMode the effect runs mount → cleanup →
  // mount, so on the second mount we re-register if the cleanup wiped us
  // out (the render-time guard above won't re-fire because the component
  // instance — and thus its refs — is preserved across the StrictMode replay).
  useEffect(() => {
    if (!store.getNode(id)) {
      const node = opts.factory(id, parentId);
      const existingMeta = (node.meta ?? {}) as Record<string, unknown>;
      const mergedMeta = { ...existingMeta, [JSX_OWNER_META_KEY]: ownerRef.current };
      store.registerNode({ ...node, meta: mergedMeta });
      if (opts.reconcile) opts.reconcile(store, id);
    }
    return () => {
      if (store.getNode(id)) {
        store.unregisterNode(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { id };
}
