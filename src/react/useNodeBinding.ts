import { useEffect, useId, useRef } from 'react';
import { type Node, type NodeId, type Store, trace } from '../index.js';
import { useChildRegistryFromContext, useParentId } from './ParentContext.js';
import { renderPassOf, useStore } from './Provider.js';

/** Ids whose JSX registration has committed, per store. */
const committedByStore = new WeakMap<Store, Set<NodeId>>();
/** The render pass each uncommitted JSX registration was made in, per store. */
const passOfRegistration = new WeakMap<Store, Map<NodeId, number>>();

function committedIn(store: Store): Set<NodeId> {
  let ids = committedByStore.get(store);
  if (!ids) {
    ids = new Set();
    committedByStore.set(store, ids);
  }
  return ids;
}

function registrationPasses(store: Store): Map<NodeId, number> {
  let passes = passOfRegistration.get(store);
  if (!passes) {
    passes = new Map();
    passOfRegistration.set(store, passes);
  }
  return passes;
}

/** Registered by a render React threw away — one that never committed and was
 *  made in an earlier pass than the one now rendering. A descendant threw and
 *  React retried; the retry takes the node over rather than report a collision
 *  that would hide the descendant's error. */
function abandoned(store: Store, id: NodeId): boolean {
  if (committedIn(store).has(id)) return false;
  const pass = registrationPasses(store).get(id);
  return pass !== undefined && pass !== renderPassOf(store);
}

/** Re-registrations waiting on a parent that is not in the store, per store and
 *  parent id, in the order the children asked. */
const waitingByStore = new WeakMap<Store, Map<NodeId, Set<() => void>>>();

function waitForParent(store: Store, parentId: NodeId, restore: () => void): () => void {
  let byParent = waitingByStore.get(store);
  if (!byParent) {
    byParent = new Map();
    waitingByStore.set(store, byParent);
  }
  let waiting = byParent.get(parentId);
  if (!waiting) {
    waiting = new Set();
    byParent.set(parentId, waiting);
  }
  waiting.add(restore);
  const set = waiting;
  return () => {
    set.delete(restore);
  };
}

function restoreWaitingChildren(store: Store, parentId: NodeId): void {
  const byParent = waitingByStore.get(store);
  const waiting = byParent?.get(parentId);
  if (!waiting) return;
  byParent?.delete(parentId);
  for (const restore of waiting) restore();
}

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
 * derived from React's `useId()`. A client render's ids come from a counter,
 * so a retry after a descendant throws mints new ones; `abandoned` is what
 * keeps that retry from reporting a phantom collision.
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
    opts.id ?? (`${opts.kindHintForAutoId ?? 'node'}-${reactId.replace(/:/g, '')}` as NodeId);

  // Detect id changes across renders. React reuses the component instance when
  // only props change, so if a consumer writes `<Panel id={dynamicId} />` and
  // `dynamicId` flips without a `key={dynamicId}`, the render-time registration
  // guard never re-fires for the new id and the unmount cleanup later wipes
  // nodes the parent reconciler just ordered. Throw with clear guidance.
  const lastIdRef = useRef<NodeId | null>(null);
  if (lastIdRef.current !== null && lastIdRef.current !== id) {
    throw new Error(
      `windease: <${opts.kindHintForAutoId ?? 'preset'}> id changed from "${lastIdRef.current}" to "${id}" without a key. Add key={id} to your JSX element so React remounts the component when the id changes.`,
    );
  }
  lastIdRef.current = id;

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
    registrationPasses(store).set(id, renderPassOf(store));
  }

  // Render-time registration, guarded so re-renders don't re-register.
  const registeredRef = useRef(false);
  if (!registeredRef.current) {
    const existing = store.getNode(id);
    if (existing) {
      const owner = (existing.meta as Record<string, unknown> | undefined)?.[JSX_OWNER_META_KEY];
      if (owner === undefined || owner === null) {
        throw new Error(
          `windease: node "${id}" is already registered imperatively; remove the imperative ` +
            `registerNode call or change the ${opts.kindHintForAutoId ?? 'preset'}'s id.`,
        );
      }
      if (owner !== ownerToken && abandoned(store, id)) {
        trace('store', `register: ${id} taken over from an abandoned render`);
        store.setMeta(id, { [JSX_OWNER_META_KEY]: ownerToken });
        registrationPasses(store).set(id, renderPassOf(store));
      } else if (owner !== ownerToken) {
        throw new Error(
          `windease: node "${id}" is already mounted by another ${opts.kindHintForAutoId ?? 'preset'}; ids must be unique within a Provider.`,
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
  // component instance — and its refs — is preserved). A parent's cleanup
  // cascades to its children, and the replay runs child-first, so a child whose
  // parent is gone waits for the parent's own effect to restore it. Deps are
  // deliberately just `[id]`; the effect reads latestRef for current values.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional [id]-only deps; latest values read via latestRef.
  useEffect(() => {
    let cancelWait: (() => void) | undefined;
    const restore = () => {
      cancelWait = undefined;
      if (store.getNode(id)) return;
      const { factory, reconcile, parentId } = latestRef.current;
      registerWithOwner(factory, parentId);
      if (reconcile) reconcile(store, id);
      restoreWaitingChildren(store, id);
    };
    if (!store.getNode(id)) {
      const { parentId } = latestRef.current;
      if (parentId !== null && !store.getNode(parentId)) {
        trace('store', `re-register: ${id} waits for missing parent ${parentId}`);
        cancelWait = waitForParent(store, parentId, restore);
      } else {
        restore();
      }
    }
    committedIn(store).add(id);
    registrationPasses(store).delete(id);
    return () => {
      committedIn(store).delete(id);
      cancelWait?.();
      // force:true — a node cannot outlive the JSX that owns it; lock.destroy
      // stops user/host destroy calls, not React unmount.
      if (store.getNode(id)) {
        store.unregisterNode(id, { force: true });
      }
    };
  }, [id]);

  return { id };
}
