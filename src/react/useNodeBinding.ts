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
 * imperative registrations can be detected. The value is a string token
 * derived from React's `useId()` — stable for a given JSX position even
 * across React 19 render-retry cycles (which reset refs but reuse the same
 * fiber id). This stability is what keeps a child's render-time error from
 * masking itself as a phantom "already mounted by another preset" collision
 * on the parent's retry pass.
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

  // Detect id changes across renders. React reuses the component instance when
  // only props change, so if a consumer writes `<Panel id={dynamicId} />` and
  // `dynamicId` flips without a `key={dynamicId}`, the render-time registration
  // guard never re-fires for the new id and the unmount cleanup later wipes
  // nodes the parent reconciler just ordered. Throw with clear guidance.
  const lastIdRef = useRef<NodeId | null>(null);
  if (lastIdRef.current !== null && lastIdRef.current !== id) {
    throw new Error(
      `windease: <${opts.kindHintForAutoId ?? 'preset'}> id changed from "${lastIdRef.current}" to "${id}" without a key. ` +
        `Add key={id} to your JSX element so React remounts the component when the id changes.`,
    );
  }
  lastIdRef.current = id;

  // Ownership token. Uses `useId()` so the token is deterministic for a given
  // JSX position — survives React 19's render-retry cycle (which resets refs
  // but reuses the same fiber id). A per-mount Symbol would mint a fresh value
  // on retry, causing the collision check below to misreport a descendant's
  // real error as "already mounted by another preset".
  const ownerToken = `jsx:${reactId}`;

  // Keep latest opts/parentId reachable from the unmount-recovery effect,
  // whose deps are deliberately minimal (`[id]`). React already invokes the
  // most-recently-rendered effect callback, so the closures are current —
  // but reading through the ref is defense in depth and makes the dependency
  // explicit for readers.
  const latestRef = useRef({ factory: opts.factory, reconcile: opts.reconcile, parentId });
  latestRef.current = { factory: opts.factory, reconcile: opts.reconcile, parentId };

  function registerWithOwner(factory: NodeBindingOptions['factory'], parent: NodeId | null): void {
    const node = factory(id, parent);
    const existingMeta = (node.meta ?? {}) as Record<string, unknown>;
    const mergedMeta = { ...existingMeta, [JSX_OWNER_META_KEY]: ownerToken };
    store.registerNode({ ...node, meta: mergedMeta });
  }

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
            `registerNode call or change the ${opts.kindHintForAutoId ?? 'preset'}'s id.`,
        );
      }
      if (owner !== ownerToken) {
        throw new Error(
          `windease: node "${id}" is already mounted by another ${opts.kindHintForAutoId ?? 'preset'}; ` +
            `ids must be unique within a Provider.`,
        );
      }
      // StrictMode replay path: same owner, already registered. No-op.
    } else {
      registerWithOwner(opts.factory, parentId);
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
  // mount, so on the second mount we re-register if the cleanup wiped us out
  // (the render-time guard above stays `true` across the replay because the
  // component instance — and its refs — is preserved).
  useEffect(() => {
    if (!store.getNode(id)) {
      const { factory, reconcile, parentId } = latestRef.current;
      registerWithOwner(factory, parentId);
      if (reconcile) reconcile(store, id);
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
